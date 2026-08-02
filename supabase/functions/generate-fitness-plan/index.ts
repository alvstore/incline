// generate-fitness-plan v4.0.0 — goal-driven programming contract, equipment
// enforcement with substitution, periodised (non-cloned) week expansion,
// deterministic variety seeding and a differentiation guard.
// v3.0.0 — single-week generation + server-side week expansion,
// dynamic token budget, resilient JSON parsing/repair and shape validation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { generateOnce } from "../_shared/ai-runtime.ts";
import {
  goalDirective,
  nutritionParams,
  resolveGoalKey,
  trainingParams,
  varietyAngle,
  varietySeed,
} from "../_shared/plan-programming.ts";
const serve = Deno.serve;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_AI_ROLES = ["owner", "admin", "manager"] as const;

/** Strip markdown fences and repair a truncated JSON object by closing
 * any still-open strings/arrays/objects. Returns null when unrecoverable. */
function parsePlanJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = s.indexOf("{");
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s); } catch { /* attempt repair */ }

  // Bracket-balanced repair for truncated output.
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") { stack.pop(); lastSafe = i; }
    else if (c === "," && stack.length) lastSafe = Math.max(lastSafe, i - 1);
  }
  if (lastSafe < 0) return null;
  let candidate = s.slice(0, lastSafe + 1);
  // Recompute the open stack for the truncated candidate.
  const stack2: string[] = [];
  inStr = false; esc = false;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack2.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack2.pop();
  }
  if (inStr) candidate += '"';
  while (stack2.length) candidate += stack2.pop();
  try { return JSON.parse(candidate); } catch { return null; }
}

/** Returns an error string when the plan is structurally unusable. */
function validatePlanShape(type: "workout" | "diet", plan: any): string | null {
  if (!plan || typeof plan !== "object") return "AI returned no plan object";
  if (type === "workout") {
    const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];
    const days = weeks[0]?.days;
    if (!Array.isArray(days) || days.length === 0) return "AI returned no training days";
    const hasExercises = days.some((d: any) => Array.isArray(d?.exercises) && d.exercises.length > 0);
    if (!hasExercises) return "AI returned days without any exercises";
  } else {
    const meals = Array.isArray(plan.meals) ? plan.meals : [];
    if (meals.length === 0) return "AI returned no meal days";
    const hasSlots = meals.some((d: any) =>
      ["breakfast", "lunch", "dinner", "snack1", "snack2"].some((k) => d?.[k])
    );
    if (!hasSlots) return "AI returned meal days without any meals";
  }
  return null;
}

/** Periodised week expansion. Instead of cloning week 1 verbatim we wave the
 * volume/intensity, rotate the exercise order, and inject a deload — so weeks
 * 2..N read as a real progression rather than the same page repeated. */
function expandWeeks(plan: any, durationWeeks: number, goalKey: string, seed: number) {
  const base = plan?.weeks?.[0];
  if (!base || durationWeeks <= 1) return;

  const isFatLoss = goalKey === "fat_loss" || goalKey === "endurance";
  const out = [{ ...base, week: 1, phase: "Accumulation — establish technique and baseline loads" }];

  for (let w = 2; w <= durationWeeks; w++) {
    const cloned = JSON.parse(JSON.stringify(base));
    cloned.week = w;
    const isDeload = w % 4 === 0;

    if (isDeload) {
      cloned.phase = "Deload — recover and resensitise";
      cloned.progression = isFatLoss
        ? "Deload: keep the sessions but cut conditioning volume by half and stay at RPE 6."
        : "Deload: reduce load ~40% and drop one set per exercise. Keep movement quality high.";
    } else {
      const block = Math.ceil(w / 4);
      cloned.phase = block <= 1 ? "Accumulation" : block === 2 ? "Intensification" : "Peak";
      cloned.progression = isFatLoss
        ? w % 4 === 2
          ? "Add 1-2 reps per set OR shave 10s off rest vs. last week — increase density, not load."
          : "Add one conditioning interval and hold the same loads with tighter rest."
        : w % 4 === 2
          ? "Add 2.5-5% load per exercise, keep reps the same."
          : "Add one working set to the two main compounds, or 1-2 reps per set.";
    }

    // Rotate exercise order within each day so the session doesn't feel identical.
    (cloned.days || []).forEach((d: any, dayIdx: number) => {
      const ex = Array.isArray(d.exercises) ? d.exercises : [];
      if (!isDeload && ex.length > 2) {
        const shift = (w + dayIdx + seed) % ex.length;
        d.exercises = [...ex.slice(shift), ...ex.slice(0, shift)];
      }
      if (isDeload) {
        d.exercises = (d.exercises || []).map((e: any) => ({
          ...e,
          sets: typeof e.sets === "number" && e.sets > 1 ? e.sets - 1 : e.sets,
        }));
      }
      (d.exercises || []).forEach((e: any) => {
        e.notes = [e.notes, cloned.progression].filter(Boolean).join(" • ");
      });
    });
    out.push(cloned);
  }
  plan.weeks = out;
}

