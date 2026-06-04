import { supabase } from '@/integrations/supabase/client';

export type CommChannel = 'whatsapp' | 'sms' | 'email' | 'in_app' | 'rcs';
export type CommCategory =
  | 'membership_reminder' | 'payment_receipt' | 'class_notification'
  | 'announcement' | 'low_stock' | 'new_lead' | 'payment_alert'
  | 'task_reminder' | 'retention_nudge' | 'review_request'
  | 'marketing' | 'transactional';

export interface DispatchInput {
  branch_id: string;
  channel: CommChannel;
  category: CommCategory;
  recipient: string;
  member_id?: string | null;
  user_id?: string | null;
  template_id?: string | null;
  payload: {
    subject?: string;
    body: string;
    variables?: Record<string, unknown>;
    /** When true, send-email wraps the body in the branded HTML shell. */
    use_branded_template?: boolean;
  };
  /** Stable idempotency key. Convention: `<topic>:<entity_id>[:<sub>]:<channel>` */
  dedupe_key: string;
  ttl_seconds?: number;
  /** Bypass member preferences. Use only for transactional categories (receipts, OTPs, security). */
  force?: boolean;
  /** Optional file attachment (currently WhatsApp document/image). */
  attachment?: {
    url: string;
    filename: string;
    content_type?: string;
    kind?: 'document' | 'image';
  };
}

export interface DispatchResult {
  status: 'sent' | 'queued' | 'deduped' | 'suppressed' | 'failed';
  log_id?: string;
  reason?: string;
  provider_message_id?: string;
}

/** Canonical outbound communication funnel. Always prefer this over calling
 *  send-whatsapp / send-sms / send-message / send-email directly. */
export async function dispatchCommunication(input: DispatchInput): Promise<DispatchResult> {
  const { data, error } = await supabase.functions.invoke<DispatchResult>(
    'dispatch-communication',
    { body: input },
  );
  if (error) throw error;
  return data!;
}

// ─── Member preferences ───────────────────────────────────────────────

export interface MemberCommPreferences {
  member_id: string;
  branch_id: string;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  membership_reminders: boolean;
  payment_receipts: boolean;
  class_notifications: boolean;
  announcements: boolean;
  retention_nudges: boolean;
  review_requests: boolean;
  marketing: boolean;
}

export async function getMemberCommPreferences(memberId: string) {
  const { data, error } = await supabase
    .from('member_communication_preferences')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) throw error;
  return data as MemberCommPreferences | null;
}

export async function upsertMemberCommPreferences(
  memberId: string,
  branchId: string,
  patch: Partial<Omit<MemberCommPreferences, 'member_id' | 'branch_id'>>,
) {
  const { data, error } = await supabase
    .from('member_communication_preferences')
    .upsert(
      { member_id: memberId, branch_id: branchId, ...patch },
      { onConflict: 'member_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as MemberCommPreferences;
}
