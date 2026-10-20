import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Branch toggle `settings.pt_manual_mark_enabled` (default OFF).
 * Off = PT attendance comes only from gate scans; trainers fix mistakes via manager-approved corrections.
 * On = legacy direct "Mark" buttons for branches whose gate is not live yet.
 */
export function usePtManualMark(branchId: string | null | undefined) {
  const { data } = useQuery({
    queryKey: ['settings', 'pt_manual_mark_enabled', branchId],
    enabled: !!branchId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value, branch_id')
        .eq('key', 'pt_manual_mark_enabled')
        .or(`branch_id.eq.${branchId},branch_id.is.null`);
      if (error) return false;
      const row = (data ?? []).find(r => r.branch_id === branchId) ?? (data ?? [])[0];
      const v = row?.value as unknown;
      return v === true || v === 'true' || (typeof v === 'object' && v !== null && (v as { enabled?: boolean }).enabled === true);
    },
  });
  return data === true;
}
