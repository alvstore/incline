// Height entry for scans: centimetres or feet + inches. Always reports centimetres to the parent.
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cmToFeetInches,
  feetInchesToCm,
  formatFeetInches,
  isValidHeightCm,
  MAX_HEIGHT_CM,
  MIN_HEIGHT_CM,
} from "@/lib/scans/height";

type HeightUnit = "cm" | "ftin";
const UNIT_KEY = "incline.scanHeightUnit";

interface HeightInputProps {
  /** Height in centimetres as typed text ("" when empty). */
  valueCm: string;
  onChangeCm: (cm: string) => void;
  disabled?: boolean;
  hint: string;
}

function readUnit(): HeightUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === "ftin" ? "ftin" : "cm";
  } catch {
    return "cm";
  }
}

export function HeightInput({ valueCm, onChangeCm, disabled, hint }: HeightInputProps) {
  const id = useId();
  const [unit, setUnit] = useState<HeightUnit>(readUnit);
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");

  const cmNumber = Number.parseFloat(valueCm);
  const hasValidCm = isValidHeightCm(cmNumber);

  // Keep ft/in boxes in step with a cm value set from outside (prefill) or from the cm box.
  useEffect(() => {
    if (unit !== "ftin") return;
    if (!valueCm) return;
    const n = Number.parseFloat(valueCm);
    if (!Number.isFinite(n)) return;
    const current = feetInchesToCm(Number(feet) || 0, Number(inches) || 0);
    if (Math.abs(current - n) < 1.3) return; // already represents this height
    const fi = cmToFeetInches(n);
    setFeet(String(fi.feet));
    setInches(String(fi.inches));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCm, unit]);

  function switchUnit(next: HeightUnit) {
    setUnit(next);
    try { localStorage.setItem(UNIT_KEY, next); } catch { /* private mode */ }
    if (next === "ftin" && hasValidCm) {
      const fi = cmToFeetInches(cmNumber);
      setFeet(String(fi.feet));
      setInches(String(fi.inches));
    }
  }

  function updateFeetInches(nextFeet: string, nextInches: string) {
    setFeet(nextFeet);
    setInches(nextInches);
    const f = Number.parseInt(nextFeet, 10);
    const i = nextInches === "" ? 0 : Number.parseInt(nextInches, 10);
    if (!Number.isFinite(f) || !Number.isFinite(i) || i < 0 || i > 11) {
      onChangeCm("");
      return;
    }
    onChangeCm(String(feetInchesToCm(f, i)));
  }

  const conversion = hasValidCm
    ? unit === "cm"
      ? `≈ ${formatFeetInches(cmNumber)}`
      : `≈ ${cmNumber.toFixed(1)} cm`
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={unit === "cm" ? `${id}-cm` : `${id}-ft`}>Height</Label>
        <div
          className="inline-flex rounded-lg border border-border bg-muted p-0.5"
          role="radiogroup"
          aria-label="Height unit"
        >
          {(["cm", "ftin"] as HeightUnit[]).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              disabled={disabled}
              onClick={() => switchUnit(u)}
              className={`min-h-9 min-w-[64px] cursor-pointer rounded-md px-3 text-xs font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-success disabled:opacity-50 ${
                unit === u ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {u === "cm" ? "cm" : "ft / in"}
            </button>
          ))}
        </div>
      </div>

      {unit === "cm" ? (
        <div className="relative">
          <Input
            id={`${id}-cm`}
            type="number"
            inputMode="decimal"
            min={MIN_HEIGHT_CM}
            max={MAX_HEIGHT_CM}
            step={0.5}
            value={valueCm}
            disabled={disabled}
            onChange={(e) => onChangeCm(e.target.value)}
            placeholder="e.g. 164"
            className="h-12 pr-12"
            aria-describedby={`${id}-hint`}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">cm</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <Input
              id={`${id}-ft`}
              type="number"
              inputMode="numeric"
              min={3}
              max={8}
              step={1}
              value={feet}
              disabled={disabled}
              onChange={(e) => updateFeetInches(e.target.value, inches)}
              placeholder="5"
              className="h-12 pr-10"
              aria-label="Feet"
              aria-describedby={`${id}-hint`}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">ft</span>
          </div>
          <div className="relative">
            <Input
              id={`${id}-in`}
              type="number"
              inputMode="numeric"
              min={0}
              max={11}
              step={1}
              value={inches}
              disabled={disabled}
              onChange={(e) => updateFeetInches(feet, e.target.value)}
              placeholder="6"
              className="h-12 pr-10"
              aria-label="Inches"
              aria-describedby={`${id}-hint`}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">in</span>
          </div>
        </div>
      )}

      <p id={`${id}-hint`} className="text-xs text-muted-foreground" aria-live="polite">
        {conversion && <span className="mr-1 font-medium tabular-nums text-foreground">{conversion}.</span>}
        {hint}
      </p>
    </div>
  );
}
