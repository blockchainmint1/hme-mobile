/**
 * Encrypted wallet storage for the TEXITcoin web wallet.
 *
 * - Wallet secret (BIP39 mnemonic + optional passphrase) is encrypted with a
 *   password-derived key (PBKDF2-SHA256, 600k iterations) using AES-GCM via
 *   the browser WebCrypto API.
 * - The ciphertext + salt + IV are stored in localStorage.
 * - Plaintext seed lives only in memory while the wallet is unlocked.
 *
 * NOTE: browser storage is not the same as a phone's secure enclave.
 * The seed phrase backup written down by the user is always the source of truth.
 */

const STORAGE_KEY = "txc.wallet.v1";
// KDF cost for NEW wallets. Raised from the previous 600k. The actual count
// used to DECRYPT is read from each envelope (see `iterations` below) so
// existing wallets keep unlocking with whatever they were saved at. This is
// what prevents a lockout when the default changes.
const PBKDF2_ITERATIONS = 1_000_000;
// Envelopes written before this field existed were all PBKDF2-SHA256 @ 600k.
const LEGACY_ITERATIONS = 600_000;

export interface StoredWalletEnvelope {
  v: 1;
  kind: "bip84" | "bip49" | "bip44";
  label: string;
  /** base64 */ salt: string;
  /** base64 */ iv: string;
  /** base64 */ ciphertext: string;
  createdAt: number;
  /** KDF identifier. Absent on legacy envelopes (implies pbkdf2-sha256). */
  kdf?: "pbkdf2-sha256";
  /** PBKDF2 iteration count this envelope was encrypted with. Absent = 600k. */
  iterations?: number;
}

export interface UnlockedWallet {
  mnemonic: string;
  passphrase: string;
  kind: "bip84" | "bip49" | "bip44";
  label: string;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// WebCrypto wants ArrayBufferView<ArrayBuffer>, not the broader ArrayBufferLike
// that Uint8Array carries. Copy into a fresh ArrayBuffer to satisfy the types.
function toAB(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toAB(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function saveWallet(
  unlocked: UnlockedWallet,
  password: string,
): Promise<StoredWalletEnvelope> {
  if (typeof window === "undefined") throw new Error("saveWallet requires a browser");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const payload = new TextEncoder().encode(
    JSON.stringify({ m: unlocked.mnemonic, p: unlocked.passphrase }),
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toAB(iv) }, key, toAB(payload)),
  );

  const env: StoredWalletEnvelope = {
    v: 1,
    kind: unlocked.kind,
    label: unlocked.label,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(ct),
    createdAt: Date.now(),
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
  return env;
}

export function loadEnvelope(): StoredWalletEnvelope | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWalletEnvelope;
  } catch {
    return null;
  }
}

export async function unlockWallet(password: string): Promise<UnlockedWallet | null> {
  const env = loadEnvelope();
  if (!env) return null;
  try {
    const iterations = env.iterations ?? LEGACY_ITERATIONS;
    const key = await deriveKey(password, b64decode(env.salt), iterations);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toAB(b64decode(env.iv)) },
      key,
      toAB(b64decode(env.ciphertext)),
    );

    const parsed = JSON.parse(new TextDecoder().decode(pt)) as { m: string; p: string };
    const unlocked: UnlockedWallet = {
      mnemonic: parsed.m,
      passphrase: parsed.p,
      kind: env.kind,
      label: env.label,
    };

    // Silent KDF upgrade: if this envelope predates the current cost (or has
    // no recorded iteration count), transparently re-encrypt at the stronger
    // setting now that we hold the correct password and plaintext. Best-effort
    // only — a failure here must never block a successful unlock.
    if ((env.iterations ?? LEGACY_ITERATIONS) < PBKDF2_ITERATIONS) {
      try {
        await saveWallet(unlocked, password);
      } catch {
        /* keep the old envelope; user is still unlocked */
      }
    }

    return unlocked;
  } catch {
    return null;
  }
}

export function deleteWallet(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Rename the stored wallet without re-encrypting. The label is metadata
 * only — the encrypted seed material is untouched.
 */
export function renameStoredWallet(newLabel: string): StoredWalletEnvelope | null {
  const env = loadEnvelope();
  if (!env) return null;
  const next: StoredWalletEnvelope = { ...env, label: newLabel };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function hasWallet(): boolean {
  return loadEnvelope() !== null;
}
