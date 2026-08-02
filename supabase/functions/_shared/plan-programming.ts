// plan-programming v1.0.0 — goal-specific training/nutrition parameter blocks.
// The AI was previously given the goal as a passive bullet, which produced
// near-identical plans for "Weight Loss" and "Muscle Gain". This module turns
// the goal into a HARD parameter contract injected at the TOP of the prompt.

export type GoalKey =
  | "fat_loss"
  | "muscle_gain"
  | "strength"
  | "recomposition"
  | "endurance"
  | "general";

export interface TrainingParams {
  key: GoalKey;
  label: string;
  split: string;
  repRange: string;
  restRange: string;
  tempo: string;
  weeklySetsPerMuscle: string;
  conditioning: string;
  intensity: string;
  finisher: string;
  forbid: string;
}

export interface NutritionParams {
  key: GoalKey;
  label: string;
  calorieDelta: string;
  macroSplit: string;
  proteinTarget: string;
  mealPattern: string;
  emphasis: string;
  forbid: string;
}

const TRAINING: Record<GoalKey, TrainingParams> = {
  fat_loss: {
    key: "fat_loss",
    label: "Fat loss / weight loss",
    split: "Full-body or upper/lower circuits — high density, minimal machine queueing.",
    repRange: "12-20 reps on isolation, 10-15 on compounds",
    restRange: "30-60s between sets, 60-90s only on heavy compounds",
    tempo: "2-0-1 controlled, no long pauses — keep heart rate elevated",
    weeklySetsPerMuscle: "8-12 hard sets per muscle (moderate volume, high density)",
    conditioning:
      "MANDATORY: 15-25 min conditioning on 3+ sessions (incline treadmill walk, rower, bike intervals, sled) plus 8-10k daily steps in notes.",
    intensity: "RPE 7-8, leave 2-3 reps in reserve so daily output stays high",
    finisher: "Every session ends with a 5-8 min metabolic finisher or circuit.",
    forbid:
      "Do NOT prescribe low-rep (1-5) maximal strength work, do NOT use 3+ minute rest periods, do NOT build a 5-6 day bodybuilding bro-split.",
  },
  muscle_gain: {
    key: "muscle_gain",
    label: "Muscle gain / hypertrophy",
    split: "Push / Pull / Legs or Upper-Lower — each muscle trained 2x per week.",
    repRange: "6-12 reps on compounds, 10-15 on isolation",
    restRange: "90-150s on compounds, 60-90s on isolation",
    tempo: "3-1-1 with an emphasised eccentric and a 1s stretch pause",
    weeklySetsPerMuscle: "14-20 hard sets per muscle (high volume)",
    conditioning:
      "Cardio is MINIMAL: at most 10-15 min low-intensity after lifting, or a short warm-up only. Never let conditioning cut into lifting volume.",
    intensity: "RPE 8-9, last 1-2 sets taken to 0-1 reps in reserve",
    finisher: "Finish each session with a targeted pump/stretch set for the trained muscle.",
    forbid:
      "Do NOT prescribe circuits, HIIT finishers, metabolic conditioning, or short 30s rest periods. Do NOT build a full-body-every-day plan.",
  },
  strength: {
    key: "strength",
    label: "Maximal strength",
    split: "Upper/Lower or full-body around squat, hinge, press and pull.",
    repRange: "3-6 reps on primary lifts, 6-10 on accessories",
    restRange: "180-240s on primary lifts, 90-120s on accessories",
    tempo: "Controlled eccentric, explosive concentric intent",
    weeklySetsPerMuscle: "10-14 hard sets, heavily weighted toward the main lifts",
    conditioning: "Optional 10 min easy aerobic work; never before the main lift.",
    intensity: "80-90% 1RM on primaries, RPE 7-9",
    finisher: "No metabolic finishers — end with core bracing or carries.",
    forbid: "Do NOT prescribe high-rep burnout sets or circuits on primary lifts.",
  },
  recomposition: {
    key: "recomposition",
    label: "Body recomposition",
    split: "Upper/Lower 4x per week with one conditioning day.",
    repRange: "8-12 reps, occasional 5-6 rep strength sets on the main lift",
    restRange: "75-120s",
    tempo: "2-1-1 with a controlled eccentric",
    weeklySetsPerMuscle: "12-16 hard sets per muscle",
    conditioning: "10-20 min zone-2 cardio after 2-3 sessions per week.",
    intensity: "RPE 8, progressive load week over week",
    finisher: "Alternate pump finishers and short conditioning blocks.",
    forbid: "Do NOT run a pure fat-loss circuit plan or a pure powerlifting plan.",
  },
  endurance: {
    key: "endurance",
    label: "Endurance / stamina",
    split: "2-3 resistance sessions plus 3 dedicated cardio sessions.",
    repRange: "15-25 reps, muscular endurance focus",
    restRange: "30-45s",
    tempo: "Steady 2-0-2, rhythmic",
    weeklySetsPerMuscle: "8-10 hard sets per muscle",
    conditioning:
      "PRIMARY DRIVER: intervals, tempo work and one long steady session weekly with explicit durations and target effort.",
    intensity: "RPE 6-7 on lifting, prescribed heart-rate zones on cardio",
    finisher: "Core and mobility circuit at the end of lifting days.",
    forbid: "Do NOT prescribe heavy low-rep lifting or long 2-3 min rest periods.",
  },
  general: {
    key: "general",
    label: "General fitness",
    split: "Full-body 3x per week or upper/lower 4x.",
    repRange: "8-15 reps",
    restRange: "60-90s",
    tempo: "2-0-2 controlled",
    weeklySetsPerMuscle: "10-14 hard sets per muscle",
    conditioning: "10-15 min cardio on 2-3 days plus mobility work.",
    intensity: "RPE 7, technique-first",
    finisher: "Mobility / stretching cooldown.",
    forbid: "Do NOT prescribe advanced intensity techniques or maximal-load work.",
  },
};

