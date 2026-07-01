/**
 * QR scan button. Uses native Capacitor scanning on iOS/Android,
 * falls back to the web BarcodeDetector API in the browser.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isNative } from "@/lib/native/platform";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function QrScanButton({ onScan }: { onScan: (text: string) => void }) {
  const [open, setOpen] = useState(false);

  async function handleClick() {
    if (isNative()) {
      try {
        const { BarcodeScanner } = await import("@capacitor-community/barcode-scanner");
        await BarcodeScanner.checkPermission({ force: true });
        await BarcodeScanner.hideBackground();
        const result = await BarcodeScanner.startScan();
        await BarcodeScanner.showBackground();
        await BarcodeScanner.stopScan();
        if (result.hasContent && result.content) {
          onScan(result.content);
        }
      } catch (e) {
        // ignore cancel / permission denial
      }
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleClick}
        title="Scan QR"
        aria-label="Scan QR"
      >
        <Camera className="h-4 w-4" />
      </Button>
      {open && (
        <ScannerDialog
          onClose={() => setOpen(false)}
          onScan={(text) => {
            setOpen(false);
            onScan(text);
          }}
        />
      )}
    </>
  );
}

function ScannerDialog({ onClose, onScan }: { onClose: () => void; onScan: (t: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let detector: BarcodeDetectorLike | null = null;

    async function start() {
      const hasDetector = typeof window !== "undefined" && !!window.BarcodeDetector;
      setSupported(hasDetector);
      if (!hasDetector) {
        setError("This browser doesn't support QR scanning. Paste the address instead.");
        return;
      }
      try {
        detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (cancelled || !video || !detector) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length > 0 && codes[0].rawValue) {
              onScan(codes[0].rawValue);
              return;
            }
          } catch {
            // ignore per-frame errors
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Camera unavailable");
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center justify-between">
            <span>Scan QR</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </DialogTitle>
        </DialogHeader>
        <div className="relative aspect-square bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
          <div className="pointer-events-none absolute inset-8 border-2 border-white/70 rounded-lg" />
        </div>
        <div className="p-4 text-xs text-muted-foreground min-h-[3rem]">
          {error
            ? error
            : supported === false
              ? "QR scanning not supported"
              : "Point the camera at a wallet address QR code."}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parse a wallet URI like `texitcoin:txc1...?amount=1.23` or a plain address.
 * Returns { address, amount? } where amount is a decimal string in TXC.
 */
export function parseWalletUri(input: string): { address: string; amount?: string } {
  const trimmed = input.trim();
  const schemeMatch = trimmed.match(/^(texitcoin|txc|bitcoin):([^?]+)(\?(.*))?$/i);
  if (schemeMatch) {
    const address = schemeMatch[2];
    const params = new URLSearchParams(schemeMatch[4] ?? "");
    const amount = params.get("amount") ?? undefined;
    return { address, amount };
  }
  return { address: trimmed };
}
