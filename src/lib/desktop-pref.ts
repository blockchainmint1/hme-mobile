import { isExtension, isNative } from "@/lib/native/platform";

const KEY = "hm.view.phone";
export const DESKTOP_MIN_WIDTH = 1024;

/** Remember an explicit "Phone view" choice on this device. */
export function setPreferPhone(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* noop */ }
}

/** Wide desktop browsers default to /desktop; APK, extension and phones never do. */
export function shouldDefaultToDesktop(): boolean {
  if (typeof window === "undefined" || isNative() || isExtension()) return false;
  try { if (localStorage.getItem(KEY) === "1") return false; } catch { /* noop */ }
  const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? true;
  return finePointer && window.innerWidth >= DESKTOP_MIN_WIDTH;
}
