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

export interface RenewalVoiceCall {
  call_id: string;
  started_at: string | null;
  ended_at: string | null;
  status: string | null;
  disposition: string | null;
  duration_seconds: number | null;
  call_summary: string | null;
  next_step_agreed: string | null;
  callback_datetime: string | null;
}

/** Voice AI calls already placed for one renewal case (sanitized, no transcript). */
export function useRenewalCaseVoiceCalls(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ['renewal-case-voice-calls', caseId],
    enabled: Boolean(caseId),
    queryFn: async (): Promise<RenewalVoiceCall[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('renewal_case_voice_calls', { _case_id: caseId });
      if (error) throw error;
      return (data ?? []) as RenewalVoiceCall[];
    },
    refetchInterval: 20_000,
  });
}

/**
 * Place a renewal call through the single Sarvam agent, then bind the attempt
 * to the renewal case so the webhook outcome flows back into the queue.
 */
export function useRenewalVoiceCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { caseId: string; memberId: string }) => {
      const { data, error } = await supabase.functions.invoke('sarvam-voice', {
        body: {
          action: 'place_call',
          confirmed: true,
          member_id: input.memberId,
          reason: 'member_renewal',
          cooldown_days: 0,
        },
      });
      if (error) throw error;
      const res = (data ?? {}) as { ok?: boolean; error?: string; call_record_id?: string };
      if (res.ok === false) throw new Error(res.error || 'Voice AI could not start the call');
      if (res.call_record_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: linkError } = await (supabase as any).rpc('renewal_link_voice_call', {
          _case_id: input.caseId,
          _attempt_id: res.call_record_id,
        });
        if (linkError) throw linkError;
      }
      return res;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['renewal-center'] }),
        queryClient.invalidateQueries({ queryKey: ['renewal-funnel'] }),
        queryClient.invalidateQueries({ queryKey: ['renewal-case-voice-calls'] }),
        queryClient.invalidateQueries({ queryKey: ['voice-calls'] }),
      ]);
    },
  });
}