const NUTRITION: Record<GoalKey, NutritionParams> = {
  fat_loss: {
    key: "fat_loss",
    label: "Fat loss / weight loss",
    calorieDelta: "15-20% BELOW maintenance (a real deficit — state the number)",
    macroSplit: "Protein 35-40% · Carbs 30-35% · Fat 25-30%",
    proteinTarget: "1.8-2.2 g per kg bodyweight",
    mealPattern: "3 main meals + 1 light snack; high-volume, high-fibre, low calorie density",
    emphasis:
      "Lean protein at every meal, vegetables at lunch and dinner, carbs concentrated around training, minimal added fats and sugars.",
    forbid: "Do NOT prescribe calorie surplus, mass-gainer shakes, or ghee/oil-heavy dishes at every meal.",
  },
  muscle_gain: {
    key: "muscle_gain",
    label: "Muscle gain / hypertrophy",
    calorieDelta: "10-15% ABOVE maintenance (a genuine surplus — state the number)",
    macroSplit: "Protein 30% · Carbs 45-50% · Fat 20-25%",
    proteinTarget: "1.6-2.2 g per kg bodyweight",
    mealPattern: "3 main meals + 2-3 calorie-dense snacks, including a post-workout meal",
    emphasis:
      "Carb-forward meals around training, calorie-dense additions (nuts, nut butter, whole milk, paneer, ghee), never rely on vegetables for volume.",
    forbid: "Do NOT prescribe a calorie deficit, salad-based meals, or fasting windows.",
  },
  strength: {
    key: "strength",
    label: "Maximal strength",
    calorieDelta: "At or slightly above maintenance (0 to +10%)",
    macroSplit: "Protein 30% · Carbs 45% · Fat 25%",
    proteinTarget: "1.6-2.0 g per kg bodyweight",
    mealPattern: "3 main meals + 2 snacks, larger pre-training carb feed",
    emphasis: "Consistent carbohydrate availability, creatine and electrolytes noted in supplements.",
    forbid: "Do NOT prescribe an aggressive deficit.",
  },
  recomposition: {
    key: "recomposition",
    label: "Body recomposition",
    calorieDelta: "Maintenance on training days, 10% below on rest days (state both)",
    macroSplit: "Protein 35% · Carbs 35% · Fat 30%",
    proteinTarget: "2.0-2.4 g per kg bodyweight",
    mealPattern: "3 main meals + 1-2 protein-led snacks; carbs cycled to training days",
    emphasis: "High protein every meal, carb timing around sessions.",
    forbid: "Do NOT prescribe either an aggressive deficit or a large surplus.",
  },
  endurance: {
    key: "endurance",
    label: "Endurance / stamina",
    calorieDelta: "Maintenance or slightly above on long-session days",
    macroSplit: "Protein 25% · Carbs 55% · Fat 20%",
    proteinTarget: "1.4-1.8 g per kg bodyweight",
    mealPattern: "3 main meals + 2-3 carb snacks, pre and intra-session fuelling noted",
    emphasis: "Carbohydrate availability, sodium and hydration guidance, easily digestible pre-session food.",
    forbid: "Do NOT prescribe low-carb or keto patterns.",
  },
  general: {
    key: "general",
    label: "General health",
    calorieDelta: "Approximately maintenance",
    macroSplit: "Protein 30% · Carbs 40% · Fat 30%",
    proteinTarget: "1.2-1.6 g per kg bodyweight",
    mealPattern: "3 balanced meals + 1-2 snacks",
    emphasis: "Whole foods, fibre, variety across the week.",
    forbid: "Do NOT prescribe extreme deficits or surpluses.",
  },
};

