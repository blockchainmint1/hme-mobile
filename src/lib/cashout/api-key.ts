/**
 * TSD Swap API key, entered by the user in Settings.
 *
 * Cash-out is off by default: the wallet only shows the off-ramp once the user
 * has a TSD Swap account and has pasted the key it issued them. The key both
 * authorises the order and tells TSD Swap which account (and therefore which
 * fee tier — 1%, 0.5% or 0%) applies, so the wallet never handles coupons or
 * quotes a rate of its own.
 *
 * Stored locally, like every other wallet preference. It is a per-account
 * capability token, not spending authority: it can only create redeem orders
 * that pay out to an address the user types on the device.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "hme:tsd-cashout-key";
const EVENT = "hme:tsd-cashout-key-changed";

/** Loose shape check so obvious paste mistakes are caught on the device. */
export const TSD_API_KEY_RE = /^[A-Za-z0-9_.:-]{16,200}$/;

export function getCashoutApiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setCashoutApiKey(key: string | null) {
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key);
    else window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* noop */
  }
}

/** Hydration-safe: null on the server and first render, then the stored key. */
export function useCashoutApiKey(): [string | null, (k: string | null) => void] {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    setKey(getCashoutApiKey());
    const h = () => setKey(getCashoutApiKey());
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return [
    key,
    (k: string | null) => {
      setCashoutApiKey(k);
      setKey(k);
    },
  ];
}

/** Mask for display: keeps the first and last few characters only. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
