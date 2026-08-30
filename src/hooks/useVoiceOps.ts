/**
 * Voice AI operations data hooks.
 *
 * Every read goes through a role-aware, security-definer RPC. The client never
 * selects `voice_call_attempts` directly, so raw provider payloads and
 * transcripts can never reach an unauthorized browser.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VoiceCallRow {
  id: string;
  created_at: string;
  member_id: string | null;
  lead_id: string | null;
  member_name: string | null;
  member_code: string | null;
  masked_phone: string | null;
  branch_id: string | null;
  branch_name: string | null;
  last_visit: string | null;
  days_absent_at_call: number | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  duration_seconds: number | null;
  status: string | null;
  disposition: string | null;
  reason_for_absence: string | null;
  next_step_agreed: string | null;
  call_summary: string | null;
  callback_datetime: string | null;
  action_state: string | null;
  provider_attempt_id: string | null;
  interaction_id: string | null;
  total_count: number;
}

export interface VoiceOpsSummary {
  today?: {
    calls?: number;
    connected?: number;
    completed?: number;
    no_answer?: number;
    failed?: number;
    in_progress?: number;
    coming_back?: number;
    callbacks?: number;
    complaints?: number;
    dnd_requests?: number;
  };
  integration?: {
    provider?: string;
    is_active?: boolean;
    agent_id?: string | null;
    agent_version?: string | null;
    agent_phone_number?: string | null;
    window_start?: string;
    window_end?: string;
    daily_call_cap?: number;
    retention_enabled?: boolean;
    min_absent_days?: number;
    cooldown_days?: number;
  };
  now_ist?: string;
}

export interface VoiceAnalytics {
  window_days?: number;
  attempted?: number;
  connected?: number;
  completed?: number;
  no_answer?: number;
  failed?: number;
  coming_back?: number;
  callback_requested?: number;
  complaint?: number;
  not_interested?: number;
  wrong_person?: number;
  needs_human?: number;
  no_clear_outcome?: number;
  contacted_members?: number;
  returned_within_7?: number;
  returned_within_14?: number;
}

export interface VoiceCallDetail {
  id: string;
  member_id: string | null;
  lead_id: string | null;
  member_name: string | null;
  member_code: string | null;
  member_status: string | null;
  masked_phone: string | null;
  branch_id: string | null;
  branch_name: string | null;
  trainer_name: string | null;
  plan_name: string | null;
  plan_expiry: string | null;
  reason: string | null;
  eligible_at: string | null;
  last_visit: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  status: string | null;
  agent_id: string | null;
  agent_version: number | null;
  provider_attempt_id: string | null;
  interaction_id: string | null;
  error_message: string | null;
  disposition: string | null;
  reason_for_absence: string | null;
  next_step_agreed: string | null;
  call_summary: string | null;
  callback_datetime: string | null;
  can_view_transcript: boolean;
  transcript: unknown;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date: string | null;
    assigned_to: string | null;
  }>;
}

export interface VoiceQueueRow {
  member_id: string;
  member_name: string | null;
  member_code: string | null;
  masked_phone: string | null;
  branch_id: string | null;
  branch_name: string | null;
  last_visit: string | null;
  days_absent: number | null;
  plan_name: string | null;
  plan_expiry: string | null;
  trainer_name: string | null;
  last_call_at: string | null;
  last_call_id: string | null;
  last_disposition: string | null;
  eligible_at: string | null;
  total_count: number;
}

export interface VoiceFeedFilters {
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  disposition?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  memberId?: string | null;
}

/** Generic RPC caller — the RPCs are new, so cast through the untyped client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args: Record<string, unknown>) => (supabase as any).rpc(name, args);

export function useVoiceOpsSummary(branchId?: string | null) {
  return useQuery({
    queryKey: ['voice-ops-summary', branchId ?? 'all'],
    queryFn: async (): Promise<VoiceOpsSummary> => {
      const { data, error } = await rpc('voice_ops_summary', { p_branch: branchId ?? null });
      if (error) throw error;
      return (data ?? {}) as VoiceOpsSummary;
    },
    staleTime: 30_000,
  });
}

export function useVoiceCalls(filters: VoiceFeedFilters) {
  const {
    branchId = null, from = null, to = null, status = null,
    disposition = null, search = null, limit = 25, offset = 0,
  } = filters;

  return useQuery({
    queryKey: ['voice-calls', branchId, from, to, status, disposition, search, limit, offset],
    queryFn: async (): Promise<VoiceCallRow[]> => {
      const { data, error } = await rpc('voice_calls_feed', {
        p_branch: branchId,
        p_from: from,
        p_to: to,
        p_status: status,
        p_disposition: disposition,
        p_search: search,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      return (data ?? []) as VoiceCallRow[];
    },
    placeholderData: (prev) => prev,
  });
}

/** Voice AI history for one member — reuses the same sanitized feed RPC. */
export function useMemberVoiceCalls(memberId?: string | null) {
  return useQuery({
    queryKey: ['voice-calls-member', memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<VoiceCallRow[]> => {
      const { data, error } = await rpc('voice_calls_feed', {
        p_branch: null, p_from: null, p_to: null, p_status: null,
        p_disposition: null, p_search: null, p_limit: 50, p_offset: 0,
      });
      if (error) throw error;
      return ((data ?? []) as VoiceCallRow[]).filter((r) => r.member_id === memberId);
    },
  });
}

export function useVoiceCallDetail(callId?: string | null) {
  return useQuery({
    queryKey: ['voice-call-detail', callId],
    enabled: !!callId,
    queryFn: async (): Promise<VoiceCallDetail> => {
      const { data, error } = await rpc('voice_call_detail', { p_call_id: callId });
      if (error) throw error;
      return data as VoiceCallDetail;
    },
  });
}

export function useVoiceAnalytics(branchId: string | null | undefined, days: number) {
  return useQuery({
    queryKey: ['voice-analytics', branchId ?? 'all', days],
    queryFn: async (): Promise<VoiceAnalytics> => {
      const { data, error } = await rpc('voice_calls_analytics', {
        p_branch: branchId ?? null,
        p_days: days,
      });
      if (error) throw error;
      return (data ?? {}) as VoiceAnalytics;
    },
    staleTime: 60_000,
  });
}
