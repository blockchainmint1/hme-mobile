/**
 * Local record of which sites this device has signed in to before.
 *
 * Purely a UX hint for the sign-in confirmation screen ("you've signed in here
 * before"). It is not a trust decision and carries no secrets — just hostnames
 * and a timestamp — so plain localStorage is fine.
 */
const KEY = "hme.webLoginHistory";
const MAX = 50;

type History = Record<string, number>;

function read(): History {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return {};
    const out: History = {};
    for (const [host, at] of Object.entries(value as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[host] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function write(history: History) {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(history)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or unavailable — the hint is optional */
  }
}

/** Timestamp of the last successful sign-in to this host, if any. */
export function lastSignedInAt(hostname: string): number | null {
  return read()[hostname.toLowerCase()] ?? null;
}

/** Record a successful sign-in to this host. */
export function rememberSignIn(hostname: string) {
  const history = read();
  history[hostname.toLowerCase()] = Date.now();
  write(history);
}
