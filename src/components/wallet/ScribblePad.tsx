import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

/** Bytes of raw movement data to collect before we call it "enough". */
const TARGET_BYTES = 512;

/**
 * Captures pointer movement entropy. We accumulate (x, y, t, pressure) bytes
 * for every pointer sample while the user draws. The parent receives the raw
 * buffer once enough samples are collected (and may receive more on later
 * strokes). The bytes are XOR-mixed with secure randomness upstream — this
 * pad is the "fun knob", not the sole source of entropy.
 */
export function ScribblePad({
  onEntropy,
  onStart,
  onProgress,
}: {
  onEntropy: (bytes: Uint8Array) => void;
  onStart?: () => void;
  onProgress?: (ratio: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<number[]>([]);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [ratio, setRatio] = useState(0);

  function resize() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function pushSample(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = performance.now();
    const p = Math.floor((e.pressure || 0.5) * 255);
    // Pack into bytes — low byte of coords, time micros, pressure.
    bufferRef.current.push(
      x & 0xff,
      (x >> 8) & 0xff,
      y & 0xff,
      (y >> 8) & 0xff,
      Math.floor(t) & 0xff,
      Math.floor(t * 1000) & 0xff,
      p,
    );

    const ctx = c.getContext("2d");
    if (ctx && lastRef.current) {
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    lastRef.current = { x, y };

    const r = Math.min(1, bufferRef.current.length / TARGET_BYTES);
    setRatio(r);
    onProgress?.(r);
    // Fire entropy on every sample so the seed updates live as the user draws.
    onEntropy(new Uint8Array(bufferRef.current));
  }

  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    bufferRef.current = [];
    lastRef.current = null;
    setRatio(0);
    onProgress?.(0);
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border border-border bg-background/60 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block h-56 w-full touch-none cursor-crosshair"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            drawingRef.current = true;
            lastRef.current = null;
            pushSample(e);
          }}
          onPointerMove={(e) => {
            if (drawingRef.current) pushSample(e);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
            lastRef.current = null;
          }}
          onPointerLeave={() => {
            drawingRef.current = false;
            lastRef.current = null;
          }}
        />
        {ratio === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Scribble here to add your own randomness
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
          {Math.round(ratio * 100)}%
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} className="gap-1.5">
          <Eraser className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
}
