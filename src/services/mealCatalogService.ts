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
