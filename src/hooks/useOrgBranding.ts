import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OrgBranding {
  name: string | null;
  logo_url: string | null;
}

/**
 * Branding (gym name + logo) for every signed-in user, including members.
 * Reads via the `get_org_branding` RPC so members don't need access to the
 * full organisation settings row.
 */
export function useOrgBranding() {
  return useQuery<OrgBranding | null>({
    queryKey: ['org-branding'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Pass the (optional) branch argument explicitly so the call resolves to
      // the branch-aware function signature.
      const { data, error } = await (supabase as any).rpc('get_org_branding', { _branch_id: null });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as OrgBranding) ?? null;
    },
  });
}
