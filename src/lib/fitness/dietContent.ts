// Canonical reader/writer for diet plan content.
//
// Stored diet content comes in two shapes:
//  1. Weekly (AI generated):  { meals: [{ day, breakfast, snack1, lunch, snack2, dinner }, ...] }
//  2. Single day (legacy manual builder): { slots: [{ name, time, items: [...] }, ...] }
//
// The builder works on a canonical `DietDay[]` structure and writes back the
// same shape it read, so a weekly plan can never be downgraded to one day.

export interface DietItem {
  food: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  catalog_id?: string;
}

export interface DietSlot {
  name: string;
  time: string;
  items: DietItem[];
  recipe_link?: string;
  prep_video_url?: string;
  prep_video_file_path?: string;
}

export interface DietDay {
  day: string;
  slots: DietSlot[];
}

export interface NormalizedDiet {
  days: DietDay[];
  /** true when the source content stored a 7-day (or N-day) `meals` array. */
  weekly: boolean;
}

export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

interface SlotKeyDef {
  key: string;
  name: string;
  time: string;
}

/** Meal keys used by the AI weekly shape, in day order. */
export const WEEKLY_SLOT_KEYS: SlotKeyDef[] = [
  { key: 'breakfast', name: 'Breakfast', time: '07:30' },
  { key: 'snack1', name: 'Mid-Morning Snack', time: '10:30' },
  { key: 'lunch', name: 'Lunch', time: '13:00' },
  { key: 'snack2', name: 'Evening Snack', time: '16:30' },
  { key: 'dinner', name: 'Dinner', time: '20:00' },
];

/**
 * Every meal key the reader understands, in natural day order.
 * Pre/post-workout and bedtime are first-class — they are not "slot_N".
 */
export const KNOWN_SLOT_KEYS: SlotKeyDef[] = [
  { key: 'pre_workout', name: 'Pre-Workout', time: '06:00' },
  { key: 'post_workout', name: 'Post-Workout', time: '08:00' },
  { key: 'breakfast', name: 'Breakfast', time: '07:30' },
  { key: 'snack1', name: 'Mid-Morning Snack', time: '10:30' },
  { key: 'lunch', name: 'Lunch', time: '13:00' },
  { key: 'snack2', name: 'Evening Snack', time: '16:30' },
  { key: 'dinner', name: 'Dinner', time: '20:00' },
  { key: 'bedtime', name: 'Bedtime', time: '22:00' },
];

export const DEFAULT_SLOTS: DietSlot[] = WEEKLY_SLOT_KEYS.map((k) => ({
  name: k.name,
  time: k.time,
  items: [],
}));


export const EMPTY_ITEM: DietItem = {
  food: '',
  quantity: '',
  calories: 0,
  protein: 0,
  carbs: 0,
  fats: 0,
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Free-text times like "8:30–9:00 AM" are kept as-is only when they fit <input type="time">. */
const normalizeTime = (raw: unknown, fallback: string): string => {
  const s = String(raw ?? '').trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = m[2];
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    // Weekly AI plans usually omit am/pm on the first half of a range.
    if (!ap && h < 6) h += 12;
    return `${String(h).padStart(2, '0')}:${mm}`;
  }
  return fallback;
};

const itemFromRaw = (raw: any): DietItem => ({
  food: raw?.food || raw?.meal || raw?.name || '',
  quantity: raw?.quantity || '',
  calories: num(raw?.calories),
  protein: num(raw?.protein),
  carbs: num(raw?.carbs),
  fats: num(raw?.fats ?? raw?.fat),
  catalog_id: raw?.catalog_id || undefined,
});

const slotFromRaw = (raw: any, fallbackName = '', fallbackTime = ''): DietSlot => ({
  name: raw?.name || fallbackName,
  time: normalizeTime(raw?.time, fallbackTime),
  items: Array.isArray(raw?.items) ? raw.items.map(itemFromRaw) : [],
  recipe_link: raw?.recipe_link || undefined,
  prep_video_url: raw?.prep_video_url || undefined,
  prep_video_file_path: raw?.prep_video_file_path || undefined,
});

