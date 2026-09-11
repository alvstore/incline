import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type RenewalQueue = 'all' | 'due_soon' | 'today' | 'lapsed' | 'voice' | 'callback' | 'won' | 'lost';

export interface RenewalCaseRow {
  case_id: string;
  branch_id: string;
  member_id: string;
  member_name: string;
  member_code: string;
  masked_phone: string | null;
  plan_name: string | null;
  expiry_date: string;
  days_to_expiry: number;
  stage: string;
  attempts_count: number;
  voice_attempts_count: number;
  last_contact_at: string | null;
  next_action_at: string | null;
  claimed_by: string | null;
  claimed_name: string | null;
  snoozed_until: string | null;
  outcome: string | null;
  churn_reason: string | null;
  paused_reason: string | null;
  renewal_evidence: string | null;
  value_score: number | null;
  last_visit: string | null;
  latest_event: string | null;
  latest_event_at: string | null;
  total_count: number;
}

export interface RenewalActionInput {
  caseId: string;
  action: 'claim' | 'unclaim' | 'snooze' | 'voice_escalate' | 'manual_contact' | 'outcome';
  snoozedUntil?: string | null;
  outcome?: string | null;
  churnReason?: string | null;
  note?: string | null;
}

export function useRenewalQueue(branchId: string | undefined, queue: RenewalQueue, search: string) {
  return useQuery({
    queryKey: ['renewal-center', branchId ?? 'all', queue, search],
    queryFn: async (): Promise<RenewalCaseRow[]> => {
      const { data, error } = await supabase.rpc('renewal_center_queue', {
        _branch_id: branchId ?? undefined,
        _queue: queue,
        _search: search.trim() || undefined,
        _limit: 100,
        _offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as RenewalCaseRow[];
    },
  });
}

export function useRenewalFunnel(branchId: string | undefined) {
  return useQuery({
    queryKey: ['renewal-funnel', branchId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('renewal_funnel', { _branch_id: branchId ?? undefined, _days: 90 });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });
}

export function useRenewalAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RenewalActionInput) => {
      const { data, error } = await supabase.rpc('renewal_case_action', {
        _case_id: input.caseId,
        _action: input.action,
        _snoozed_until: input.snoozedUntil ?? undefined,
        _outcome: input.outcome ?? undefined,
        _churn_reason: input.churnReason ?? undefined,
        _note: input.note ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['renewal-center'] }),
        queryClient.invalidateQueries({ queryKey: ['renewal-funnel'] }),
      ]);
    },
  });
}