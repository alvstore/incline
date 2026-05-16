// Canonical plan shape used by preview / assignment components so that
// AI-generated plans (which historically used a `meals[]` array per day)
// and manually-built diet plans (which use a `slots[]` array per meal time)
// can render through a single, shared code path.
//
// Workout plans already share a single shape (weeks → days → exercises),
// so the workout normaliser is mostly a defensive pass-through.

export interface NormalizedMealItem {
  food: string;
  quantity?: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber?: number;
  /** Set when this item was matched to a row in the meal_catalog table. */
  catalog_id?: string | null;
  /** True when the AI proposed this item but no catalog match was found. */
  unmatched?: boolean;
}

export interface NormalizedMealSlot {
  name: string;
  time?: string;
  items: NormalizedMealItem[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  };
  recipe_link?: string;
  prep_video_url?: string;
  prep_video_file_path?: string;
}

export interface NormalizedDietDay {
  day: string;
  slots: NormalizedMealSlot[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  };
}

export interface NormalizedDietPlan {
  name?: string;
  description?: string;
  dailyCalories?: number;
  macros?: { protein?: string; carbs?: string; fat?: string };
  days: NormalizedDietDay[];
  notes?: string;
}

export interface NormalizedExercise {
  name: string;
  sets?: number | string;
  reps?: number | string;
  rest?: string;
  notes?: string;
  weight?: string;
  video_url?: string;
  video_file_path?: string;
  form_tips?: string[] | string;
}

export interface NormalizedWorkoutDay {
  day: string;
  focus?: string;
  exercises: NormalizedExercise[];
  warmup?: string;
  cooldown?: string;
}

export interface NormalizedWorkoutWeek {
  week: number;
  days: NormalizedWorkoutDay[];
}

