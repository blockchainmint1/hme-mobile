/**
 * Affiliate referral capture (honest.money "?ref=" codes).
 *
 * We deliberately do NOT load honest.money's hm.js snippet: this is a wallet,
 * and any third-party script would run on the same page that decrypts seed
 * phrases. Instead we do what the snippet does for the code itself — keep the
 * ?ref value for 30 days, last click wins — and send it server-side with the
 * Hub event when the member links their profile.
 */
const KEY = "hm-ref";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function captureRefFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref || !CODE_RE.test(ref)) return;
    localStorage.setItem(KEY, JSON.stringify({ code: ref.toLowerCase(), at: Date.now() }));
  } catch {
    /* storage blocked */
  }
}

export function getStoredRef(): string | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as { code?: string; at?: number };
    if (!v.code || !v.at || Date.now() - v.at > TTL_MS) return undefined;
    return v.code;
  } catch {
    return undefined;
  }
}
