/**
 * Ephemeral unlocked-wallet cache in sessionStorage so a page reload doesn't
 * immediately re-prompt for the password. Auto-locks after AUTO_LOCK_MS of
 * inactivity. sessionStorage is cleared when the tab is closed, so closing
 * the app always drops the plaintext seed.
 *
 * Trade-off: this keeps a plaintext mnemonic in sessionStorage while the tab
 * is open, which is a deliberate UX concession requested by the user. The
 * privacy screen + biometric re-prompt still gate the visible surface.
 */
import type { UnlockedWallet } from "./storage";

const KEY = "txc.wallet.session.v1";
export const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes

interface Cached {
  wallet: UnlockedWallet;
  lastActiveAt: number;
}

function safeSession(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveSession(wallet: UnlockedWallet): void {
  const s = safeSession();
  if (!s) return;
  const payload: Cached = { wallet, lastActiveAt: Date.now() };
  try {
    s.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — silently fall back to memory-only */
  }
}

export function touchSession(): void {
  const s = safeSession();
  if (!s) return;
  const raw = s.getItem(KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Cached;
    parsed.lastActiveAt = Date.now();
    s.setItem(KEY, JSON.stringify(parsed));
  } catch {
    s.removeItem(KEY);
  }
}

export function loadSession(): UnlockedWallet | null {
  const s = safeSession();
  if (!s) return null;
  const raw = s.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.wallet || typeof parsed.lastActiveAt !== "number") {
      s.removeItem(KEY);
      return null;
    }
    if (Date.now() - parsed.lastActiveAt > AUTO_LOCK_MS) {
      s.removeItem(KEY);
      return null;
    }
    return parsed.wallet;
  } catch {
    s.removeItem(KEY);
    return null;
  }
}

export function clearSession(): void {
  const s = safeSession();
  if (!s) return;
  s.removeItem(KEY);
}
