/**
 * QR scan button. Uses an in-app <video> + getUserMedia dialog on every
 * platform (browser and native WKWebView), decoding frames with either the
 * built-in BarcodeDetector or jsQR as a fallback.
 *
 * We used to route native builds through @capacitor-community/barcode-scanner,
 * which draws the camera behind a transparent webview. That approach breaks
 * when the app loads from a remote URL (our current setup — server.url =
 * https://mobile.honest.money) because the community plugin can't reliably
 * make a remotely-hosted webview transparent. Result: tapping the QR icon
 * did nothing / showed a black screen. The getUserMedia path works
 * identically inside WKWebView as long as NSCameraUsageDescription is set
 * (it is) and the page is HTTPS (it is).
 */
import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let detector: BarcodeDetectorLike | null = null;
    let jsQR: typeof import("jsqr").default | null = null;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Camera not supported on this device.");
        return;
      }
      if (typeof window !== "undefined" && window.BarcodeDetector) {
        try {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      if (!detector) {
        try {
          const mod = await import("jsqr");
          jsQR = mod.default;
        } catch {
          setError("QR decoder failed to load.");
          return;
        }
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Camera access denied. Enable it in Settings → HME Wallet."
            : e instanceof Error
              ? e.message
              : "Camera unavailable",
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      try {
        await video.play();
      } catch {
        /* autoplay retries below on tick */
      }
      setReady(true);

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (cancelled || !video) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          try {
            if (detector) {
              const codes = await detector.detect(video);
              if (codes.length > 0 && codes[0].rawValue) {
                onScan(codes[0].rawValue);
                return;
              }
            } else if (jsQR && ctx) {
              const w = video.videoWidth;
              const h = video.videoHeight;
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
              if (code && code.data) {
                onScan(code.data);
                return;
              }
            }
          } catch {
            // ignore per-frame errors
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
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
          <DialogDescription className="sr-only">
            Use your device camera to scan a wallet address QR code.
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-8 border-2 border-white/70 rounded-lg" />
        </div>
        <div className="p-4 text-xs text-muted-foreground min-h-[3rem]">
          {error
            ? error
            : ready
              ? "Point the camera at a wallet address QR code."
              : "Starting camera…"}
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
  const schemeMatch = trimmed.match(/^(texitcoin|txc|bitcoin|iskandercoin|isk|litecoin|ltc|dogecoin|doge):([^?]+)(\?(.*))?$/i);
  if (schemeMatch) {
    const address = schemeMatch[2];
    const params = new URLSearchParams(schemeMatch[4] ?? "");
    const amount = params.get("amount") ?? undefined;
    return { address, amount };
  }
  return { address: trimmed };
}
