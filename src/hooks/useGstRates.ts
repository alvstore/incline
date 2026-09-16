import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const DEFAULT_GST_RATES = [5, 12, 18, 28];

export function useGstRates() {
  return useQuery({
    queryKey: ['org-gst-rates'],
    queryFn: async () => {
      // Read through the safe config function so staff and managers (who have
      // no direct access to the company settings row) still get the real rates.
      const { data, error } = await supabase.rpc('get_org_config', { _branch_id: null });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const rates = (row as { gst_rates?: unknown } | null)?.gst_rates as number[] | null;
      return (rates && Array.isArray(rates) && rates.length > 0) ? rates : DEFAULT_GST_RATES;
    },
    staleTime: 5 * 60 * 1000,
  });
}
