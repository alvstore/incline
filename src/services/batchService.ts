import { supabase } from '@/integrations/supabase/client';

export type BatchStatus = 'active' | 'depleted' | 'expired' | 'recalled' | 'quarantined';

export interface ProductBatch {
  id: string;
  product_id: string;
  branch_id: string;
  batch_number: string;
  mfg_date: string | null;
  exp_date: string | null;
  quantity_received: number;
  quantity_remaining: number;
  cost_price: number | null;
  supplier: string | null;
  invoice_ref: string | null;
  lab_report_url: string | null;
  lab_report_filename: string | null;
  lab_report_uploaded_at: string | null;
  lab_verified: boolean;
  lab_verified_by: string | null;
  status: BatchStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const TABLE = 'product_batches';
const BUCKET = 'product-lab-reports';
const MAX_LAB_REPORT_SIZE = 10 * 1024 * 1024;
const ALLOWED_LAB_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export async function fetchBatches(productId: string, branchId?: string | null): Promise<ProductBatch[]> {
  let q = (supabase.from(TABLE as any) as any)
    .select('*')
    .eq('product_id', productId)
    .order('exp_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (branchId) q = q.eq('branch_id', branchId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as ProductBatch[];
}

export interface CreateBatchInput {
  product_id: string;
  branch_id: string;
  batch_number: string;
  mfg_date?: string | null;
  exp_date?: string | null;
  quantity_received: number;
  cost_price?: number | null;
  supplier?: string | null;
  invoice_ref?: string | null;
  lab_report_url?: string | null;
  lab_report_filename?: string | null;
  notes?: string | null;
}

export async function createBatch(input: CreateBatchInput): Promise<ProductBatch> {
  const { data: { user } } = await supabase.auth.getUser();
  const payload: any = {
    ...input,
    quantity_remaining: input.quantity_received,
    lab_report_uploaded_at: input.lab_report_url ? new Date().toISOString() : null,
    created_by: user?.id ?? null,
  };
  const { data, error } = await (supabase.from(TABLE as any) as any)
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  const { data: inv } = await supabase
    .from('inventory')
    .select('id, quantity')
    .eq('product_id', input.product_id)
    .eq('branch_id', input.branch_id)
    .maybeSingle();

  if (inv) {
    await supabase
      .from('inventory')
      .update({
        quantity: (inv.quantity || 0) + input.quantity_received,
        last_restocked_at: new Date().toISOString(),
      })
      .eq('id', inv.id);
  } else {
    await supabase.from('inventory').insert({
      product_id: input.product_id,
      branch_id: input.branch_id,
      quantity: input.quantity_received,
      min_quantity: 5,
      last_restocked_at: new Date().toISOString(),
    });
  }

  // Stock history row is written by the trg_product_batch_stock_in database trigger.

  return data as ProductBatch;
}

export async function updateBatch(id: string, patch: Partial<ProductBatch>): Promise<ProductBatch> {
  const { data, error } = await (supabase.from(TABLE as any) as any)
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ProductBatch;
}

export async function setBatchStatus(id: string, status: BatchStatus): Promise<void> {
  const { error } = await (supabase.from(TABLE as any) as any)
    .update({ status })
    .eq('id', id);
  if (error) throw error;
}

export async function uploadLabReport(productId: string, batchNumber: string, file: File): Promise<{ path: string; filename: string }> {
  if (!ALLOWED_LAB_MIMES.includes(file.type)) {
    throw new Error(`Unsupported file type. Use PDF, JPG, PNG or WebP.`);
  }
  if (file.size > MAX_LAB_REPORT_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10MB.`);
  }
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const safeBatch = batchNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${productId}/${safeBatch}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return { path, filename: file.name };
}

export async function signLabReport(path: string, ttlSeconds = 60): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function suggestBatchNumber(sku: string | null | undefined, existingCount: number): string {
  const prefix = (sku || 'INC').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || 'INC';
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const seq = String(existingCount + 1).padStart(2, '0');
  return `${prefix}-${yy}${mm}${dd}-${seq}`;
}