/**
 * Reads any stored diet content and returns canonical days.
 * Returns null when the content holds no usable meal data.
 */
export function normalizeDietContent(content: unknown): NormalizedDiet | null {
  const c = (content || {}) as any;

  // Weekly AI shape
  if (Array.isArray(c.meals) && c.meals.length) {
    const days: DietDay[] = c.meals.map((rawDay: any, dIdx: number) => {
      const dayName = rawDay?.day || WEEK_DAYS[dIdx % 7] || `Day ${dIdx + 1}`;

      // A day may already carry a slots/items array instead of meal keys.
      if (Array.isArray(rawDay?.slots) && rawDay.slots.length) {
        return { day: dayName, slots: rawDay.slots.map((s: any) => slotFromRaw(s)) };
      }

      // Collect every meal-bearing key: the five known ones plus any custom
      // key (pre_workout, post_workout, bedtime, slot_N…). The stored `name`
      // always wins so custom meal names survive a save/load round-trip.
      const RESERVED = ['day', 'slots', 'totals', 'notes'];
      const entries = Object.keys(rawDay || {})
        .filter((k) => !RESERVED.includes(k) && rawDay[k] && typeof rawDay[k] === 'object')
        .map((k) => {
          const e = rawDay[k];
          const known = KNOWN_SLOT_KEYS.find((w) => w.key === k);
          const fallbackName =
            known?.name || k.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
          const order =
            Number.isFinite(Number(e?.order))
              ? Number(e.order)
              : known
                ? KNOWN_SLOT_KEYS.findIndex((w) => w.key === k)
                : 100;
          const slot: DietSlot = {
            name: e?.name || fallbackName,
            time: normalizeTime(e?.time, known?.time || ''),
            items: Array.isArray(e?.items) && e.items.length
              ? e.items.map(itemFromRaw)
              : [itemFromRaw(e)],
            recipe_link: e?.recipe_link || undefined,
            prep_video_url: e?.prep_video_url || undefined,
            prep_video_file_path: e?.prep_video_file_path || undefined,
          };
          return { order, slot };
        })
        .sort((a, b) =>
          a.order !== b.order
            ? a.order - b.order
            : (a.slot.time || '').localeCompare(b.slot.time || ''),
        );

      const slots = entries.map((e) => e.slot);
      return { day: dayName, slots: slots.length ? slots : DEFAULT_SLOTS.map((s) => ({ ...s, items: [] })) };

    });

    return { days, weekly: true };
  }

  // Legacy single-day shape
  if (Array.isArray(c.slots) && c.slots.length) {
    return {
      days: [{ day: 'Daily', slots: c.slots.map((s: any) => slotFromRaw(s)) }],
      weekly: false,
    };
  }

  return null;
}

