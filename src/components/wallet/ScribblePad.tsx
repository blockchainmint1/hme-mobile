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
  const onEntropyRef = useRef(onEntropy);
  const onStartRef = useRef(onStart);
  const onProgressRef = useRef(onProgress);
  const bufferRef = useRef<number[]>([]);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeTouchIdRef = useRef<number | null>(null);
  const hasStartedStrokeRef = useRef(false);
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    onEntropyRef.current = onEntropy;
    onStartRef.current = onStart;
    onProgressRef.current = onProgress;
  }, [onEntropy, onStart, onProgress]);

  function clearCanvas() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
  }

  function resize() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function paintSample(c: HTMLCanvasElement, x: number, y: number) {
    const ctx = c.getContext("2d");
    if (!ctx) return;

    // Canvas support for OKLCH/custom properties is inconsistent in mobile
    // WebViews. Read the resolved CSS color, then fall back to a high-contrast
    // stroke if the canvas rejects that value.
    const fallbackStroke = document.documentElement.classList.contains("dark")
      ? "rgba(248, 250, 252, 0.94)"
      : "rgba(15, 23, 42, 0.9)";
    ctx.strokeStyle = fallbackStroke;
    const resolvedColor = getComputedStyle(c).color;
    if (resolvedColor) ctx.strokeStyle = resolvedColor;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (lastRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 2.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function updateProgress() {
    const r = Math.min(1, bufferRef.current.length / TARGET_BYTES);
    setRatio(r);
    onProgressRef.current?.(r);
    onEntropyRef.current(new Uint8Array(bufferRef.current));
  }

  // Core sample push — takes raw client coordinates (already client-space).
  function pushAt(clientX: number, clientY: number, pressure: number) {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const t = performance.now();
    const p = Math.floor((pressure || 0.5) * 255);
    bufferRef.current.push(
      x & 0xff,
      (x >> 8) & 0xff,
      y & 0xff,
      (y >> 8) & 0xff,
      Math.floor(t) & 0xff,
      Math.floor(t * 1000) & 0xff,
      p,
    );

    paintSample(c, x, y);
    lastRef.current = { x, y };
    updateProgress();
  }

  function beginStroke() {
    drawingRef.current = true;
    lastRef.current = null;
    if (!hasStartedStrokeRef.current) {
      hasStartedStrokeRef.current = true;
      onStartRef.current?.();
    }
  }

  function endStroke() {
    drawingRef.current = false;
    activePointerRef.current = null;
    activeTouchIdRef.current = null;
    lastRef.current = null;
    if (bufferRef.current.length > 0) {
      const r = Math.min(1, bufferRef.current.length / TARGET_BYTES);
      setRatio(r);
      onProgressRef.current?.(r);
      onEntropyRef.current(new Uint8Array(bufferRef.current));
    }
  }

  // Bind native events and keep move/end listeners on window. On Samsung /
  // Android WebView, touch starts on the canvas but move events can be
  // retargeted to the scrolling page, so canvas-only move handlers miss them.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const pointerLooksLikeTouch = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      activePointerRef.current = e.pointerId;
      // Pointer capture is flaky on mobile WebViews and can immediately fire
      // lostpointercapture, ending the stroke. It is only useful for desktop
      // mouse drags that leave the canvas.
      if (!pointerLooksLikeTouch(e)) {
        try {
          c.setPointerCapture(e.pointerId);
        } catch {
          /* older WebViews may not support pointer capture */
        }
      }
      beginStroke();
      pushAt(e.clientX, e.clientY, e.pressure || 0.5);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drawingRef.current || activePointerRef.current !== e.pointerId) return;
      e.preventDefault();
      const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const samples = coalesced.length ? coalesced : [e];
      for (const sample of samples) {
        pushAt(sample.clientX, sample.clientY, sample.pressure || e.pressure || 0.5);
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      e.preventDefault();
      endStroke();
    };

    c.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd, { passive: false });
    window.addEventListener("pointercancel", onPointerEnd, { passive: false });
    const onLostPointerCapture = () => {
      if (activePointerRef.current !== null && drawingRef.current) return;
      endStroke();
    };

    c.addEventListener("lostpointercapture", onLostPointerCapture);

    // Touch Events are intentionally bound even when PointerEvent exists:
    // several Capacitor/WKWebView combinations expose PointerEvent but only
    // reliably deliver TouchEvent for canvas gestures.
    const getActiveTouch = (touches: TouchList) => {
      if (activeTouchIdRef.current === null) return touches[0] ?? null;
      for (let i = 0; i < touches.length; i += 1) {
        if (touches[i].identifier === activeTouchIdRef.current) return touches[i];
      }
      return null;
    };
    const forceOf = (t: Touch) =>
      (t as Touch & { force?: number }).force ??
      (t as Touch & { webkitForce?: number }).webkitForce ??
      0.5;
    const onTouchStart = (e: TouchEvent) => {
      const t = getActiveTouch(e.changedTouches);
      if (!t) return;
      e.preventDefault();
      activeTouchIdRef.current = t.identifier;
      beginStroke();
      pushAt(t.clientX, t.clientY, forceOf(t));
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!drawingRef.current) return;
      const t = getActiveTouch(e.touches.length ? e.touches : e.changedTouches);
      if (!t) return;
      e.preventDefault();
      pushAt(t.clientX, t.clientY, forceOf(t));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (activeTouchIdRef.current === null) return;
      const t = getActiveTouch(e.changedTouches);
      if (!t) return;
      e.preventDefault();
      endStroke();
    };

    c.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: false });
    window.addEventListener("touchcancel", onTouchEnd, { passive: false });

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      beginStroke();
      pushAt(e.clientX, e.clientY, 0.5);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!drawingRef.current || activePointerRef.current !== null || activeTouchIdRef.current !== null) return;
      e.preventDefault();
      pushAt(e.clientX, e.clientY, 0.5);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!drawingRef.current || activePointerRef.current !== null || activeTouchIdRef.current !== null) return;
      e.preventDefault();
      endStroke();
    };

    c.addEventListener("mousedown", onMouseDown, { passive: false });
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", onMouseUp, { passive: false });

    return () => {
      c.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      c.removeEventListener("lostpointercapture", onLostPointerCapture);
      c.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      c.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // Listener callbacks intentionally read current props through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clear() {
    clearCanvas();
    bufferRef.current = [];
    lastRef.current = null;
    activePointerRef.current = null;
    activeTouchIdRef.current = null;
    hasStartedStrokeRef.current = false;
    setRatio(0);
    onProgressRef.current?.(0);
    onEntropyRef.current(new Uint8Array());
  }

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-lg border border-border bg-background/60 overflow-hidden"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <canvas
          ref={canvasRef}
          className="block h-56 w-full cursor-crosshair select-none"
          style={{
            color: "var(--primary)",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            WebkitTapHighlightColor: "transparent",
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

