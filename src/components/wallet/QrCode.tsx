import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { hapticSuccess } from "@/lib/native/ui";

/**
 * Renders a QR code. Pass `copyValue` (usually the bare address, without the
 * `bitcoin:`-style prefix that the code itself carries) and the whole code
 * becomes a button: tapping it copies that value and flips the caption under
 * the code to "Copied!" so the tap is obviously acknowledged.
 */
export function QrCode({
  value,
  size = 240,
  copyValue,
  copyLabel = "Tap to copy the address",
  onCopy,
}: {
  value: string;
  size?: number;
  /** When set, the code is tappable and copies this text. */
  copyValue?: string | null;
  copyLabel?: string;
  /** Called after a tap so a parent can sync its own Copy button. */
  onCopy?: (ok: boolean) => void;
}) {
  const [dataUrl, setDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  // A profile switch mid-countdown must not leave a stale timer behind.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function tap() {
    if (!copyValue) return;
    const ok = await copyToClipboard(copyValue);
    if (ok) {
      void hapticSuccess();
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    }
    onCopy?.(ok);
  }

  if (!dataUrl) {
    return (
      <div
        className="rounded-lg bg-muted animate-pulse"
        style={{ width: size, height: size }}
        aria-label="Generating QR code"
      />
    );
  }

  const img = (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR code"
      className={`rounded-lg border border-border bg-white p-2 ${copyValue ? "pb-7" : ""}`}
    />
  );

  if (!copyValue) return img;

  return (
    <button
      type="button"
      onClick={() => void tap()}
      title={copyLabel}
      aria-label={copied ? "Address copied" : copyLabel}
      className="relative block rounded-lg outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
    >
      {img}
      <span
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center"
      >
        {copied ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            <Check className="h-3 w-3" /> Copied!
          </span>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Tap to copy
          </span>
        )}
      </span>
    </button>
  );
}
