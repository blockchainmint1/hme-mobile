/**
 * Native UI helpers: haptics, share sheet, status bar, keyboard.
 * All calls are safe to invoke on the web — they no-op unless we're
 * running inside the Capacitor native shell (iOS / Android).
 */
import { isNative } from "./platform";

export async function hapticSuccess(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* noop */
  }
}

export async function hapticError(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Error });
  } catch {
    /* noop */
  }
}

export async function hapticTap(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* noop */
  }
}

/**
 * Open the OS share sheet. On web, falls back to navigator.share() when
 * available, otherwise resolves false so callers can fall back to copy.
 */
export async function shareText(opts: {
  title?: string;
  text: string;
  url?: string;
  dialogTitle?: string;
}): Promise<boolean> {
  if (isNative()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: opts.title,
        text: opts.text,
        url: opts.url,
        dialogTitle: opts.dialogTitle ?? opts.title,
      });
      return true;
    } catch {
      return false;
    }
  }
  // Web fallback — Web Share API where available.
  try {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url });
      return true;
    }
  } catch {
    /* user cancelled or unsupported */
  }
  return false;
}

/**
 * Initialize iOS/Android status bar + keyboard behavior. Called once at
 * app start from the root component.
 */
export async function initNativeChrome(): Promise<void> {
  if (!isNative()) return;
  try {
    const [{ StatusBar, Style }, { Keyboard, KeyboardResize }] = await Promise.all([
      import("@capacitor/status-bar"),
      import("@capacitor/keyboard"),
    ]);
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    // Let the web view draw under the status bar so our safe-area padding
    // (env(safe-area-inset-top)) controls the look — matches native apps.
    await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => {});
    await Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});
  } catch {
    /* plugin not present on this build */
  }
}
