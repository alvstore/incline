import { supabase } from '@/integrations/supabase/client';
import { normalizePhone, phoneVariants } from '@/lib/contacts/phone';

export interface ContactRow {
  id: string;
  branch_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  category: string;
  company: string | null;
  notes: string | null;
  tags: string[];
  source_type: 'manual' | 'lead' | 'member' | 'ai' | string;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactInput {
  branch_id: string;
  full_name: string;
  phone: string;
  email?: string | null;
  category?: string;
  company?: string | null;
  notes?: string | null;
  tags?: string[];
}

export const CONTACT_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'partner', label: 'Partner' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'other', label: 'Other' },
];

export async function listContacts(branchId?: string | null): Promise<ContactRow[]> {
  let q = supabase.from('contacts').select('*').order('full_name', { ascending: true });
  if (branchId && branchId !== 'all') q = q.eq('branch_id', branchId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ContactRow[];
}

export async function findContactByPhone(phone: string): Promise<ContactRow | null> {
  const variants = phoneVariants(phone);
  if (!variants.length) return null;
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .in('phone', variants)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ContactRow) ?? null;
}

export async function upsertContact(input: ContactInput): Promise<ContactRow> {
  const payload = {
    ...input,
    phone: normalizePhone(input.phone),
    category: input.category || 'general',
    tags: input.tags || [],
  };
  const { data, error } = await supabase
    .from('contacts')
    .upsert(payload, { onConflict: 'branch_id,phone' })
    .select('*')
    .single();
  if (error) throw error;
  return data as ContactRow;
}

export async function updateContact(id: string, patch: Partial<ContactInput>): Promise<ContactRow> {
  const payload: Record<string, unknown> = { ...patch };
  if (patch.phone) payload.phone = normalizePhone(patch.phone);
  const { data, error } = await supabase
    .from('contacts')
    .update(payload as never)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ContactRow;
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw error;
}
