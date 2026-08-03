import { supabase } from '@/integrations/supabase/client';

/**
 * Member self-service requests always land in a staff/trainer work queue so the
 * front desk (and the owner dashboard) can see and action them.
 *
 * The task title is deterministic — `<Label> request from <Member name>` — so the
 * approval queue can close the matching task once the request is reviewed.
 */
export type MemberRequestReference =
  | 'member' // freeze
  | 'membership_unfreeze'
  | 'trainer_change'
  | 'locker';

export const MEMBER_REQUEST_LABEL: Record<MemberRequestReference, string> = {
  member: 'Membership freeze',
  membership_unfreeze: 'Membership resume',
  trainer_change: 'Trainer',
  locker: 'Locker',
};

export function memberRequestTaskTitle(reference: MemberRequestReference, memberName: string) {
  return `${MEMBER_REQUEST_LABEL[reference]} request from ${memberName}`;
}

/** Resolve the member's display name from their profile (falls back to code). */
export async function resolveMemberDisplayName(member: {
  user_id?: string | null;
  member_code?: string | null;
}): Promise<string> {
  if (member?.user_id) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', member.user_id)
      .maybeSingle();
    if (data?.full_name) return data.full_name;
  }
  return member?.member_code || 'Member';
}

/**
 * Mark the pending task raised for a member request as completed once the
 * request has been approved or rejected. Best-effort: never throws.
 */
export async function closeMemberRequestTask(params: {
  memberId: string;
  referenceType: string | null | undefined;
  decision: 'approved' | 'rejected';
}) {
  const label = MEMBER_REQUEST_LABEL[params.referenceType as MemberRequestReference];
  if (!label || !params.memberId) return;
  try {
    await supabase
      .from('tasks')
      .update({
        status: params.decision === 'approved' ? 'completed' : 'cancelled',
        completed_at: new Date().toISOString(),
      })
      .eq('linked_entity_type', 'member')
      .eq('linked_entity_id', params.memberId)
      .in('status', ['pending', 'in_progress'])
      .ilike('title', `${label} request from %`);
  } catch {
    // A queue-cleanup failure must never break the approval flow.
  }
}
