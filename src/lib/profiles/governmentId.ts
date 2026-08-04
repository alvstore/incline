import { supabase } from '@/integrations/supabase/client';

export interface GovernmentIdRecord {
  id: string;
  government_id_type: string | null;
  government_id_number: string | null;
  government_id_verified: boolean | null;
}

/**
 * Government ID numbers are not readable through a plain `profiles` select.
 * Column-level SELECT is revoked; only the owner of the profile and
 * owner/admin/manager roles can read it via this SECURITY DEFINER RPC.
 * Returns null when the caller is not authorized.
 */
export async function fetchGovernmentId(
  profileId?: string | null,
): Promise<GovernmentIdRecord | null> {
  if (!profileId) return null;
  const { data, error } = await supabase.rpc('get_profile_government_id', {
    _profile_id: profileId,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as GovernmentIdRecord) || null;
}
