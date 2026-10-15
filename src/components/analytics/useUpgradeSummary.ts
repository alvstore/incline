import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { UpgradeTimelineOffer } from './UpgradeTimelineRow';

export interface UpgradeSummary {
  stats: { in_window: number; closing_soon: number; converted_month: number; conversion_revenue_month: number };
  offers: UpgradeTimelineOffer[]; total: number; server_now: string;
}

export function useUpgradeSummary(branchId: string | null, page: number, enabled = true) {
  return useQuery({
    queryKey: ['upgrade-analytics-summary', branchId, page], enabled: Boolean(branchId) && enabled,
    staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: async (): Promise<UpgradeSummary> => {
      if (!branchId) throw new Error('Select a branch');
      const { data, error } = await supabase.rpc('upgrade_analytics_summary', { p_branch_id: branchId, p_page: page });
      if (error) throw error;
      return data as unknown as UpgradeSummary;
    },
  });
}