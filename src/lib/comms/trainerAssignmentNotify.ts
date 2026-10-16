/**
 * Trainer-assignment notifications (general floor coach or personal training).
 *
 * Sends two short UTILITY messages through the canonical dispatcher:
 *   1. Trainer  — event `trainer_member_assigned`  (WhatsApp + in-app)
 *   2. Member   — event `member_trainer_assigned`  (WhatsApp + in-app)
 *
 * Kill switch: settings key `trainer_assignment_notifications`
 * (branch row overrides global). Value `false` / `{ "enabled": false }`
 * turns it off without a deploy. Default: ON.
 *
 * Fire-and-forget: never throws, so assignment itself can never fail here.
 */
import { supabase } from '@/integrations/supabase/client';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';

export type AssignmentKind = 'general' | 'personal';

export interface TrainerAssignmentNotifyInput {
  memberId: string;
  trainerId: string;
  branchId: string;
  kind: AssignmentKind;
  /** e.g. "Personal Training (26 sessions)" */
  detail?: string | null;
}

export function assignmentLabel(kind: AssignmentKind, detail?: string | null) {
  if (kind === 'personal') return detail ? `Personal Training (${detail})` : 'Personal Training';
  return 'General Fitness Training';
}

export function isFlagOff(value: unknown): boolean {
  if (value === false || value === 'false') return true;
  if (value && typeof value === 'object' && (value as { enabled?: unknown }).enabled === false) return true;
  return false;
}

async function notificationsEnabled(branchId: string): Promise<boolean> {
  const { data } = await supabase
    .from('settings')
    .select('branch_id, value')
    .eq('key', 'trainer_assignment_notifications')
    .or(`branch_id.eq.${branchId},branch_id.is.null`);
  const rows = (data ?? []) as Array<{ branch_id: string | null; value: unknown }>;
  const row = rows.find((r) => r.branch_id === branchId) ?? rows.find((r) => r.branch_id === null);
  return !row || !isFlagOff(row.value);
}

export async function notifyTrainerAssignment(input: TrainerAssignmentNotifyInput): Promise<void> {
  try {
    if (!(await notificationsEnabled(input.branchId))) return;

    const [{ data: trainer }, { data: member }] = await Promise.all([
      supabase.from('trainers').select('user_id').eq('id', input.trainerId).maybeSingle(),
      supabase.from('members').select('user_id, member_code').eq('id', input.memberId).maybeSingle(),
    ]);
    const ids = [trainer?.user_id, member?.user_id].filter(Boolean) as string[];
    if (ids.length === 0) return;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .in('id', ids);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    const tp = trainer?.user_id ? byId.get(trainer.user_id) : undefined;
    const mp = member?.user_id ? byId.get(member.user_id) : undefined;

    const trainerName = tp?.full_name?.trim() || 'Coach';
    const memberName = mp?.full_name?.trim() || 'Member';
    const label = assignmentLabel(input.kind, input.detail);
    const day = new Date().toISOString().slice(0, 10);
    const base = ['trainer-assign', input.memberId, input.trainerId, input.kind, day];

    const trainerBody = `Hi ${trainerName}, member ${memberName} has been assigned to you for ${label} at Incline. Please review their profile and fitness goals in your trainer portal.`;
    const memberBody = `Hi ${memberName}, coach ${trainerName} has been assigned as your dedicated ${input.kind === 'personal' ? 'Personal' : 'General Fitness'} trainer at Incline. Feel free to connect with Coach ${trainerName} during your next visit. We look forward to seeing you!`;

    const jobs: Promise<unknown>[] = [];
    if (tp) {
      const vars = { event_key: 'trainer_member_assigned', trainer_name: trainerName, member_name: memberName, assignment_type: label, recipient_name: trainerName, variable_1: trainerName, variable_2: memberName, variable_3: label };
      if (tp.phone) jobs.push(dispatchCommunication({
        branch_id: input.branchId, channel: 'whatsapp', category: 'transactional', recipient: tp.phone,
        user_id: tp.id, payload: { body: trainerBody, variables: vars },
        dedupe_key: buildDedupeKey([...base, 'trainer', 'wa']), force: true,
      }));
      jobs.push(dispatchCommunication({
        branch_id: input.branchId, channel: 'in_app', category: 'transactional', recipient: tp.id,
        user_id: tp.id, payload: { subject: 'New client assigned', body: trainerBody, variables: vars },
        dedupe_key: buildDedupeKey([...base, 'trainer', 'inapp']), force: true,
      }));
    }
    if (mp) {
      const vars = { event_key: 'member_trainer_assigned', member_name: memberName, trainer_name: trainerName, training_type: input.kind === 'personal' ? 'Personal' : 'General Fitness', recipient_name: memberName, variable_1: memberName, variable_2: trainerName, variable_3: input.kind === 'personal' ? 'Personal' : 'General Fitness' };
      if (mp.phone) jobs.push(dispatchCommunication({
        branch_id: input.branchId, channel: 'whatsapp', category: 'transactional', recipient: mp.phone,
        member_id: input.memberId, payload: { body: memberBody, variables: vars },
        dedupe_key: buildDedupeKey([...base, 'member', 'wa']),
      }));
      jobs.push(dispatchCommunication({
        branch_id: input.branchId, channel: 'in_app', category: 'transactional', recipient: mp.id,
        member_id: input.memberId, user_id: mp.id, payload: { subject: 'Meet your coach', body: memberBody, variables: vars },
        dedupe_key: buildDedupeKey([...base, 'member', 'inapp']),
      }));
    }
    await Promise.allSettled(jobs);
  } catch (e) {
    console.warn('[trainerAssignmentNotify] skipped:', e);
  }
}