/** Flat list of exercise names in a plan — used for the differentiation guard. */
function exerciseSignature(plan: any): string[] {
  const names: string[] = [];
  for (const wk of plan?.weeks ?? []) {
    for (const d of wk?.days ?? []) {
      for (const e of d?.exercises ?? []) {
        if (e?.name) names.push(String(e.name).toLowerCase().trim());
      }
    }
  }
  return [...new Set(names)];
}

/** Normalise a machine label for matching: strip brands, model codes, symbols. */
function normaliseEquip(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(panatta|realleader|booty builder|relax|technogym|hammer strength|life ?fitness|cybex|matrix)\b/g, " ")
    .replace(/\b[a-z]{0,3}\d[a-z0-9-]*\b/g, " ") // model codes like 1FW026, APT-128
    .replace(/[^a-z ]/g, " ")
    .replace(/\b(machine|pro|plus|series|new|gym|the|with|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length > 2));
  const tb = new Set(b.split(" ").filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  ta.forEach((t) => { if (tb.has(t)) hit++; });
  return hit / Math.min(ta.size, tb.size);
}

/**
 * Enforce that every prescribed machine actually exists in the branch.
 * Unmatched machines are substituted with the closest owned machine that trains
 * the same muscle group, or downgraded to bodyweight/free-weight ("").
 */
