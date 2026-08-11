/**
 * Wallet profiles ("vaults").
 *
 * A profile is a completely independent wallet environment: its own encrypted
 * seed envelope plus its own side stores (WIF keys, watch-only entries, chain
 * prefs / labels, token prefs, address indices). Switching profiles swaps the
 * whole environment — it is NOT another card on the carousel.
 *
 * Isolation is done with a localStorage key prefix instead of rewriting every
 * store: the FIRST profile keeps the historical unprefixed keys, so existing
 * installs keep working byte-for-byte with zero migration. Additional profiles
 * live under `p:<id>:<key>`.
 *
 * This module is intentionally dependency-free (no imports) so any store can
 * use it without creating an import cycle.
 */

export const DEFAULT_PROFILE_ID = "default";

const LIST_KEY = "hme.profiles.v1";
const ACTIVE_KEY = "hme.profile.active.v1";
/** Fired whenever the profile list or the active profile changes. */
export const PROFILES_CHANGED_EVENT = "hme:profiles-changed";

export interface ProfileRecord {
  id: string;
  createdAt: number;
}

function ls(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readList(): ProfileRecord[] {
  const s = ls();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s.getItem(LIST_KEY) ?? "null");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ProfileRecord => !!p && typeof p.id === "string" && typeof p.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function writeList(list: ProfileRecord[]): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* quota — non-fatal */
  }
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent(PROFILES_CHANGED_EVENT));
  } catch {
    /* SSR */
  }
}

/**
 * All known profile ids, oldest first. Installs that predate profiles report
 * the single implicit "default" profile when a legacy envelope exists.
 */
export function listProfileIds(): string[] {
  const s = ls();
  if (!s) return [DEFAULT_PROFILE_ID];
  const list = readList();
  if (list.length) {
    return list.map((p) => p.id);
  }
  return [DEFAULT_PROFILE_ID];
}

export function profileCreatedAt(id: string): number {
  return readList().find((p) => p.id === id)?.createdAt ?? 0;
}

/** Adds the profile to the registry if it isn't there yet. */
export function registerProfile(id: string): void {
  const list = readList();
  if (list.some((p) => p.id === id)) return;
  // First registration on a legacy install must keep "default" at the front.
  const next =
    list.length === 0 && id !== DEFAULT_PROFILE_ID
      ? [{ id: DEFAULT_PROFILE_ID, createdAt: 0 }, { id, createdAt: Date.now() }]
      : [...list, { id, createdAt: Date.now() }];
  writeList(next);
  emit();
}

export function unregisterProfile(id: string): void {
  if (id === DEFAULT_PROFILE_ID) return;
  writeList(readList().filter((p) => p.id !== id));
  emit();
}

export function activeProfileId(): string {
  const s = ls();
  if (!s) return DEFAULT_PROFILE_ID;
  const id = s.getItem(ACTIVE_KEY);
  if (!id) return DEFAULT_PROFILE_ID;
  // Guard against a stale pointer to a deleted profile.
  const known = listProfileIds();
  return known.includes(id) ? id : DEFAULT_PROFILE_ID;
}

export function setActiveProfileId(id: string): void {
  const s = ls();
  if (!s) return;
  try {
    if (id === DEFAULT_PROFILE_ID) s.removeItem(ACTIVE_KEY);
    else s.setItem(ACTIVE_KEY, id);
  } catch {
    /* noop */
  }
  emit();
}

export function newProfileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pr_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `pr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Namespace a localStorage key to a profile. The default profile keeps the
 * original key so pre-profile installs are untouched.
 */
export function scopedKey(base: string, id: string = activeProfileId()): string {
  return id === DEFAULT_PROFILE_ID ? base : `p:${id}:${base}`;
}

/** Remove every localStorage entry belonging to a non-default profile. */
export function purgeProfileStorage(id: string): void {
  const s = ls();
  if (!s || id === DEFAULT_PROFILE_ID) return;
  const prefix = `p:${id}:`;
  const doomed: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) s.removeItem(k);
}
