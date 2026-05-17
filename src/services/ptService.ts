// PT service — wraps the atomic `log_pt_session` RPC and triggers the
// post-success WhatsApp receipt via the canonical communication dispatcher.

import { supabase } from '@/integrations/supabase/client';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';
import { format } from 'date-fns';

export interface LogPtSessionInput {
  memberPackageId: string;
  trainerId: string;
  notes?: string | null;
}

export interface LogPtSessionResult {
  session_id: string;
  member_id: string;
  branch_id: string;
  package_type: 'session_based' | 'monthly';
  sessions_remaining: number | null;
  expiry_date: string | null;
}

/** Friendly errors keyed off RPC exceptions. */
const ERROR_MAP: Record<string, string> = {
  not_authorized: "You don't have permission to log PT sessions.",
  package_not_found: 'PT package could not be found.',
  package_not_active: 'This PT package is not active.',
  no_sessions_left: 'No sessions left on this pack — please renew first.',
  package_expired: 'This monthly plan has expired — please renew first.',
};

export async function logPtSession(
  input: LogPtSessionInput,
): Promise<LogPtSessionResult> {
  const { data, error } = await supabase.rpc('log_pt_session', {
    p_member_pt_package_id: input.memberPackageId,
    p_trainer_id: input.trainerId,
    p_notes: input.notes ?? null,
  });

  if (error) {
    const friendly = ERROR_MAP[error.message] ?? error.message;
    throw new Error(friendly);
  }

  const result = data as unknown as LogPtSessionResult;

  // Fire-and-forget WhatsApp receipt via dispatcher.
  fireReceipt(result).catch(() => {
    /* receipt failures must not break attendance UX */
  });

  return result;
}

async function fireReceipt(r: LogPtSessionResult) {
  // Look up member phone + name
  const { data: member } = await supabase
    .from('members')
    .select('id, user_id, profile:profiles!members_user_id_fkey(full_name, phone)')
    .eq('id', r.member_id)
    .maybeSingle();

  const profile = (member as any)?.profile;
  const phone: string | null = profile?.phone || null;
  const name: string = profile?.full_name || 'Member';
  if (!phone) return;

  const detail =
    r.package_type === 'session_based'
      ? `You have ${r.sessions_remaining ?? 0} session(s) left.`
      : r.expiry_date
        ? `Your monthly plan is valid until ${format(new Date(r.expiry_date), 'd MMM yyyy')}.`
        : 'Your monthly plan is active.';

  const body =
    `Hi ${name}, your PT session has been logged on ` +
    `${format(new Date(), 'd MMM yyyy, h:mm a')}. ${detail} — Incline Fitness`;

  await dispatchCommunication({
    branch_id: r.branch_id,
    channel: 'whatsapp',
    category: 'transactional',
    recipient: phone,
    member_id: r.member_id,
    payload: { body, variables: { event: 'pt_session_logged' } },
    dedupe_key: buildDedupeKey(['pt_session_logged', r.session_id, 'wa']),
    force: true,
  });
}
