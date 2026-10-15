import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { UpgradeTimelineOffer } from './UpgradeTimelineRow';
import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';

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
      const summary = data as unknown as UpgradeSummary;
      if (!summary.offers.length) return summary;
      const { data: identities, error: photoError } = await supabase.from('members')
        .select('id, profiles:user_id(avatar_url), lead:lead_id(avatar_url)')
        .eq('branch_id', branchId).in('id', summary.offers.map(offer => offer.member_id));
      // Failed photos must never hide deadlines; initials remain available.
      if (photoError) return summary;
      const photos = new Map(identities?.map(member => [member.id, resolveMemberDisplay(member).avatar_url]));
      return { ...summary, offers: summary.offers.map(offer => ({ ...offer, avatar_url: photos.get(offer.member_id) ?? null })) };
    },
  });
}