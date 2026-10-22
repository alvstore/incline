// scan-glossary v1.0.0 — units, reference ranges and plain-language meaning for
// every HOWBODY value. Mirrored in src/lib/scans/glossary.ts (keep in sync).
export type Sex = "male" | "female";
export type Zone = "low" | "normal" | "high";

export interface GlossaryEntry {
  key: string;
  label: string;
  unit?: string;
  meaning: string;
  /** Reference band; absolute=true compares |value| (deviation from neutral). */
  band?: (sex: Sex) => { low: number; high: number } | null;
  absolute?: boolean;
}

export const BODY_GLOSSARY: GlossaryEntry[] = [
  { key: "weight", label: "Weight", unit: "kg", meaning: "Total body weight on the scanner." },
  { key: "bmi", label: "BMI", unit: "kg/m2", meaning: "Weight relative to height. A quick screen, but it cannot tell muscle from fat.", band: () => ({ low: 18.5, high: 24.9 }) },
  { key: "pbf", label: "Body fat", unit: "%", meaning: "Share of your weight that is fat tissue. More useful than BMI for tracking progress.", band: (s) => (s === "female" ? { low: 21, high: 33 } : { low: 10, high: 20 }) },
  { key: "fat", label: "Fat mass", unit: "kg", meaning: "Total kilograms of body fat." },
  { key: "smm", label: "Skeletal muscle mass", unit: "kg", meaning: "Muscle you train and move with. Higher supports strength, metabolism and joints.", band: (s) => (s === "female" ? { low: 22, high: 32 } : { low: 30, high: 42 }) },
  { key: "tbw", label: "Total body water", unit: "kg", meaning: "All water in the body. Mostly held in muscle, so it rises as muscle grows." },
  { key: "icf", label: "Intracellular fluid", unit: "L", meaning: "Water inside your cells, a sign of healthy, well-fed muscle." },
  { key: "ecf", label: "Extracellular fluid", unit: "L", meaning: "Water outside your cells. Relative to ICF it reflects balance and recovery." },
  { key: "pr", label: "Protein", unit: "kg", meaning: "Protein stored in the body, mostly in muscle." },
  { key: "vfr", label: "Visceral fat rating", meaning: "Fat stored around internal organs. Keeping it low matters more than overall weight.", band: () => ({ low: 1, high: 9 }) },
  { key: "whr", label: "Waist-to-hip ratio", meaning: "Waist size compared with hips. Higher values mean more fat around the middle.", band: (s) => (s === "female" ? { low: 0.65, high: 0.85 } : { low: 0.7, high: 0.9 }) },
  { key: "bmr", label: "Basal metabolic rate", unit: "kcal", meaning: "Calories your body burns at complete rest each day. Muscle raises it." },
  { key: "metabolic_age", label: "Metabolic age", unit: "yrs", meaning: "Your metabolism compared with typical people by age. Lower than your real age is good." },
  { key: "health_score", label: "Health score", unit: "/100", meaning: "Overall body-composition score combining muscle, fat and water balance.", band: () => ({ low: 70, high: 100 }) },
];

export const POSTURE_GLOSSARY: GlossaryEntry[] = [
  { key: "score", label: "Posture score", unit: "/100", meaning: "Overall alignment score. Higher means closer to neutral standing posture.", band: () => ({ low: 80, high: 100 }) },
  { key: "head_forward", label: "Head forward", unit: "cm", absolute: true, meaning: "How far your head sits in front of your shoulders. Common with phone and desk work.", band: () => ({ low: 0, high: 2 }) },
  { key: "head_slant", label: "Head tilt", unit: "deg", absolute: true, meaning: "Sideways tilt of the head. Small values are normal.", band: () => ({ low: 0, high: 2 }) },
  { key: "high_low_shoulder", label: "Shoulder level", unit: "deg", absolute: true, meaning: "Height difference between left and right shoulder.", band: () => ({ low: 0, high: 2 }) },
  { key: "body_slope", label: "Body lean", unit: "deg", absolute: true, meaning: "How much the whole body leans away from vertical when standing.", band: () => ({ low: 0, high: 2 }) },
  { key: "pelvis_forward", label: "Pelvis angle", unit: "deg", meaning: "Pelvis position from the side. About 180 is neutral; lower means it tips forward.", band: () => ({ low: 172, high: 188 }) },
];

export function zoneFor(e: GlossaryEntry, value: number | null | undefined, sex: Sex): Zone | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const b = e.band?.(sex);
  if (!b) return null;
  const v = e.absolute ? Math.abs(Number(value)) : Number(value);
  if (v < b.low) return "low";
  if (v > b.high) return "high";
  return "normal";
}

export function round1(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? (Math.abs(n) < 2 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10) : null;
}

/** Segment arrays from HOWBODY payload: [leftArm, rightArm, trunk, leftLeg, rightLeg]. */
export function parseSegments(raw: unknown): number[] | null {
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length === 5 && arr.every((x) => Number.isFinite(Number(x)))) return arr.map(Number);
  } catch { /* ignore */ }
  return null;
}
