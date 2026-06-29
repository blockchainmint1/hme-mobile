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
const PBKDF2_ITERATIONS = 600_000;

export interface StoredWalletEnvelope {
  v: 1;
  kind: "bip84" | "bip49" | "bip44";
  label: string;
  /** base64 */ salt: string;
  /** base64 */ iv: string;
  /** base64 */ ciphertext: string;
  createdAt: number;
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

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
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
  const key = await deriveKey(password, salt);
  const payload = new TextEncoder().encode(
    JSON.stringify({ m: unlocked.mnemonic, p: unlocked.passphrase }),
  );
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload),
  );
  const env: StoredWalletEnvelope = {
    v: 1,
    kind: unlocked.kind,
    label: unlocked.label,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(ct),
    createdAt: Date.now(),
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
    const key = await deriveKey(password, b64decode(env.salt));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(env.iv) },
      key,
      b64decode(env.ciphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(pt)) as { m: string; p: string };
    return { mnemonic: parsed.m, passphrase: parsed.p, kind: env.kind, label: env.label };
  } catch {
    return null;
  }
}

export function deleteWallet(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasWallet(): boolean {
  return loadEnvelope() !== null;
}
