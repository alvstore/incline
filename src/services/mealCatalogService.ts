import { supabase } from '@/integrations/supabase/client';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'pre_workout' | 'post_workout';

export interface MealCatalogEntry {
  id: string;
  branch_id: string | null;
  name: string;
  dietary_type: 'vegetarian' | 'non_vegetarian' | 'vegan' | 'pescatarian';
  cuisine: 'indian' | 'indian_modern' | 'continental' | 'asian' | 'mediterranean' | 'mixed';
  meal_type: MealType;
  default_quantity: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  micronutrients?: string | null;
  tags: string[];
  notes: string | null;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MealCatalogFilter {
  dietaryType?: string | null;
  cuisine?: string | null;
  mealType?: MealType | null;
  branchId?: string | null;
  search?: string;
}

const TABLE = 'meal_catalog';

export async function fetchMealCatalog(filter: MealCatalogFilter = {}): Promise<MealCatalogEntry[]> {
  // Cast through `any` because meal_catalog is not yet in generated types.
  let query = (supabase.from(TABLE as any) as any)
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (filter.dietaryType) query = query.eq('dietary_type', filter.dietaryType);
  if (filter.cuisine) query = query.eq('cuisine', filter.cuisine);
  if (filter.mealType) query = query.eq('meal_type', filter.mealType);
  if (filter.search) query = query.ilike('name', `%${filter.search}%`);
  if (filter.branchId) {
    query = query.or(`branch_id.eq.${filter.branchId},branch_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as MealCatalogEntry[];
}

export async function createMealCatalogEntry(
  entry: Omit<MealCatalogEntry, 'id' | 'created_at' | 'updated_at' | 'is_active'> & { is_active?: boolean },
): Promise<MealCatalogEntry> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await (supabase.from(TABLE as any) as any)
    .insert({ ...entry, created_by: user?.id })
    .select()
    .single();
  if (error) throw error;
  return data as MealCatalogEntry;
}

export async function updateMealCatalogEntry(
  id: string,
  patch: Partial<MealCatalogEntry>,
): Promise<MealCatalogEntry> {
  const { data, error } = await (supabase.from(TABLE as any) as any)
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as MealCatalogEntry;
}

export async function deleteMealCatalogEntry(id: string): Promise<void> {
  // Soft delete to preserve historical references in plan drafts.
  const { error } = await (supabase.from(TABLE as any) as any)
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

export type BulkMealRow = Partial<MealCatalogEntry> & { name: string };

/**
 * CSV import path. Matches existing rows by lower-cased name within the branch
 * scope so a download -> edit -> re-upload round trip updates instead of
 * duplicating. Returns how many rows were created vs updated.
 */
export async function bulkUpsertMealCatalog(
  rows: BulkMealRow[],
  branchId: string | null = null,
): Promise<{ created: number; updated: number }> {
  if (!rows.length) return { created: 0, updated: 0 };

  const { data: { user } } = await supabase.auth.getUser();

  let existingQ = (supabase.from(TABLE as any) as any).select('id, name');
  existingQ = branchId
    ? existingQ.or(`branch_id.eq.${branchId},branch_id.is.null`)
    : existingQ.is('branch_id', null);
  const { data: existing } = await existingQ;

  const byName = new Map<string, string>();
  (existing || []).forEach((m: any) => byName.set(String(m.name).toLowerCase(), m.id));

  const toInsert: any[] = [];
  const toUpdate: { id: string; patch: any }[] = [];

  rows.forEach((r) => {
    const payload = {
      name: r.name,
      dietary_type: r.dietary_type,
      cuisine: r.cuisine,
      meal_type: r.meal_type,
      default_quantity: r.default_quantity ?? null,
      calories: r.calories ?? 0,
      protein: r.protein ?? 0,
      carbs: r.carbs ?? 0,
      fats: r.fats ?? 0,
      fiber: r.fiber ?? 0,
      micronutrients: r.micronutrients ?? null,
      tags: r.tags ?? [],
      notes: r.notes ?? null,
      is_active: true,
    };
    const match = byName.get(r.name.toLowerCase());
    if (match) toUpdate.push({ id: match, patch: payload });
    else toInsert.push({ ...payload, branch_id: branchId, created_by: user?.id });
  });

  if (toInsert.length) {
    const { error } = await (supabase.from(TABLE as any) as any).insert(toInsert);
    if (error) throw error;
  }

  for (const u of toUpdate) {
    const { error } = await (supabase.from(TABLE as any) as any).update(u.patch).eq('id', u.id);
    if (error) throw error;
  }

  return { created: toInsert.length, updated: toUpdate.length };
}

