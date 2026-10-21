import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { track } from '@/lib/analytics';

export interface HealthGuidance {
  summary: string;
  warning_signs: string[];
  avoid_or_modify: string[];
  safer_alternatives: string[];
  how_to_start: string[];
  ask_before_training: string[];
  needs_doctor_clearance: boolean;
}

/** PAR-Q "yes" answers + age for the trainer's own client (server-checked, view is audit-logged). */
export function useClientHealthDetail(memberId: string | null) {
  return useQuery({
    queryKey: ['trainer-client-health', memberId],
    enabled: !!memberId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trainer_client_health', { p_member_id: memberId! });
      if (error) throw error;
      track('health_brief_opened');
      const d = (data ?? {}) as { parq_yes?: string[]; age?: number | null };
      return { parqYes: d.parq_yes ?? [], age: d.age ?? null };
    },
  });
}

type GuidanceResult = { guidance: HealthGuidance; generated_at?: string; cached?: boolean };

async function invoke(memberId: string, refresh: boolean): Promise<GuidanceResult> {
  const { data, error } = await supabase.functions.invoke('trainer-health-guidance', { body: { member_id: memberId, refresh } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { const b = await ctx?.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as GuidanceResult;
}

export function useHealthGuidance(memberId: string | null) {
  const qc = useQueryClient();
  const key = ['trainer-health-guidance', memberId];
  const query = useQuery({ queryKey: key, enabled: false, queryFn: () => invoke(memberId!, false) });
  const mutation = useMutation({
    mutationFn: (refresh: boolean) => invoke(memberId!, refresh),
    onSuccess: (res) => {
      qc.setQueryData(key, res);
      track('health_guidance_generated', { cached: !!res.cached });
    },
  });
  return { data: query.data, ...mutation };
}

/** Branch kill switch `settings.trainer_health_ai` — ON unless explicitly false. */
export function useTrainerHealthAiEnabled(branchId: string | null | undefined) {
  const { data } = useQuery({
    queryKey: ['settings', 'trainer_health_ai', branchId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = supabase.from('settings').select('value, branch_id').eq('key', 'trainer_health_ai');
      q = branchId ? q.or(`branch_id.eq.${branchId},branch_id.is.null`) : q.is('branch_id', null);
      const { data, error } = await q;
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
