import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ClientBrief } from '@/lib/trainers/clientBrief';

/** Goals / health / diet captured at registration, for the calling trainer's own clients only (server-checked). */
export function useTrainerClientBriefs(enabled: boolean) {
  return useQuery({
    queryKey: ['trainer-client-briefs'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, ClientBrief>> => {
      const { data, error } = await supabase.rpc('get_trainer_client_briefs', {});
      if (error) throw error;
      const out: Record<string, ClientBrief> = {};
      for (const r of (data ?? []) as ClientBrief[]) out[r.member_id] = r;
      return out;
    },
  });
}

/** Branch kill switch `settings.trainer_dashboard_v2` — ON unless explicitly set false. */
export function useTrainerDashboardV2(branchId: string | null | undefined) {
  const { data } = useQuery({
    queryKey: ['settings', 'trainer_dashboard_v2', branchId],
    enabled: !!branchId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value, branch_id')
        .eq('key', 'trainer_dashboard_v2')
        .or(`branch_id.eq.${branchId},branch_id.is.null`);
      if (error) return true;
      const row = (data ?? []).find((r) => r.branch_id === branchId) ?? (data ?? [])[0];
      const v = row?.value as unknown;
      if (v === false || v === 'false') return false;
      if (typeof v === 'object' && v !== null && (v as { enabled?: boolean }).enabled === false) return false;
      return true;
    },
  });
  return data !== false;
}