/** Map free-text goal strings onto a programming key. */
export function resolveGoalKey(raw?: string | null): GoalKey {
  const g = (raw ?? "").toLowerCase();
  if (!g.trim()) return "general";
  if (/recomp/.test(g)) return "recomposition";
  if (/(fat\s*loss|weight\s*loss|lose\s*weight|slim|cut(ting)?|lean\s*down|reduce\s*(fat|weight))/.test(g))
    return "fat_loss";
  if (/(muscle|hypertroph|bulk|mass|size|gain\s*weight|body\s*build)/.test(g)) return "muscle_gain";
  if (/(strength|powerlift|1rm|strong)/.test(g)) return "strength";
  if (/(endurance|stamina|cardio|marathon|run|cycl|athletic)/.test(g)) return "endurance";
  if (/(tone|tonin|shape|fitness|health|mobility|flexib)/.test(g)) return "general";
  return "general";
}

export function trainingParams(key: GoalKey): TrainingParams {
  return TRAINING[key];
}

export function nutritionParams(key: GoalKey): NutritionParams {
  return NUTRITION[key];
}

/** The directive block that goes FIRST in the user message. */
export function goalDirective(
  type: "workout" | "diet",
  key: GoalKey,
  rawGoal?: string | null,
): string {
  if (type === "workout") {
    const p = TRAINING[key];
    return [
      `PRIMARY GOAL — ${p.label.toUpperCase()}${rawGoal ? ` (member wrote: "${rawGoal}")` : ""}`,
      `This goal DICTATES the entire program. A plan that would also suit a different goal is a FAILED plan.`,
      `Non-negotiable programming parameters:`,
      `• Split / structure: ${p.split}`,
      `• Rep range: ${p.repRange}`,
      `• Rest between sets: ${p.restRange} (write this in the "rest" field, matching this range)`,
      `• Tempo & execution: ${p.tempo}`,
      `• Weekly volume: ${p.weeklySetsPerMuscle}`,
      `• Intensity: ${p.intensity}`,
      `• Conditioning: ${p.conditioning}`,
      `• Session ending: ${p.finisher}`,
      `• PROHIBITED: ${p.forbid}`,
      `State the goal explicitly in "goal" and reflect it in "name" and "description".`,
    ].join("\n");
  }
  const p = NUTRITION[key];
  return [
    `PRIMARY GOAL — ${p.label.toUpperCase()}${rawGoal ? ` (member wrote: "${rawGoal}")` : ""}`,
    `This goal DICTATES calories, macros and food selection. A plan that would also suit a different goal is a FAILED plan.`,
    `Non-negotiable nutrition parameters:`,
    `• Calorie position: ${p.calorieDelta}`,
    `• Macro split: ${p.macroSplit}`,
    `• Protein target: ${p.proteinTarget}`,
    `• Meal pattern: ${p.mealPattern}`,
    `• Food emphasis: ${p.emphasis}`,
    `• PROHIBITED: ${p.forbid}`,
    `Set "type" to the value matching this goal and reflect it in "name" and "description".`,
  ].join("\n");
}

/** Deterministic small integer from a string — used as a variety seed. */
export function varietySeed(...parts: (string | number | null | undefined)[]): number {
  const s = parts.filter((p) => p !== null && p !== undefined).join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const VARIETY_ANGLES = [
  "Lead each session with a different primary movement pattern than the most obvious choice.",
  "Prioritise unilateral (single-limb) work for at least one exercise per session.",
  "Order the session heaviest-first, then pair antagonist muscles.",
  "Use a pre-exhaust order on one muscle group per session (isolation before compound).",
  "Include one loaded-carry or core-stability movement in every session.",
  "Vary the equipment class across sessions — machine, cable, free-weight — instead of repeating one class.",
];

/** Rotating stylistic angle so two members with the same goal don't get identical plans. */
export function varietyAngle(seed: number): string {
  return VARIETY_ANGLES[seed % VARIETY_ANGLES.length];
}
