import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface HowbodyReportRow {
  id: string;
  member_id: string;
  data_key: string;
  test_time: string | null;
  created_at: string;
  type: 'body' | 'posture';
  // body
  health_score?: number | null;
  weight?: number | null;
  bmi?: number | null;
  pbf?: number | null;
  smm?: number | null;
  // posture
  score?: number | null;
  head_forward?: number | null;
  high_low_shoulder?: number | null;
  pelvis_forward?: number | null;
  body_slope?: number | null;
}

export function useHowbodyReports(memberId?: string, limit = 12) {
  return useQuery({
    queryKey: ['howbody-reports', memberId, limit],
    enabled: !!memberId,
    queryFn: async (): Promise<HowbodyReportRow[]> => {
      const [body, posture] = await Promise.all([
        supabase
          .from('howbody_body_reports')
          .select('id, member_id, data_key, test_time, created_at, health_score, weight, bmi, pbf, smm')
          .eq('member_id', memberId!)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('howbody_posture_reports')
          .select('id, member_id, data_key, test_time, created_at, score, head_forward, high_low_shoulder, pelvis_forward, body_slope')
          .eq('member_id', memberId!)
          .order('created_at', { ascending: false })
          .limit(limit),
      ]);
      const rows: HowbodyReportRow[] = [
        ...((body.data || []) as any[]).map((r) => ({ ...r, type: 'body' as const })),
        ...((posture.data || []) as any[]).map((r) => ({ ...r, type: 'posture' as const })),
      ];
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return rows.slice(0, limit);
    },
  });
}

export interface ScanQuota {
  kind: string;
  benefit_code: string;
  plan_limit: number;
  plan_frequency: string | null;
  used_this_period: number;
  used_this_month: number;
  plan_remaining: number;
  addon_remaining: number;
  allowed: boolean;
  reason: string;
}

export function useScanQuota(memberId?: string) {
  return useQuery({
    queryKey: ['howbody-scan-quota', memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<{ body: ScanQuota; posture: ScanQuota }> => {
      const [b, p] = await Promise.all([
        supabase.rpc('howbody_scan_quota' as any, { _member_id: memberId, _kind: 'body' }),
        supabase.rpc('howbody_scan_quota' as any, { _member_id: memberId, _kind: 'posture' }),
      ]);
      return {
        body: (b.data || {}) as ScanQuota,
        posture: (p.data || {}) as ScanQuota,
      };
    },
  });
}
