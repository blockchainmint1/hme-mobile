/**
 * Ephemeral unlocked-wallet cache. The plaintext mnemonic is NEVER written to
 * disk (sessionStorage / localStorage / IndexedDB) in cleartext.
 *
 * How it works:
 *  - On first save, we generate a random AES-GCM key kept only in module-local
 *    memory. The mnemonic + metadata are encrypted with this key and the
 *    ciphertext is stored in sessionStorage so an intra-tab reload can rehydrate.
 *  - When the JS runtime is torn down (tab close, process kill, hard reload
 *    that replaces the module graph), the in-memory key vanishes and any
 *    surviving ciphertext becomes unrecoverable — forcing password/biometric
 *    unlock. This is the desired security posture.
 *  - The sliding 5-minute auto-lock timer is enforced separately in
 *    wallet-context.tsx; this module only stores what's needed to rehydrate.
 */
import type { UnlockedWallet } from "./storage";

const KEY = "txc.wallet.session.v2";
export const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes

interface CachedPlain {
  wallet: UnlockedWallet;
  lastActiveAt: number;
}

interface CachedWire {
  v: 2;
  iv: string; // base64
  ct: string; // base64
  lastActiveAt: number;
}

let memKey: CryptoKey | null = null;
// In-memory shadow so we still work if sessionStorage is blocked (some
// WebViews with privacy modes) or if crypto.subtle throws.
let memPayload: CachedPlain | null = null;

function safeSession(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const raw = atob(s);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function ensureKey(): Promise<CryptoKey | null> {
  if (memKey) return memKey;
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    memKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return memKey;
  } catch {
    return null;
  }
}

export async function saveSession(wallet: UnlockedWallet): Promise<void> {
  const payload: CachedPlain = { wallet, lastActiveAt: Date.now() };
  memPayload = payload;
  const key = await ensureKey();
  const s = safeSession();
  if (!key || !s) return;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(JSON.stringify(payload));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
    const wire: CachedWire = {
      v: 2,
      iv: b64(iv),
      ct: b64(ct),
      lastActiveAt: payload.lastActiveAt,
    };
    s.setItem(KEY, JSON.stringify(wire));
  } catch {
    /* memory-only fallback is fine */
  }
}

export function touchSession(): void {
  const now = Date.now();
  if (memPayload) memPayload.lastActiveAt = now;
  const s = safeSession();
  if (!s) return;
  const raw = s.getItem(KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as CachedWire;
    parsed.lastActiveAt = now;
    s.setItem(KEY, JSON.stringify(parsed));
  } catch {
    s.removeItem(KEY);
  }
}

export async function loadSession(): Promise<UnlockedWallet | null> {
  // Prefer in-memory (same JS context).
  if (memPayload) {
    if (Date.now() - memPayload.lastActiveAt > AUTO_LOCK_MS) {
      clearSession();
      return null;
    }
    return memPayload.wallet;
  }
  const s = safeSession();
  if (!s) return null;
  const raw = s.getItem(KEY);
  if (!raw) return null;
  try {
    const wire = JSON.parse(raw) as CachedWire;
    if (wire?.v !== 2 || typeof wire.lastActiveAt !== "number") {
      s.removeItem(KEY);
      return null;
    }
    if (Date.now() - wire.lastActiveAt > AUTO_LOCK_MS) {
      s.removeItem(KEY);
      return null;
    }
    const key = await ensureKey();
    if (!key) {
      // No key in this JS context — ciphertext is unrecoverable. Drop it.
      s.removeItem(KEY);
      return null;
    }
    // Because the AES key is regenerated per process, a decryption failure
    // here is expected after a full reload — treat as no session.
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(wire.iv) },
      key,
      unb64(wire.ct),
    );
    const parsed = JSON.parse(new TextDecoder().decode(pt)) as CachedPlain;
    memPayload = parsed;
    return parsed.wallet;
  } catch {
    s.removeItem(KEY);
    return null;
  }
}

export function clearSession(): void {
  memPayload = null;
  memKey = null;
  const s = safeSession();
  if (!s) return;
  try {
    s.removeItem(KEY);
    // Also nuke legacy v1 key from earlier builds.
    s.removeItem("txc.wallet.session.v1");
  } catch {
    /* noop */
  }
}
