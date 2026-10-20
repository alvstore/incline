import { supabase } from '@/integrations/supabase/client';
import type { StockMode, StockReason } from '@/lib/products/productRules';

export interface AdjustStockInput {
  productId: string;
  branchId: string;
  mode: StockMode;
  quantity: number;
  reason: StockReason;
  notes?: string | null;
  batchId?: string | null;
}

export interface AdjustStockResult {
  success: boolean;
  old_quantity: number;
  new_quantity: number;
  delta: number;
}

/** Atomic stock adjustment (inventory + batch + stock history in one transaction). */
export async function adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
  const { data, error } = await supabase.rpc('adjust_product_stock', {
    p_product_id: input.productId,
    p_branch_id: input.branchId,
    p_mode: input.mode,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
    p_batch_id: input.batchId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as AdjustStockResult;
}

/** Reorder level per branch; creates the stock row if the product has none yet. */
export async function setReorderLevel(productId: string, branchId: string, minQuantity: number) {
  const { error } = await supabase
    .from('inventory')
    .upsert({ product_id: productId, branch_id: branchId, min_quantity: minQuantity }, { onConflict: 'product_id,branch_id' });
  if (error) throw new Error(error.message);
}

/** Switch a product on/off for POS and the member store. Server enforces price + photo. */
export async function setSellable(productId: string, sellable: boolean, patch?: { image_url?: string; price?: number }) {
  const { error } = await supabase
    .from('products')
    .update({ ...(patch ?? {}), is_sellable: sellable })
    .eq('id', productId);
  if (error) throw new Error(error.message);
}

export interface StockMovementRow {
  id: string;
  product_id: string;
  branch_id: string;
  batch_id: string | null;
  movement_type: string;
  quantity: number;
  reference_type: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  products: { name: string } | null;
}

export async function fetchStockMovements(branchId: string | undefined, productId?: string, limit = 100) {
  let q = supabase
    .from('stock_movements')
    .select('id, product_id, branch_id, batch_id, movement_type, quantity, reference_type, notes, created_by, created_at, products(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (branchId) q = q.eq('branch_id', branchId);
  if (productId) q = q.eq('product_id', productId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as StockMovementRow[];
}