function enforceEquipment(plan: any, inventory: EquipmentLite[]) {
  if (!Array.isArray(plan?.weeks) || inventory.length === 0) return null;
  const index = inventory.map((e) => ({
    raw: e.name,
    norm: normaliseEquip(e.name),
    muscles: (e.muscle_groups || []).map((m) => String(m).toLowerCase()),
    pattern: (e.movement_pattern || "").toLowerCase(),
  }));

  let matched = 0, substituted = 0, dropped = 0, total = 0;

  const resolve = (equip: string, exerciseName: string) => {
    const n = normaliseEquip(equip);
    if (!n) return { value: "", kind: "bodyweight" as const };
    const exact = index.find((i) => i.norm === n);
    if (exact) return { value: exact.raw, kind: "matched" as const };
    const partial = index
      .map((i) => ({ i, score: tokenOverlap(n, i.norm) }))
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score)[0];
    if (partial) return { value: partial.i.raw, kind: "matched" as const };
    // Substitute by exercise-name / muscle affinity.
    const en = normaliseEquip(exerciseName);
    const byName = index
      .map((i) => ({ i, score: Math.max(tokenOverlap(en, i.norm), tokenOverlap(en, i.muscles.join(" "))) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)[0];
    if (byName) return { value: byName.i.raw, kind: "substituted" as const };
    return { value: "", kind: "dropped" as const };
  };

  const walkDays = (days: any[]) => {
    for (const d of days ?? []) {
      for (const e of d?.exercises ?? []) {
        if (typeof e !== "object" || e === null) continue;
        total++;
        const r = resolve(e.equipment ?? "", e.name ?? "");
        if (r.kind === "matched") { matched++; e.equipment = r.value; }
        else if (r.kind === "substituted") {
          substituted++;
          e.equipment = r.value;
          e.substituted_from = e.equipment_original ?? null;
          e.notes = [e.notes, `Substituted to available machine: ${r.value}`].filter(Boolean).join(" • ");
        } else if (r.kind === "dropped") {
          dropped++;
          e.equipment = "";
          e.notes = [e.notes, "Perform with free weights / bodyweight — no matching machine on site."].filter(Boolean).join(" • ");
        } else {
          matched++;
          e.equipment = "";
        }
      }
    }
  };

  for (const wk of plan.weeks) walkDays(wk?.days ?? []);
  for (const v of plan?.rotation?.variants ?? []) walkDays(v?.days ?? []);

  const summary = { matched, substituted, dropped, total, inventory: inventory.length };
  plan.equipmentMatchSummary = summary;
  return summary;
}



interface CatalogMeal {
  id: string;
  name: string;
  meal_type?: string | null;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  default_quantity?: string | null;
}

interface EquipmentLite {
  name: string;
  category?: string | null;
  primary_category?: string | null;
  muscle_groups?: string[] | null;
  movement_pattern?: string | null;
  brand?: string | null;
  model?: string | null;
}

interface GeneratePlanRequest {
  type: "workout" | "diet";
  memberInfo: {
    name?: string;
    age?: number;
    gender?: string;
    height?: number;
    weight?: number;
    fitnessGoals?: string;
    healthConditions?: string;
    experience?: string;
    preferences?: string;
  };
  durationWeeks?: number;
  /** Workout sessions per week (1-7). */
  daysPerWeek?: number;
  /** If > 0, the workout plan must include a `rotation` array of variant
   * blocks that the dashboard cycles through every N days. 0 = no rotation. */
  rotationIntervalDays?: number;
  caloriesTarget?: number;
  /** Optional list of meals from the gym's meal_catalog the AI should
   * prefer when composing diet plans. Items the AI proposes outside of
   * this list are flagged as `unmatched` so the trainer can review. */
  availableMeals?: CatalogMeal[];
  /** Optional list of branch-specific operational equipment the AI
   * should prefer when prescribing workout exercises. */
  availableEquipment?: EquipmentLite[];
  /** Optional brief summary of the member's previous plan + adherence,
   * so the AI can progress (not repeat) what came before. */
  previousPlanContext?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Server-side role check: only owner/admin/manager may generate AI plans ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .in("role", ALLOWED_AI_ROLES as unknown as string[]);

    if (!callerRoles || callerRoles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Forbidden: AI plan generation requires owner, admin, or manager role." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { type, memberInfo, durationWeeks = 4, daysPerWeek, rotationIntervalDays = 0, caloriesTarget, availableMeals = [], availableEquipment = [], previousPlanContext } = await req.json() as GeneratePlanRequest;
    // Cap variants for cost — even at 30-day rotation across 24 weeks we limit to 4 distinct sessions per slot.
    const variantCount = rotationIntervalDays && rotationIntervalDays > 0
      ? Math.max(2, Math.min(4, Math.ceil((durationWeeks * 7) / rotationIntervalDays)))
      : 0;
    // Provider/key resolved via ai-runtime → ai-dispatcher per active provider config.

    // v2 — persona ("expert fitness trainer / nutritionist") comes from
    // ai_purposes.fitness_plan.system_prompt (Settings → AI Brain). Only the
    // strict OUTPUT-SHAPE contract lives here because the JSON schema is what
    // we parse downstream — it is not persona.
    const systemPrompt = type === "workout"
      ? `OUTPUT CONTRACT — Return a JSON object with the following structure (no prose, no markdown):
         {
           "name": "Plan name",
           "description": "Brief description",
           "goal": "Primary goal",
           "difficulty": "beginner|intermediate|advanced",
           "daysPerWeek": <integer matching the requested sessions per week>,
           "weeks": [
             {
               "week": 1,
               "days": [
                 {
                   "day": "Monday",
                   "focus": "Chest & Triceps",
                    "exercises": [
                      {"name": "Leg Press", "equipment": "Super Leg Press 45°", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "Focus on form"}
                    ],
                   "warmup": "5 min cardio + dynamic stretches",
                   "cooldown": "5 min stretching"
                 }
               ]
             }
           ],
           "rotation": {
             "intervalDays": <integer — copy from request, or 0 if not requested>,
             "variants": [
               {
                 "variantIndex": 0,
                 "label": "Block A",
                 "days": [
                   { "day": "Monday", "focus": "...", "exercises": [ { "name": "...", "equipment": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..." } ] }
                 ]
               }
             ]
           },
           "notes": "General advice and precautions"
         }
         CRITICAL: "weeks" must contain EXACTLY ONE entry (week 1) — a single template week covering all 7 calendar days. The system expands it into the full program with progressive overload afterwards. Never emit week 2+.
         IMPORTANT: Only include the "rotation" key if the user explicitly requested rotation. Otherwise omit it entirely.`
      : `OUTPUT CONTRACT — For EACH meal, return: meal name, a TIME RANGE (e.g. "8:00–9:00 AM" — eating times vary per person), calories, and macros (protein/carbs/fat in grams). When possible also include micros: fiber, sodium (mg), sugar (g).
         Return a JSON object with the following structure (no prose, no markdown):
         {
           "name": "Diet plan name",
           "description": "Brief description",
           "type": "weight_loss|muscle_gain|maintenance|general_health",
           "dailyCalories": 2000,
           "macros": {"protein": "30%", "carbs": "40%", "fat": "30%"},
           "meals": [
             {
               "day": "Monday",
               "breakfast": {"meal": "Oatmeal with berries", "time": "8:00–9:00 AM", "calories": 350, "protein": 12, "carbs": 55, "fat": 8, "fiber": 6, "sodium": 120, "sugar": 10},
               "snack1":    {"meal": "Greek yogurt",         "time": "11:00–11:30 AM", "calories": 150, "protein": 15, "carbs": 12, "fat": 4, "fiber": 0, "sodium": 60, "sugar": 8},
               "lunch":     {"meal": "Grilled chicken salad","time": "1:00–2:00 PM",  "calories": 450, "protein": 38, "carbs": 30, "fat": 18, "fiber": 7, "sodium": 480, "sugar": 6},
               "snack2":    {"meal": "Almonds",              "time": "4:30–5:00 PM",  "calories": 160, "protein": 6,  "carbs": 6,  "fat": 14, "fiber": 3, "sodium": 0,  "sugar": 1},
               "dinner":    {"meal": "Salmon with vegetables","time": "8:00–9:00 PM", "calories": 550, "protein": 40, "carbs": 35, "fat": 22, "fiber": 8, "sodium": 380, "sugar": 4}
             }
           ],
           "hydration": "8-10 glasses of water daily",
           "supplements": ["Multivitamin", "Omega-3"],
           "notes": "General dietary advice"
         }`;

    // ── Goal-driven programming contract (v4) ──
    const goalKey = resolveGoalKey(memberInfo.fitnessGoals);
    const seed = varietySeed(memberInfo.name, goalKey, memberInfo.experience, new Date().toISOString().slice(0, 10));
    const directive = goalDirective(type, goalKey, memberInfo.fitnessGoals);
    const tp = trainingParams(goalKey);
    const np = nutritionParams(goalKey);
    const goalHeader = `${directive}\n\nVARIETY DIRECTIVE — ${varietyAngle(seed)}\n\n`;

    const userPrompt = type === "workout"
      ? `${goalHeader}Create the TEMPLATE WEEK (week 1 only) of a ${durationWeeks}-week workout plan for:

         - Name: ${memberInfo.name || "Member"}
         - Age: ${memberInfo.age || "Not specified"}
         - Gender: ${memberInfo.gender || "Not specified"}
         - Height: ${memberInfo.height ? memberInfo.height + " cm" : "Not specified"}
         - Weight: ${memberInfo.weight ? memberInfo.weight + " kg" : "Not specified"}
         - Fitness Goals: ${memberInfo.fitnessGoals || "General fitness"}
         - Health Conditions: ${memberInfo.healthConditions || "None reported"}
         - Experience Level: ${memberInfo.experience || "Beginner"}
         ${daysPerWeek ? `- Sessions per week: EXACTLY ${daysPerWeek} training days. Mark the remaining ${7 - daysPerWeek} day(s) explicitly as { "day": "...", "focus": "Rest", "exercises": [] }.` : ""}
         - Preferences: ${memberInfo.preferences || "None"}
         ${variantCount > 0 ? `\n         ROTATION REQUIRED — produce a "rotation" object with intervalDays=${rotationIntervalDays} and exactly ${variantCount} variants (Block A, Block B${variantCount >= 3 ? ", Block C" : ""}${variantCount >= 4 ? ", Block D" : ""}). Each variant must cover the SAME muscle groups / movement patterns as the base "weeks[0]" but SWAP the exercises (e.g. Barbell Bench → Dumbbell Press, Back Squat → Goblet Squat, Lat Pulldown → Seated Row). The dashboard will rotate variants every ${rotationIntervalDays} days so members never repeat the identical session back-to-back.` : ""}

         Return ONLY week 1 (all 7 calendar days) — the system builds weeks 2–${durationWeeks} with progressive overload.
         FINAL CHECK before you answer: every "reps" value must sit inside ${tp.repRange}; every "rest" value inside ${tp.restRange}; the conditioning rule (${tp.conditioning}) must be visibly applied; and nothing in the PROHIBITED list may appear.`

      : `Create a weekly meal plan for:
         - Name: ${memberInfo.name || "Member"}
         - Age: ${memberInfo.age || "Not specified"}
         - Gender: ${memberInfo.gender || "Not specified"}
         - Height: ${memberInfo.height ? memberInfo.height + " cm" : "Not specified"}
         - Weight: ${memberInfo.weight ? memberInfo.weight + " kg" : "Not specified"}
         - Fitness Goals: ${memberInfo.fitnessGoals || "General health"}
         - Health Conditions: ${memberInfo.healthConditions || "None reported"}
         - Target Calories: ${caloriesTarget || "Calculate based on goals"}
         - Preferences: ${memberInfo.preferences || "None"}
         
         Build the plan around the goal contract above.
         FINAL CHECK before you answer: "dailyCalories" must reflect ${np.calorieDelta}; "macros" must match ${np.macroSplit}; protein must reach ${np.proteinTarget}; and nothing in the PROHIBITED list may appear.`;


    const catalogPrompt = type === "diet" && availableMeals.length > 0
      ? `\n\nIMPORTANT — prefer meals from this gym-stocked catalog whenever possible. Use the EXACT meal name when picking from the catalog so it can be tracked back to inventory. If you must propose something outside the catalog, do so sparingly.\n\n${availableMeals
          .slice(0, 80)
          .map((m) => `- ${m.name}${m.meal_type ? ` [${m.meal_type}]` : ""}${m.calories ? ` (${m.calories} kcal, P${m.protein ?? 0}/C${m.carbs ?? 0}/F${m.fats ?? 0})` : ""}`)
          .join("\n")}`
      : "";

    // v1.2.0 — TWO-FIELD naming: "name" = generic movement, "equipment" = exact gym machine
    const equipmentPrompt = type === "workout" && availableEquipment.length > 0
      ? `\n\nIMPORTANT — this gym has the following OPERATIONAL equipment. Each line lists the muscle groups it trains and the movement pattern. When prescribing exercises, prefer movements that use this exact equipment, AND respect muscle-group coverage across the week (balance push/pull, include 1-2 dedicated CORE sessions, hit legs at least once).\n\nNAMING RULE (STRICT — TWO FIELDS):\n1. "name" → the GENERIC EXERCISE / MOVEMENT name the member will recognise (e.g. "Leg Press", "Lat Pulldown", "Hip Thrust", "Chest Press", "Seated Row", "Rear Delt Fly", "Leg Curl", "Plank"). Keep it short, human-friendly, Title Case. NEVER put the gym's machine label here.\n2. "equipment" → the EXACT machine name from the list below (e.g. "SUPER LEG PRESS 45°", "Hip Thrust Machine"). Use empty string for bodyweight / mobility / cardio that doesn't use a listed machine.\n\nNEVER include brand names (e.g. Panatta, Realleader, Booty Builder, Relax), model codes, SKUs, or part numbers (e.g. FW2035, PT-101, 1FW044, APT-128, XHA040) in EITHER field. If the listed machine name itself contains a brand or model, strip the brand/model out for the "equipment" field too (e.g. "PANATTA BACK DELTOIDS 1FW026" → name: "Rear Delt Fly", equipment: "Rear Delt Machine").\n\nBodyweight, mobility, stretching, and basic cardio (running, jump rope) are always allowed without being on the list — set "equipment" to "" for those. Do NOT recommend machines not on the list.\n\n${availableEquipment
          .length === 0
        ? ""
        : (() => {
            // Group by muscle group so the model can pick per body part instead
            // of scanning a flat 100-line list. Untagged machines get their own bucket.
            const groups = new Map<string, string[]>();
            for (const e of availableEquipment) {
              const cat = e.primary_category || e.category;
              const move = e.movement_pattern ? ` pattern=${e.movement_pattern}` : "";
              const line = `  - ${e.name}${cat ? ` [${cat}]` : ""}${move}`;
              const muscles = (e.muscle_groups || []).length ? e.muscle_groups! : ["UNCLASSIFIED"];
              for (const m of muscles) {
                const k = String(m).toUpperCase();
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k)!.push(line);
              }
            }
            return [...groups.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([m, lines]) => `${m}:\n${[...new Set(lines)].join("\n")}`)
              .join("\n");
          })()}\n\nHARD CONSTRAINT: any "equipment" value that is not on this list is rejected by the server and auto-substituted. Only prescribe machines from the list, or "" for bodyweight/free-weight/cardio.`

      : "";

    const previousPlanPrompt = previousPlanContext
      ? `\n\nPREVIOUS PLAN CONTEXT — progress (don't repeat) what the member has already done. Increase load / vary stimulus appropriately:\n${previousPlanContext}`
      : "";

    console.log(`Generating ${type} plan for member:`, memberInfo.name, `with ${availableMeals.length} catalog meals, ${availableEquipment.length} equipment items, prevPlan=${!!previousPlanContext}`);

    // Dynamic token budget: one template week (+ rotation variants) or 7 diet days.
    // Base 4k, +1.2k per rotation variant, capped at 16k so we never inherit the
    // old 2,500-token default that truncated the JSON mid-object.
    const maxTokens = Math.min(16000, 4000 + variantCount * 1200 + (type === "diet" ? 2000 : 0));

    const baseMessage = userPrompt + catalogPrompt + equipmentPrompt + previousPlanPrompt;

    const runAi = async (systemExtra = "", userExtra = "") => {
      const r = await generateOnce({
        purpose: "fitness_plan",
        branchId: (memberInfo as { branch_id?: string | null })?.branch_id ?? null,
        userMessage: baseMessage + userExtra,
        systemOverride: systemPrompt + systemExtra,
        responseFormat: "json",
        maxTokens,
        // Deterministic-but-varied: enough sampling freedom to differentiate
        // plans across goals/members without breaking the JSON contract.
        temperature: 0.85,
        supabase: supabaseAdmin,
      });
      return r.content;
    };


    let content: string | undefined;
    try {
      content = await runAi();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI gateway error";
      if (/429|rate/i.test(msg)) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (/402|credits/i.test(msg)) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw err;
    }

    if (!content) {
      throw new Error("No content in AI response");
    }

    let plan = parsePlanJson(content);
    let shapeError = plan ? validatePlanShape(type, plan) : "AI response was truncated";

    if (shapeError) {
      console.warn(`[generate-fitness-plan] retrying — ${shapeError}`);
      try {
        const retry = await runAi(
          "\n\nBE CONCISE: keep notes under 8 words, omit optional fields, and make sure the JSON object is COMPLETE and closed."
        );
        const retryPlan = parsePlanJson(retry || "");
        const retryError = retryPlan ? validatePlanShape(type, retryPlan) : "AI response was truncated";
        if (!retryError) { plan = retryPlan; shapeError = null; }
        else shapeError = retryError;
      } catch (e) {
        console.error("[generate-fitness-plan] retry failed", (e as Error).message);
      }
    }

    if (shapeError || !plan) {
      return new Response(
        JSON.stringify({
          error: `${shapeError || "AI response could not be parsed"}. Try a shorter plan (fewer weeks or no rotation) and generate again.`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Expand the AI's single template week into the full program server-side.
    if (type === "workout") expandWeeks(plan, durationWeeks);


    // Post-process: for diet plans, attempt to map each AI-suggested meal back
    // to a catalog row by name (case-insensitive substring match). Stamps the
    // catalog id onto matched entries and flags everything else as unmatched.
    if (type === "diet" && Array.isArray(plan?.meals) && availableMeals.length > 0) {
      const lookup = availableMeals.map((m) => ({
        ...m,
        _key: m.name.toLowerCase().trim(),
      }));
      const findMatch = (name?: string) => {
        if (!name) return null;
        const k = name.toLowerCase().trim();
        return (
          lookup.find((m) => m._key === k) ||
          lookup.find((m) => m._key.includes(k) || k.includes(m._key)) ||
          null
        );
      };
      const slotKeys = ["breakfast", "snack1", "lunch", "snack2", "dinner", "pre_workout", "post_workout"];
      let matchedCount = 0;
      let totalCount = 0;
      for (const day of plan.meals) {
        for (const k of slotKeys) {
          const entry = day?.[k];
          if (!entry || typeof entry !== "object") continue;
          totalCount++;
          const match = findMatch(entry.meal || entry.name);
          if (match) {
            entry.catalog_id = match.id;
            entry.unmatched = false;
            matchedCount++;
            // Backfill macros from catalog when AI omitted them.
            if (entry.calories === undefined && match.calories !== undefined) entry.calories = match.calories;
            if (entry.protein === undefined && match.protein !== undefined) entry.protein = match.protein;
            if (entry.carbs === undefined && match.carbs !== undefined) entry.carbs = match.carbs;
            if (entry.fats === undefined && match.fats !== undefined) entry.fats = match.fats;
            if (!entry.quantity && match.default_quantity) entry.quantity = match.default_quantity;
          } else {
            entry.catalog_id = null;
            entry.unmatched = true;
          }
        }
      }
      plan.catalogMatchSummary = { matched: matchedCount, total: totalCount };
      console.log(`Catalog match: ${matchedCount}/${totalCount} meals mapped to catalog ids.`);
    }

    // Workout post-process: stamp daysPerWeek + rotation interval on the plan
    // so the dashboard can pick the right session even if the AI omitted them.
    if (type === "workout") {
      if (daysPerWeek && !plan.daysPerWeek) plan.daysPerWeek = daysPerWeek;
      if (variantCount > 0) {
        plan.rotation = plan.rotation || {};
        plan.rotation.intervalDays = rotationIntervalDays;
        if (!Array.isArray(plan.rotation.variants)) plan.rotation.variants = [];
      }
    }

    console.log(`Successfully generated ${type} plan:`, plan.name, `daysPerWeek=${daysPerWeek}, rotation=${variantCount}`);

    return new Response(
      JSON.stringify({ success: true, plan }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating fitness plan:", error);
    await captureEdgeError('generate-fitness-plan', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
