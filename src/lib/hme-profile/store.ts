/** Device-local record of the linked honest.money member profile. */
export interface HmeProfileLink {
  memberId: string;
  email: string;
  linkedAt: number;
  sharedKeys: boolean;
}

const KEY = "hme-profile-link";
const STATE_KEY = "hme-sso-state";
export const PENDING_KEY = "hme-sso-pending";

export function loadProfileLink(): HmeProfileLink | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HmeProfileLink) : null;
  } catch {
    return null;
  }
}

export function saveProfileLink(v: HmeProfileLink | null) {
  if (v) localStorage.setItem(KEY, JSON.stringify(v));
  else localStorage.removeItem(KEY);
}

export function newSsoState(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const s = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(STATE_KEY, s);
  return s;
}

export function currentSsoState(): string | null {
  return localStorage.getItem(STATE_KEY);
}

export function clearSsoState() {
  localStorage.removeItem(STATE_KEY);
}

/** Where honest.money sends the member back. Must be on the SSO allow-list. */
export const SSO_RETURN_BASE = "https://mobile.honest.money/sso";

export function ssoLoginUrl(state: string): string {
  const ret = `${SSO_RETURN_BASE}?state=${state}`;
  return `https://honest.money/sso-login?popup=1&prompt=login&return_to=${encodeURIComponent(ret)}`;
}
