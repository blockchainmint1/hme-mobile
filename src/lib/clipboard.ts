/**
 * Copy text to clipboard with a robust fallback.
 *
 * `navigator.clipboard.writeText` fails silently in several environments we
 * care about (iframes without `clipboard-write` permission, some Android
 * WebView versions, insecure contexts, the Lovable preview iframe). We try
 * the modern API first, then fall back to a hidden textarea + execCommand.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Native iOS / Android path — uses the OS clipboard directly inside the
  // Capacitor app, which is more reliable than WebView clipboard APIs.
  try {
    const { isNative } = await import("@/lib/native/platform");
    if (isNative()) {
      const { Clipboard } = await import("@capacitor/clipboard");
      await Clipboard.write({ string: text });
      return true;
    }
  } catch {
    // fall through to web paths
  }

  // Modern path
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function" &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }

  // Legacy path — works inside iframes / older WebViews
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    const selection = document.getSelection();
    const previousRange =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    return ok;
  } catch {
    return false;
  }
}
