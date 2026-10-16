import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_LOCKER_PRICING, type LockerPricingConfig } from '@/components/member/requests/requestTypes';

export interface LockerPricingSettings extends LockerPricingConfig {
  branch_id: string;
  portal_requests_enabled: boolean;
  daily_use_note: string | null;
  updated_at: string | null;
}

export function useLockerPricing(branchId: string | null | undefined) {
  return useQuery({
    queryKey: ['locker-pricing', branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: async (): Promise<LockerPricingSettings> => {
      const { data, error } = await supabase
        .from('locker_pricing_settings')
        .select('*')
        .eq('branch_id', branchId!)
        .maybeSingle();
      if (error) throw error;
      return {
        branch_id: branchId!,
        portal_requests_enabled: true,
        daily_use_note: null,
        updated_at: null,
        ...DEFAULT_LOCKER_PRICING,
        ...(data ?? {}),
        medium_fee: Number(data?.medium_fee ?? DEFAULT_LOCKER_PRICING.medium_fee),
        large_fee: Number(data?.large_fee ?? DEFAULT_LOCKER_PRICING.large_fee),
        gst_rate: Number(data?.gst_rate ?? DEFAULT_LOCKER_PRICING.gst_rate),
      };
    },
  });
}

export function useUpdateLockerPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Omit<LockerPricingSettings, 'updated_at'>) => {
      const { data, error } = await supabase.rpc('update_locker_pricing_settings', {
        p_branch_id: s.branch_id,
        p_medium_fee: s.medium_fee,
        p_large_fee: s.large_fee,
        p_gst_enabled: s.gst_enabled,
        p_gst_rate: s.gst_rate,
        p_portal_requests_enabled: s.portal_requests_enabled,
        p_daily_use_note: s.daily_use_note ?? '',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['locker-pricing', v.branch_id] }),
  });
}
