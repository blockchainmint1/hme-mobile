import { scopedKey } from "@/lib/profiles";
import { useEffect, useState } from "react";

/**
 * Optional extra features the user can opt into from Settings.
 * Kept off by default — every feature we surface is another button
 * that can go wrong or confuse a first-time user.
 */
export type FeatureId =
  | "evmSwap"
  | "utxoSwap"
  | "confirmLast4"
  | "hideSpamTokens"
  | "tsdConsolidateNudge"
  | "sharedWallets";

/** Default value when the user hasn't set the toggle yet. */
const DEFAULTS: Record<FeatureId, boolean> = {
  evmSwap: false,
  utxoSwap: true,
  confirmLast4: true,
  hideSpamTokens: true,
  tsdConsolidateNudge: true,
  sharedWallets: false,
};

const STORAGE_KEY_BASE = "hme:features";
/** Namespaced per wallet profile (default profile keeps the original key). */
function STORAGE_KEY(): string {
  return scopedKey(STORAGE_KEY_BASE);
}
const EVENT = "hme:features-changed";
const TOKEN_SPAM_KEY = "hme:tokens:hide-spam:v1";

type FeatureMap = Partial<Record<FeatureId, boolean>>;

function read(): FeatureMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY());
    return raw ? (JSON.parse(raw) as FeatureMap) : {};
  } catch {
    return {};
  }
}

function write(m: FeatureMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY(), JSON.stringify(m));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* noop */
  }
}

export function isFeatureEnabled(id: FeatureId): boolean {
  if (id === "hideSpamTokens" && typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(TOKEN_SPAM_KEY);
      if (saved != null) return saved !== "false";
      // Copy only this preference, never mutate a profile's feature map.
      const legacy = read().hideSpamTokens;
      if (legacy !== undefined) window.localStorage.setItem(TOKEN_SPAM_KEY, String(legacy));
      return legacy ?? true;
    } catch { return true; }
  }
  const v = read()[id];
  return v === undefined ? DEFAULTS[id] : v;
}

export function setFeatureEnabled(id: FeatureId, enabled: boolean) {
  if (id === "hideSpamTokens") {
    try {
      window.localStorage.setItem(TOKEN_SPAM_KEY, String(enabled));
      window.dispatchEvent(new Event(EVENT));
    } catch { /* Storage unavailable. */ }
    return;
  }
  const m = read();
  m[id] = enabled;
  write(m);
}

export function useFeature(id: FeatureId): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => isFeatureEnabled(id));
  useEffect(() => {
    const h = () => setOn(isFeatureEnabled(id));
    h();
    window.addEventListener(EVENT, h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener(EVENT, h); window.removeEventListener("storage", h); };
  }, [id]);
  return [
    on,
    (v: boolean) => {
      setFeatureEnabled(id, v);
      setOn(v);
    },
  ];
}