export function slotTotals(slot: DietSlot) {
  return slot.items.reduce(
    (a, i) => ({
      calories: a.calories + num(i.calories),
      protein: a.protein + num(i.protein),
      carbs: a.carbs + num(i.carbs),
      fats: a.fats + num(i.fats),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  );
}

export function dayTotals(day: DietDay) {
  return day.slots.reduce(
    (a, s) => {
      const t = slotTotals(s);
      return {
        calories: a.calories + t.calories,
        protein: a.protein + t.protein,
        carbs: a.carbs + t.carbs,
        fats: a.fats + t.fats,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  );
}

export function weeklyAverageTotals(days: DietDay[]) {
  if (!days.length) return { calories: 0, protein: 0, carbs: 0, fats: 0 };
  const sum = days.reduce(
    (a, d) => {
      const t = dayTotals(d);
      return {
        calories: a.calories + t.calories,
        protein: a.protein + t.protein,
        carbs: a.carbs + t.carbs,
        fats: a.fats + t.fats,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fats: 0 },
  );
  return {
    calories: sum.calories / days.length,
    protein: sum.protein / days.length,
    carbs: sum.carbs / days.length,
    fats: sum.fats / days.length,
  };
}

const slotKeyFor = (name: string, idx: number): string => {
  const k = name.toLowerCase();
  if (k.includes('pre') && k.includes('workout')) return 'pre_workout';
  if ((k.includes('post') || k.includes('after')) && k.includes('workout')) return 'post_workout';
  if (k.includes('breakfast')) return 'breakfast';
  if (k.includes('lunch')) return 'lunch';
  if (k.includes('dinner')) return 'dinner';
  if (k.includes('bed')) return 'bedtime';
  if (k.includes('mid') || k.includes('morning')) return 'snack1';
  if (k.includes('evening') || k.includes('snack')) return 'snack2';
  return `slot_${idx + 1}`;
};


/**
 * Writes canonical days back to stored content.
 * Weekly stays weekly (`meals`), single-day stays single-day (`slots`).
 */
export function serializeDietDays(
  days: DietDay[],
  weekly: boolean,
): { meals?: any[]; slots?: any[] } {
  const cleanSlot = (s: DietSlot) => ({
    name: s.name,
    time: s.time,
    items: s.items.filter((i) => i.food),
    recipe_link: s.recipe_link || undefined,
    prep_video_url: s.prep_video_url || undefined,
    prep_video_file_path: s.prep_video_file_path || undefined,
    totals: slotTotals(s),
  });

  if (!weekly) {
    return { slots: (days[0]?.slots || []).map(cleanSlot) };
  }

  const meals = days.map((d) => {
    const out: Record<string, any> = { day: d.day };
    const used = new Set<string>();
    d.slots.forEach((s, idx) => {
      const items = s.items.filter((i) => i.food);
      if (!items.length) return;
      const t = slotTotals({ ...s, items });
      let key = slotKeyFor(s.name, idx);
      // Two custom meals can map to the same key — keep both.
      while (used.has(key)) key = `${key}_${idx + 1}`;
      used.add(key);
      out[key] = {
        // `name` + `order` are what make custom meals (Pre-Workout, Bedtime…)
        // survive a save/load round-trip in the exact order the trainer set.
        name: s.name,
        order: idx,
        meal: items.map((i) => i.food).join(' + '),
        quantity: items.map((i) => i.quantity).filter(Boolean).join(' + '),
        items: items.map((i) => ({ ...i })),
        time: s.time,
        calories: t.calories,
        protein: t.protein,
        carbs: t.carbs,
        fats: t.fats,
        fat: t.fats,
        catalog_id: items.length === 1 ? items[0].catalog_id : undefined,
        recipe_link: s.recipe_link || undefined,
        prep_video_url: s.prep_video_url || undefined,
        prep_video_file_path: s.prep_video_file_path || undefined,
      };
    });
    out.totals = dayTotals(d);
    return out;
  });


  return { meals };
}

const NON_VEG = /(chicken|mutton|fish|prawn|egg|turkey|bacon|meat|salmon|tuna)/i;
const EGG_ONLY = /egg/i;
const INDIAN = /(roti|paneer|dal|sabzi|poha|idli|dosa|chapati|khichdi|sprouts|curd|rajma|chole|upma|thepla)/i;

/** Infer dietary type / cuisine for older content that never stored them. */
export function inferDietMeta(days: DietDay[]): { dietaryType: string; cuisine: string } {
  const foods = days
    .flatMap((d) => d.slots.flatMap((s) => s.items.map((i) => i.food)))
    .join(' ');
  const dietaryType = NON_VEG.test(foods)
    ? EGG_ONLY.test(foods) && !/(chicken|mutton|fish|prawn|meat|salmon|tuna|bacon|turkey)/i.test(foods)
      ? 'eggetarian'
      : 'non_vegetarian'
    : 'vegetarian';
  const cuisine = INDIAN.test(foods) ? 'indian' : 'mixed';
  return { dietaryType, cuisine };
}
