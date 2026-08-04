import { Flame, Trophy, Activity, Heart, type LucideIcon } from "lucide-react";

/**
 * Canonical PAR-Q (Physical Activity Readiness Questionnaire) — 7 questions.
 * Used by both the public self-onboarding flow (/register) and the staff
 * Member Registration drawer. DO NOT fork this list.
 */
export const PARQ_QUESTIONS: readonly string[] = [
  "Has a doctor ever said you have a heart condition?",
  "Do you feel chest pain when you do physical activity?",
  "Have you had chest pain when not doing physical activity in the last month?",
  "Do you lose balance because of dizziness or lose consciousness?",
  "Do you have a bone or joint problem worsened by exercise?",
  "Are you currently on prescribed medication for blood pressure or heart?",
  "Do you know any other reason you should not do physical activity?",
] as const;

export const PRIMARY_GOALS: readonly { key: string; icon: LucideIcon }[] = [
  { key: "Weight Loss", icon: Flame },
  { key: "Muscle Gain", icon: Trophy },
  { key: "Endurance", icon: Activity },
  { key: "General Fitness", icon: Heart },
] as const;

export const MORE_GOALS: readonly string[] = ["Flexibility", "Body Recomposition"] as const;

export const ALL_GOALS: readonly string[] = [
  ...PRIMARY_GOALS.map((g) => g.key),
  ...MORE_GOALS,
] as const;

export const NO_HEALTH_CONDITION = "None / no known conditions";

export const HEALTH_CONDITION_OPTIONS: readonly string[] = [
  NO_HEALTH_CONDITION,
  "Diabetes",
  "Hypertension / High BP",
  "Heart condition",
  "Asthma / Respiratory",
  "Thyroid disorder",
  "Back / Spine pain",
  "Knee / Joint injury",
  "Shoulder injury",
  "Recent surgery",
  "Pregnancy",
  "PCOS / PCOD",
  "Cholesterol",
  "Migraine",
  "Other",
] as const;

/**
 * Parse the comma-joined `members.health_conditions` string back into chip
 * selections. Anything matching `Other: <text>` is split out.
 */
export function parseHealthConditions(raw?: string | null): {
  selected: string[];
  other: string;
} {
  if (!raw) return { selected: [], other: "" };
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const selected: string[] = [];
  let other = "";
  for (const p of parts) {
    if (p.toLowerCase().startsWith("other:")) {
      other = p.slice(p.indexOf(":") + 1).trim();
      if (!selected.includes("Other")) selected.push("Other");
    } else if (HEALTH_CONDITION_OPTIONS.includes(p)) {
      selected.push(p);
    } else {
      // Free-text legacy values become Other
      other = other ? `${other}, ${p}` : p;
      if (!selected.includes("Other")) selected.push("Other");
    }
  }
  return { selected, other };
}

export function joinHealthConditions(selected: string[], other: string): string {
  const out = selected
    .map((s) => (s === "Other" && other.trim() ? `Other: ${other.trim()}` : s))
    .filter((s) => s !== "Other");
  return out.join(", ");
}
