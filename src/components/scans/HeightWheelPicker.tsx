import { useId, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Minus, Plus, Keyboard, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeightInput } from "./HeightInput";
import { formatFeetInches, isValidHeightCm, MIN_HEIGHT_CM, MAX_HEIGHT_CM } from "@/lib/scans/height";
import "./HeightWheelPicker.css";

interface HeightWheelPickerProps {
  valueCm: string;
  onChangeCm: (cm: string) => void;
  disabled?: boolean;
  hint: string;
}

const ROW_HEIGHT = 44;
const heights = Array.from({ length: MAX_HEIGHT_CM - MIN_HEIGHT_CM + 1 }, (_, i) => MIN_HEIGHT_CM + i);

/** Native scroll snapping owns gestures; GSAP only animates presentation. Manual entry is the fallback. */
export function HeightWheelPicker({ valueCm, onChangeCm, disabled, hint }: HeightWheelPickerProps) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const interacting = useRef(false);
  const [manual, setManual] = useState(false);
  const parsed = Number.parseFloat(valueCm);
  const valid = isValidHeightCm(parsed);
  const selected = valid ? parsed : 170;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useLayoutEffect(() => {
    if (!track.current || manual || interacting.current) return;
    track.current.scrollTop = (Math.round(selected) - MIN_HEIGHT_CM) * ROW_HEIGHT;
  }, [selected, manual]);

  useLayoutEffect(() => {
    if (!readout.current || reducedMotion()) return;
    const animation = gsap.fromTo(readout.current, { y: 3, opacity: 0.7 }, { y: 0, opacity: 1, duration: 0.18, ease: "power2.out" });
    return () => { animation.kill(); };
  }, [valueCm]);

  function choose(cm: number) {
    if (disabled) return;
    interacting.current = false;
    const next = Math.min(MAX_HEIGHT_CM, Math.max(MIN_HEIGHT_CM, Math.round(cm)));
    onChangeCm(String(next));
    track.current?.scrollTo({ top: (next - MIN_HEIGHT_CM) * ROW_HEIGHT, behavior: reducedMotion() ? "instant" : "smooth" });
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="flex items-center gap-2 text-sm font-semibold"><Ruler className="h-4 w-4 text-primary" />Height</span>
        <Button variant="ghost" className="min-h-11 px-2 text-xs" disabled={disabled} aria-pressed={manual} onClick={() => setManual(!manual)}>
          {manual ? <Ruler /> : <Keyboard />}{manual ? "Scroll height" : "Enter height"}
        </Button>
      </div>
      {manual ? <HeightInput valueCm={valueCm} onChangeCm={onChangeCm} disabled={disabled} hint={hint} /> : <>
        <div ref={readout} className="text-center" aria-live="off">
          <p className="text-3xl font-bold tabular-nums text-foreground">{valid ? `${selected} cm` : "Select height"}</p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{valid ? `≈ ${formatFeetInches(selected)}` : "cm · feet & inches"}</p>
        </div>
        <div className="height-wheel relative overflow-hidden rounded-xl bg-card">
          <div className="pointer-events-none absolute inset-x-0 top-[88px] h-11 rounded-lg border-y border-primary/30 bg-primary/10" />
          <div ref={track} role="slider" tabIndex={disabled ? -1 : 0} aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}
            aria-valuemin={MIN_HEIGHT_CM} aria-valuemax={MAX_HEIGHT_CM} aria-valuenow={selected} aria-valuetext={`${selected} centimetres, approximately ${formatFeetInches(selected)}${valid ? "" : ", not yet confirmed"}`} aria-orientation="vertical" aria-disabled={disabled}
            className={`height-wheel-track relative h-[220px] overflow-y-auto rounded-xl py-[88px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${disabled ? "pointer-events-none opacity-50" : ""}`}
            onPointerDown={() => { interacting.current = true; }} onWheel={() => { interacting.current = true; }}
            onScroll={(event) => {
              if (!interacting.current || disabled) return;
              const cm = MIN_HEIGHT_CM + Math.round(event.currentTarget.scrollTop / ROW_HEIGHT);
              if (isValidHeightCm(cm) && String(cm) !== valueCm) onChangeCm(String(cm));
            }}
            onKeyDown={(event) => {
              const keys: Record<string, number> = { ArrowUp: selected - 1, ArrowDown: selected + 1, ArrowLeft: selected - 1, ArrowRight: selected + 1, PageUp: selected - 5, PageDown: selected + 5, Home: MIN_HEIGHT_CM, End: MAX_HEIGHT_CM };
              if (event.key in keys) { event.preventDefault(); choose(keys[event.key]); }
            }}>
            {heights.map(cm => <div key={cm} aria-hidden="true" className={`height-wheel-row flex h-11 items-center justify-center gap-4 tabular-nums ${Math.round(selected) === cm ? "font-semibold text-primary" : "text-muted-foreground"}`}>
              <span className="h-px w-5 bg-border" /><span className="w-16 text-right text-lg">{cm} <span className="text-xs">cm</span></span>
              <span className="w-24 text-left text-xs">{formatFeetInches(cm)}</span><span className="h-px w-5 bg-border" />
            </div>)}
          </div>
          <div className="height-wheel-mask pointer-events-none absolute inset-0" />
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-11 w-11" disabled={disabled || selected <= MIN_HEIGHT_CM} aria-label="Decrease height by one centimetre" onClick={() => choose(selected - 1)}><Minus /></Button>
          <Button variant={valid ? "secondary" : "default"} className="min-h-11 min-w-32 tabular-nums" disabled={disabled} onClick={() => choose(selected)}>{valid ? `${selected} cm` : `Use ${selected} cm`}</Button>
          <Button variant="outline" size="icon" className="h-11 w-11" disabled={disabled || selected >= MAX_HEIGHT_CM} aria-label="Increase height by one centimetre" onClick={() => choose(selected + 1)}><Plus /></Button>
        </div>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      </>}
    </div>
  );
}