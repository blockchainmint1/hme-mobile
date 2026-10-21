import { useEffect, useState } from "react";

/** Device-wide, deliberately separate from profile-scoped feature preferences. */
export const ACTIVITY_PREF_KEY = "hme:activity:hide-suspicious:v1";
const EVENT = "hme:activity-prefs-changed";

export function getHideSuspiciousActivity(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ACTIVITY_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setHideSuspiciousActivity(enabled: boolean): void {
  try {
    window.localStorage.setItem(ACTIVITY_PREF_KEY, String(enabled));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* Storage unavailable: keep the current view usable. */ }
}

export function useHideSuspiciousActivity(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const refresh = () => setEnabled(getHideSuspiciousActivity());
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return [enabled, (next) => {
    setHideSuspiciousActivity(next);
    setEnabled(next);
  }];
}