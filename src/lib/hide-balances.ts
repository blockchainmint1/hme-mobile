/**
 * Global "hide balances" preference. Persisted in localStorage so it
 * survives reloads; broadcast via a window event so tiles / detail sheets
 * update reactively without a router refetch.
 */
import { useEffect, useState } from "react";

const KEY = "hme.hide-balances.v1";
const EVENT = "hme:hide-balances-changed";

export function getHideBalances(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEY) === "1";
}

export function setHideBalances(v: boolean): void {
  if (typeof window === "undefined") return;
  if (v) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function toggleHideBalances(): void {
  setHideBalances(!getHideBalances());
}

export function useHideBalances(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => getHideBalances());
  useEffect(() => {
    const h = () => setV(getHideBalances());
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return [v, setHideBalances];
}

/** Replace digits with bullets while keeping punctuation & unit labels. */
export function maskAmount(text: string): string {
  return text.replace(/[0-9]/g, "•");
}
