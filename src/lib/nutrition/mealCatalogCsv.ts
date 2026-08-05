import type { MealCatalogEntry, MealType } from '@/services/mealCatalogService';

export const MEAL_CSV_COLUMNS = [
  'name',
  'meal_type',
  'dietary_type',
  'cuisine',
  'default_quantity',
  'calories',
  'protein',
  'carbs',
  'fats',
  'fiber',
  'micronutrients',
  'tags',
  'notes',
] as const;

export const MEAL_TYPE_VALUES: MealType[] = [
  'breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout',
];
export const DIETARY_VALUES = ['vegetarian', 'non_vegetarian', 'vegan', 'pescatarian'];
export const CUISINE_VALUES = ['indian', 'indian_modern', 'continental', 'asian', 'mediterranean', 'mixed'];

export type ParsedMealRow = {
  rowNumber: number;
  status: 'new' | 'update' | 'error';
  errors: string[];
  values: Partial<MealCatalogEntry> & { name: string };
};

/* ------------------------------------------------------------------ */
/* CSV primitives                                                      */
/* ------------------------------------------------------------------ */

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Quote-aware CSV reader — handles embedded commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map(r => r.map(escapeCell).join(',')).join('\n');
}

export function downloadCsvFile(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function mealsToCsv(meals: MealCatalogEntry[]): string {
  return toCsv([
    [...MEAL_CSV_COLUMNS],
    ...meals.map(m => [
      m.name,
      m.meal_type,
      m.dietary_type,
      m.cuisine,
      m.default_quantity || '',
      m.calories ?? 0,
      m.protein ?? 0,
      m.carbs ?? 0,
      m.fats ?? 0,
      m.fiber ?? 0,
      m.micronutrients || '',
      (m.tags || []).join('; '),
      m.notes || '',
    ]),
  ]);
}

export function mealTemplateCsv(): string {
  return toCsv([
    [...MEAL_CSV_COLUMNS],
    ['Oats + Milk + Banana', 'breakfast', 'vegetarian', 'indian', '1 bowl', 420, 18, 63, 10, 6, 'Calcium, Magnesium, Potassium, B vitamins', 'high-fibre; quick', 'Soak oats overnight for faster prep'],
    ['Grilled Chicken + Rice', 'lunch', 'non_vegetarian', 'indian', '150g + 1 cup', 560, 45, 48, 12, 3, 'Iron, B12', 'high-protein', ''],
  ]);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

const num = (v: string) => {
  const t = (v ?? '').toString().trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const slug = (v: string) => (v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function parseMealCsv(text: string, existingNames: Set<string>): ParsedMealRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const header = rows[0].map(h => slug(h));
  const idx = (key: string) => header.indexOf(key);
  const get = (r: string[], key: string) => {
    const i = idx(key);
    return i === -1 ? '' : (r[i] ?? '').trim();
  };

  const seen = new Set<string>();

  return rows.slice(1).map((r, i) => {
    const errors: string[] = [];
    const name = get(r, 'name');
    if (!name) errors.push('Name is required');

    const key = name.toLowerCase();
    if (key && seen.has(key)) errors.push('Duplicate name inside this file');
    if (key) seen.add(key);

    const mealType = slug(get(r, 'meal_type')) || 'breakfast';
    if (!MEAL_TYPE_VALUES.includes(mealType as MealType)) {
      errors.push(`Unknown meal type "${get(r, 'meal_type')}"`);
    }
    const dietary = slug(get(r, 'dietary_type')) || 'vegetarian';
    if (!DIETARY_VALUES.includes(dietary)) errors.push(`Unknown diet "${get(r, 'dietary_type')}"`);
    const cuisine = slug(get(r, 'cuisine')) || 'indian';
    if (!CUISINE_VALUES.includes(cuisine)) errors.push(`Unknown cuisine "${get(r, 'cuisine')}"`);

    const macros = {
      calories: num(get(r, 'calories')),
      protein: num(get(r, 'protein')),
      carbs: num(get(r, 'carbs')),
      fats: num(get(r, 'fats')),
      fiber: num(get(r, 'fiber')),
    };
    (Object.entries(macros) as [string, number][]).forEach(([k, v]) => {
      if (Number.isNaN(v)) errors.push(`${k} is not a number`);
      else if (v < 0) errors.push(`${k} cannot be negative`);
    });

    const tags = get(r, 'tags')
      .split(/[;|]/)
      .map(t => t.trim())
      .filter(Boolean);

    return {
      rowNumber: i + 2,
      status: errors.length ? 'error' : existingNames.has(key) ? 'update' : 'new',
      errors,
      values: {
        name,
        meal_type: mealType as MealType,
        dietary_type: dietary as MealCatalogEntry['dietary_type'],
        cuisine: cuisine as MealCatalogEntry['cuisine'],
        default_quantity: get(r, 'default_quantity') || null,
        calories: Math.round(macros.calories) || 0,
        protein: macros.protein || 0,
        carbs: macros.carbs || 0,
        fats: macros.fats || 0,
        fiber: macros.fiber || 0,
        micronutrients: get(r, 'micronutrients') || null,
        tags,
        notes: get(r, 'notes') || null,
      },
    } as ParsedMealRow;
  });
}