export interface NormalizedWorkoutPlan {
  name?: string;
  description?: string;
  goal?: string;
  difficulty?: string;
  weeks: NormalizedWorkoutWeek[];
  notes?: string;
}

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const sumTotals = (items: NormalizedMealItem[]) =>
  items.reduce(
    (acc, it) => ({
      calories: acc.calories + (it.calories || 0),
      protein: acc.protein + (it.protein || 0),
      carbs: acc.carbs + (it.carbs || 0),
      fats: acc.fats + (it.fats || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  );

function normalizeItem(raw: any): NormalizedMealItem {
  // String items ("Greek yogurt") become a single-food entry with zero macros.
  if (typeof raw === 'string') {
    return { food: raw, calories: 0, protein: 0, carbs: 0, fats: 0 };
  }
  const food = raw?.food || raw?.name || raw?.meal || '';
  return {
    food,
    quantity: raw?.quantity || raw?.serving || undefined,
    calories: num(raw?.calories),
    protein: num(raw?.protein),
    carbs: num(raw?.carbs),
    fats: num(raw?.fats ?? raw?.fat),
    fiber: raw?.fiber !== undefined ? num(raw.fiber) : undefined,
    catalog_id: raw?.catalog_id ?? null,
    unmatched: raw?.unmatched ?? undefined,
  };
}

function normalizeSlot(raw: any, fallbackName?: string): NormalizedMealSlot {
  const items = Array.isArray(raw?.items) ? raw.items.map(normalizeItem) : [];
  const totals = raw?.totals
    ? {
        calories: num(raw.totals.calories),
        protein: num(raw.totals.protein),
        carbs: num(raw.totals.carbs),
        fats: num(raw.totals.fats),
      }
    : sumTotals(items);
  return {
    name: raw?.name || fallbackName || 'Meal',
    time: raw?.time,
    items,
    totals,
    recipe_link: raw?.recipe_link,
    prep_video_url: raw?.prep_video_url,
    prep_video_file_path: raw?.prep_video_file_path,
  };
}

const AI_DAY_KEYS: { key: string; name: string; time?: string }[] = [
  { key: 'breakfast', name: 'Breakfast', time: '08:00' },
  { key: 'snack1', name: 'Mid-Morning Snack', time: '10:30' },
  { key: 'lunch', name: 'Lunch', time: '13:00' },
  { key: 'snack2', name: 'Evening Snack', time: '16:30' },
  { key: 'dinner', name: 'Dinner', time: '20:00' },
  { key: 'pre_workout', name: 'Pre-workout' },
  { key: 'post_workout', name: 'Post-workout' },
];

function aiMealEntryToSlot(entry: any, def: { key: string; name: string; time?: string }): NormalizedMealSlot {
  const item = normalizeItem({
    food: entry?.meal || entry?.name || entry?.food || def.name,
    quantity: entry?.quantity,
    calories: entry?.calories,
    protein: entry?.protein,
    carbs: entry?.carbs,
    fats: entry?.fats ?? entry?.fat,
    fiber: entry?.fiber,
    catalog_id: entry?.catalog_id,
    unmatched: entry?.unmatched,
  });
  return {
    name: def.name,
    time: def.time,
    items: [item],
    totals: sumTotals([item]),
    recipe_link: entry?.recipe_link,
    prep_video_url: entry?.prep_video_url,
  };
}

/**
 * Normalize a diet plan content payload (manual `slots` shape, AI `meals` shape,
 * or already-normalized) into a single canonical structure.
 */
export function normalizeDietPlan(content: any): NormalizedDietPlan {
  const base: NormalizedDietPlan = {
    name: content?.name,
    description: content?.description,
    dailyCalories: content?.dailyCalories ?? content?.caloriesTarget,
    macros: content?.macros,
    notes: content?.notes,
    days: [],
  };

  // Already-normalized shape
  if (Array.isArray(content?.days) && content.days.length && content.days[0]?.slots) {
    base.days = content.days.map((d: any) => {
      const slots: NormalizedMealSlot[] = (d.slots || []).map((s: any) => normalizeSlot(s));
      return {
        day: d.day || 'Day',
        slots,
        totals: slots.reduce(
          (a, s) => ({
            calories: a.calories + s.totals.calories,
            protein: a.protein + s.totals.protein,
            carbs: a.carbs + s.totals.carbs,
            fats: a.fats + s.totals.fats,
          }),
          { calories: 0, protein: 0, carbs: 0, fats: 0 },
        ),
      };
    });
    return base;
  }

  // Manual diet shape: single day-template using `slots`.
  if (Array.isArray(content?.slots)) {
    const slots: NormalizedMealSlot[] = content.slots.map((s: any) => normalizeSlot(s));
    base.days = [
      {
        day: 'Daily template',
        slots,
        totals: slots.reduce(
          (a, s) => ({
            calories: a.calories + s.totals.calories,
            protein: a.protein + s.totals.protein,
            carbs: a.carbs + s.totals.carbs,
            fats: a.fats + s.totals.fats,
          }),
          { calories: 0, protein: 0, carbs: 0, fats: 0 },
        ),
      },
    ];
    return base;
  }

  // AI-generated diet shape: array of days with named meal keys.
  if (Array.isArray(content?.meals)) {
    base.days = content.meals.map((day: any) => {
      const slots: NormalizedMealSlot[] = [];
      for (const def of AI_DAY_KEYS) {
        const entry = day?.[def.key];
        if (entry) slots.push(aiMealEntryToSlot(entry, def));
      }
      // Some AI variants put items into a generic `meals` array per day.
      if (Array.isArray(day?.items) && slots.length === 0) {
        slots.push(normalizeSlot({ name: 'Meals', items: day.items }, 'Meals'));
      }
      return {
        day: day?.day || 'Day',
        slots,
        totals: slots.reduce(
          (a, s) => ({
            calories: a.calories + s.totals.calories,
            protein: a.protein + s.totals.protein,
            carbs: a.carbs + s.totals.carbs,
            fats: a.fats + s.totals.fats,
          }),
          { calories: 0, protein: 0, carbs: 0, fats: 0 },
        ),
      };
    });
  }

  return base;
}

export function normalizeWorkoutPlan(content: any): NormalizedWorkoutPlan {
  const dayToWeek = (days: any[]): NormalizedWorkoutWeek[] => [
    {
      week: 1,
      days: days.map((d: any) => ({
        day: d?.day || 'Day',
        focus: d?.focus,
        exercises: (d?.exercises || []).map((ex: any) => ({
          name: ex?.name || '',
          sets: ex?.sets,
          reps: ex?.reps,
          rest: ex?.rest,
          notes: ex?.notes,
          weight: ex?.weight,
          video_url: ex?.video_url,
          video_file_path: ex?.video_file_path,
          form_tips: ex?.form_tips,
        })),
        warmup: d?.warmup,
        cooldown: d?.cooldown,
      })),
    },
  ];

  let weeks: NormalizedWorkoutWeek[];
  if (Array.isArray(content?.weeks) && content.weeks.length) {
    weeks = content.weeks.map((wk: any) => ({
      week: wk?.week ?? 1,
      days: dayToWeek(wk?.days || [])[0].days,
    }));
  } else if (Array.isArray(content?.days)) {
    weeks = dayToWeek(content.days);
  } else {
    weeks = [];
  }

  return {
    name: content?.name,
    description: content?.description,
    goal: content?.goal,
    difficulty: content?.difficulty,
    weeks,
    notes: content?.notes,
  };
}
