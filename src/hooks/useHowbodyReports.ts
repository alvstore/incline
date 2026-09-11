import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface HowbodyReportRow {
  id: string;
  member_id: string;
  data_key: string;
  test_time: string | null;
  created_at: string;
  type: 'body' | 'posture';
  pdf_url?: string | null;
  // body
  health_score?: number | null;
  weight?: number | null;
  bmi?: number | null;
  pbf?: number | null;
  smm?: number | null;
  tbw?: number | null;
  bmr?: number | null;
  vfr?: number | null;
  metabolic_age?: number | null;
  target_weight?: number | null;
  weight_control?: number | null;
  fat_control?: number | null;
  muscle_control?: number | null;
  icf?: number | null;
  ecf?: number | null;
  whr?: number | null;
  // posture
  score?: number | null;
  head_forward?: number | null;
  high_low_shoulder?: number | null;
  pelvis_forward?: number | null;
  body_slope?: number | null;
  equipment_no?: string | null;
  front_img?: string | null;
  left_img?: string | null;
  right_img?: string | null;
  back_img?: string | null;
  model_url?: string | null;
}

export function useHowbodyReports(memberId?: string, limit = 12) {
  return useQuery({
    queryKey: ['howbody-reports', memberId, limit],
    enabled: !!memberId,
    queryFn: async (): Promise<HowbodyReportRow[]> => {
      const [body, posture, deliveries] = await Promise.all([
        supabase
          .from('howbody_body_reports')
          .select('id, member_id, data_key, test_time, created_at, health_score, weight, bmi, pbf, smm, tbw, bmr, vfr, metabolic_age, target_weight, weight_control, fat_control, muscle_control, icf, ecf, whr')
          .eq('member_id', memberId!)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('howbody_posture_reports')
          .select('id, member_id, data_key, test_time, created_at, score, head_forward, high_low_shoulder, pelvis_forward, body_slope, equipment_no, front_img, left_img, right_img, back_img, model_url')
          .eq('member_id', memberId!)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('scan_report_deliveries')
          .select('report_id, kind, pdf_url')
          .eq('member_id', memberId!),
      ]);

      const deliveryMap = (deliveries.data || []).reduce((acc: any, d: any) => {
        acc[`${d.kind}-${d.report_id}`] = d.pdf_url;
        return acc;
      }, {});

      const rows: HowbodyReportRow[] = [
        ...((body.data || []) as any[]).map((r) => ({
          ...r,
          type: 'body' as const,
          pdf_url: deliveryMap[`body-${r.id}`] || null,
        })),
        ...((posture.data || []) as any[]).map((r) => ({
          ...r,
          type: 'posture' as const,
          pdf_url: deliveryMap[`posture-${r.id}`] || null,
        })),
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
