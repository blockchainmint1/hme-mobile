/**
 * Copy text to clipboard with a robust fallback.
 *
 * `navigator.clipboard.writeText` fails silently in several environments we
 * care about (iframes without `clipboard-write` permission, some Android
 * WebView versions, insecure contexts, the Lovable preview iframe). We try
 * the modern API first, then fall back to a hidden textarea + execCommand.
 *
 * For sensitive values (addresses, seeds), pass `autoClearMs` so a background
 * clipboard sniffer cannot lift the value forever — we overwrite the
 * clipboard with an empty string after the timeout.
 */
export async function copyToClipboard(
  text: string,
  opts?: { autoClearMs?: number },
): Promise<boolean> {
  const ok = await writeClipboard(text);
  if (ok && opts?.autoClearMs && opts.autoClearMs > 0) {
    setTimeout(() => {
      // Only clear if the clipboard hasn't been overwritten by something else
      // in the meantime. Best-effort — we tolerate any failure.
      void (async () => {
        try {
          const current = await readClipboardSafe();
          if (current === text) await writeClipboard("");
        } catch {
          /* noop */
        }
      })();
    }, opts.autoClearMs);
  }
  return ok;
}

async function writeClipboard(text: string): Promise<boolean> {
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
    const okExec = document.execCommand("copy");
    document.body.removeChild(ta);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    return okExec;
  } catch {
    return false;
  }
}

async function readClipboardSafe(): Promise<string | null> {
  try {
    const { isNative } = await import("@/lib/native/platform");
    if (isNative()) {
      const { Clipboard } = await import("@capacitor/clipboard");
      const r = await Clipboard.read();
      return typeof r?.value === "string" ? r.value : null;
    }
  } catch {
    /* ignore */
  }
  try {
    if (navigator?.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    /* ignore */
  }
  return null;
}
