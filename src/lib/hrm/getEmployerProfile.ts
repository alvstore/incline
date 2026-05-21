import { supabase } from '@/integrations/supabase/client';

export interface EmployerProfile {
  branch_id: string | null;
  legal_name: string;
  brand_name: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  full_address: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  pan: string | null;
  proprietor_name: string | null;
  firm_registration_no: string | null;
  arbitration_seat: string | null;
  governing_jurisdiction: string | null;
  posh_ic: Array<{ name: string; role: string; phone?: string; email?: string }> | null;
  notice_period_staff_days: number | null;
  notice_period_trainer_days: number | null;
  notice_period_manager_days: number | null;
  basic_pct_of_ctc: number | null;
  ot_multiplier: number | null;
  daily_hour_cap: number | null;
  weekly_hour_cap: number | null;
}

/**
 * Single source of truth for employer details.
 * Merges `branches` + `organization_settings` + `hr_settings` via the
 * `get_employer_profile` RPC. Never duplicate these fields in a form.
 */
export async function getEmployerProfile(branchId: string | null): Promise<EmployerProfile | null> {
  const { data, error } = await supabase.rpc('get_employer_profile', {
    _branch_id: branchId as any,
  });
  if (error) throw error;
  return (data ?? null) as EmployerProfile | null;
}
