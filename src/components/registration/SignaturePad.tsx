import { useEffect, useImperativeHandle, useRef, forwardRef, useState, useCallback } from "react";
import { Eraser, PenLine, Undo2 } from "lucide-react";

export interface SignaturePadHandle {
  clear: () => void;
  undo: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
}

interface Props {
  height?: number;
  className?: string;
  /** Hide the built-in Undo / Clear toolbar (callers that render their own). */
  hideToolbar?: boolean;
  onChange?: (isEmpty: boolean) => void;
}

type Point = { x: number; y: number; w: number };
type Stroke = Point[];

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
  ({ height = 220, className, hideToolbar, onChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentRef = useRef<Stroke | null>(null);
    const [count, setCount] = useState(0);

    const setup = useCallback(() => {
      const c = canvasRef.current; if (!c) return null;
      const ctx = c.getContext("2d"); if (!ctx) return null;
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
      return { c, ctx };
    }, []);

    const redraw = useCallback(() => {
      const s = setup(); if (!s) return;
      const { c, ctx } = s;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
      for (const stroke of strokesRef.current) {
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineWidth = stroke[i].w;
          ctx.beginPath(); ctx.moveTo(stroke[i - 1].x, stroke[i - 1].y); ctx.lineTo(stroke[i].x, stroke[i].y); ctx.stroke();
        }
        if (stroke.length === 1) {
          ctx.beginPath(); ctx.arc(stroke[0].x, stroke[0].y, stroke[0].w / 2, 0, Math.PI * 2); ctx.fillStyle = "#0f172a"; ctx.fill();
        }
      }
    }, [setup]);

    const commit = useCallback(() => {
      const n = strokesRef.current.length;
      setCount(n);
      onChange?.(n === 0);
    }, [onChange]);

    const clear = useCallback(() => { strokesRef.current = []; redraw(); commit(); }, [redraw, commit]);
    const undo = useCallback(() => { strokesRef.current.pop(); redraw(); commit(); }, [redraw, commit]);

    useImperativeHandle(ref, () => ({
      clear,
      undo,
      isEmpty: () => strokesRef.current.length === 0,
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
    }), [clear, undo]);

    useEffect(() => {
      const resize = () => {
        const c = canvasRef.current; if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = c.getBoundingClientRect();
        c.width = rect.width * dpr; c.height = rect.height * dpr;
        c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
        redraw();
      };
      resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, [redraw]);

    const pos = (e: React.PointerEvent) => {
      const r = canvasRef.current!.getBoundingClientRect();
      const pressure = e.pressure || 0.5;
      const w = e.pointerType === "pen" ? Math.max(1.2, 3.2 * pressure) : 2.2;
      return { x: e.clientX - r.left, y: e.clientY - r.top, w };
    };

    const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      const p = pos(e); currentRef.current = [p]; strokesRef.current.push(currentRef.current);
      redraw();
    };
    const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const stroke = currentRef.current; if (!stroke) return;
      const s = setup(); if (!s) return;
      const p = pos(e); const last = stroke[stroke.length - 1];
      s.ctx.lineWidth = p.w;
      s.ctx.beginPath(); s.ctx.moveTo(last.x, last.y); s.ctx.lineTo(p.x, p.y); s.ctx.stroke();
      stroke.push(p);
    };
    const onUp = () => { if (currentRef.current) { currentRef.current = null; commit(); } };

    const empty = count === 0;

    return (
      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
          style={{ height, touchAction: "none" }}
          className={`block w-full cursor-crosshair bg-white ${className ?? ""}`}
          aria-label="Signature pad"
        />
        {/* Signing guide line */}
        <div className="pointer-events-none absolute inset-x-6 bottom-12 border-b border-dashed border-slate-300" />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
            <PenLine className="h-5 w-5" />
            <span className="text-xs font-medium">Sign here</span>
          </div>
        )}
        {!hideToolbar && (
          <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-500">{empty ? "Not signed yet" : "Signed — tap Clear to start again"}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={undo}
                disabled={empty}
                aria-label="Undo last stroke"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 transition-colors duration-150 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Undo2 className="h-4 w-4" /> Undo
              </button>
              <button
                type="button"
                onClick={clear}
                disabled={empty}
                aria-label="Clear signature"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-600 transition-colors duration-150 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eraser className="h-4 w-4" /> Clear
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
SignaturePad.displayName = "SignaturePad";
