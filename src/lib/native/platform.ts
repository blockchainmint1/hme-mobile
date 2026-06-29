/**
 * Tiny wrappers around @capacitor/core so the web build never hard-depends on
 * a native runtime. `isNative()` is false in the browser / Lovable preview;
 * native-only code paths must guard on it.
 */
import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): "ios" | "android" | "web" {
  try {
    const p = Capacitor.getPlatform();
    if (p === "ios" || p === "android") return p;
  } catch {
    /* noop */
  }
  return "web";
}
