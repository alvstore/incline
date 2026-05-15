// generate-fitness-plan v2.0.0 — SSOT: routes through ai-runtime (purpose='fitness_plan')
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { generateOnce } from "../_shared/ai-runtime.ts";
const serve = Deno.serve;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_AI_ROLES = ["owner", "admin", "manager"] as const;

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = type === "workout" 
      ? `You are an expert fitness trainer creating personalized workout plans. Generate detailed, safe, and effective workout programs.
         Return a JSON object with the following structure:
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
         IMPORTANT: Only include the "rotation" key if the user explicitly requested rotation. Otherwise omit it entirely.`
      : `You are an expert nutritionist creating personalized diet plans. Generate detailed, balanced, and practical meal plans.
         For EACH meal, return: meal name, a TIME RANGE (e.g. "8:00–9:00 AM" — eating times vary per person), calories, and macros (protein/carbs/fat in grams). When possible also include micros: fiber, sodium (mg), sugar (g).
         Return a JSON object with the following structure:
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

    const userPrompt = type === "workout"
      ? `Create a ${durationWeeks}-week workout plan for:
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

         Create a progressive, balanced workout plan suitable for their level.`
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
         
         Create a balanced, practical meal plan suitable for their goals.`;

    const catalogPrompt = type === "diet" && availableMeals.length > 0
      ? `\n\nIMPORTANT — prefer meals from this gym-stocked catalog whenever possible. Use the EXACT meal name when picking from the catalog so it can be tracked back to inventory. If you must propose something outside the catalog, do so sparingly.\n\n${availableMeals
          .slice(0, 80)
          .map((m) => `- ${m.name}${m.meal_type ? ` [${m.meal_type}]` : ""}${m.calories ? ` (${m.calories} kcal, P${m.protein ?? 0}/C${m.carbs ?? 0}/F${m.fats ?? 0})` : ""}`)
          .join("\n")}`
      : "";

    // v1.2.0 — TWO-FIELD naming: "name" = generic movement, "equipment" = exact gym machine
    const equipmentPrompt = type === "workout" && availableEquipment.length > 0
      ? `\n\nIMPORTANT — this gym has the following OPERATIONAL equipment. Each line lists the muscle groups it trains and the movement pattern. When prescribing exercises, prefer movements that use this exact equipment, AND respect muscle-group coverage across the week (balance push/pull, include 1-2 dedicated CORE sessions, hit legs at least once).\n\nNAMING RULE (STRICT — TWO FIELDS):\n1. "name" → the GENERIC EXERCISE / MOVEMENT name the member will recognise (e.g. "Leg Press", "Lat Pulldown", "Hip Thrust", "Chest Press", "Seated Row", "Rear Delt Fly", "Leg Curl", "Plank"). Keep it short, human-friendly, Title Case. NEVER put the gym's machine label here.\n2. "equipment" → the EXACT machine name from the list below (e.g. "SUPER LEG PRESS 45°", "Hip Thrust Machine"). Use empty string for bodyweight / mobility / cardio that doesn't use a listed machine.\n\nNEVER include brand names (e.g. Panatta, Realleader, Booty Builder, Relax), model codes, SKUs, or part numbers (e.g. FW2035, PT-101, 1FW044, APT-128, XHA040) in EITHER field. If the listed machine name itself contains a brand or model, strip the brand/model out for the "equipment" field too (e.g. "PANATTA BACK DELTOIDS 1FW026" → name: "Rear Delt Fly", equipment: "Rear Delt Machine").\n\nBodyweight, mobility, stretching, and basic cardio (running, jump rope) are always allowed without being on the list — set "equipment" to "" for those. Do NOT recommend machines not on the list.\n\n${availableEquipment
          .slice(0, 100)
          .map((e) => {
            const cat = e.primary_category || e.category;
            const muscles = (e.muscle_groups || []).length ? ` muscles=[${(e.muscle_groups || []).join(",")}]` : "";
            const move = e.movement_pattern ? ` pattern=${e.movement_pattern}` : "";
            return `- ${e.name}${cat ? ` [${cat}]` : ""}${muscles}${move}`;
          })
          .join("\n")}`
      : "";

    const previousPlanPrompt = previousPlanContext
      ? `\n\nPREVIOUS PLAN CONTEXT — progress (don't repeat) what the member has already done. Increase load / vary stimulus appropriately:\n${previousPlanContext}`
      : "";

    console.log(`Generating ${type} plan for member:`, memberInfo.name, `with ${availableMeals.length} catalog meals, ${availableEquipment.length} equipment items, prevPlan=${!!previousPlanContext}`);

    let content: string | undefined;
    try {
      const r = await generateOnce({
        purpose: "fitness_plan",
        branchId: memberInfo?.branch_id ?? null,
        userMessage: userPrompt + catalogPrompt + equipmentPrompt + previousPlanPrompt,
        systemOverride: systemPrompt,
        responseFormat: "json",
        supabase,
      });
      content = r.content;
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

    let plan;
    try {
      plan = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

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
