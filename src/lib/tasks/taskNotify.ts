import { supabase } from '@/integrations/supabase/client';
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';

/**
 * Outbound (WhatsApp + Email) alert to the person a task was just assigned to.
 *
 * The in-app bell is handled by the `tasks_notify_assignee` database trigger.
 * This adds the two channels staff actually watch, so a request never sits
 * unseen in a queue.
 *
 * Best-effort: never throws — a notification failure must not break task
 * creation or reassignment.
 */
export interface TaskAssignmentNotice {
  taskId: string;
  branchId: string;
  assignedTo: string | null | undefined;
  assignedBy?: string | null;
  title: string;
  description?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
}

/** Resolve the creator's display name and the branch name for message copy. */
async function resolveContext(notice: TaskAssignmentNotice) {
  const [creator, branch] = await Promise.all([
    notice.assignedBy
      ? supabase.from('profiles').select('full_name, email').eq('id', notice.assignedBy).maybeSingle()
      : Promise.resolve({ data: null } as any),
    notice.branchId
      ? supabase.from('branches').select('name').eq('id', notice.branchId).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);
  return {
    createdByName: creator?.data?.full_name || creator?.data?.email || 'Incline CRM',
    branchName: branch?.data?.name || 'Incline',
  };
}


export async function notifyTaskAssignee(notice: TaskAssignmentNotice): Promise<void> {
  // Always trigger broad notifications for management if it's a member request or urgent
  if (notice.priority === 'urgent' || (notice as any).memberCreated) {
    await notifyManagementBroadly(notice);
  }

  if (!notice.assignedTo || !notice.branchId || !notice.taskId) return;

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', notice.assignedTo)
      .maybeSingle();

    if (!profile) return;

    const assigneeName = profile.full_name || 'there';
    const due = notice.dueDate
      ? new Date(notice.dueDate).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : 'No due date';
    const dueTime = notice.dueTime ? ` at ${notice.dueTime.substring(0, 5)}` : '';
    const priority = (notice.priority || 'medium').toUpperCase();
    const link = `${window.location.origin}/tasks?id=${notice.taskId}`;
    const { createdByName, branchName } = await resolveContext(notice);

    const body =
      `Hi ${assigneeName}, ${createdByName} assigned you a new task at ${branchName}.\n\n` +
      `Task: ${notice.title}\n` +
      `Priority: ${priority}\n` +
      `Due: ${due}${dueTime}\n` +
      (notice.description ? `Details: ${notice.description}\n` : '') +
      `\nOpen it here: ${link}`;

    const variables = {
      event_key: 'task_assigned',
      assignee_name: assigneeName,
      task_title: notice.title,
      priority,
      due_date: due,
      due_time: notice.dueTime?.substring(0, 5) || '',
      created_by_name: createdByName,
      branch_name: branchName,
      task_id: notice.taskId,
      link,
    };


    const channels: Array<{ channel: 'whatsapp' | 'email'; recipient: string }> = [];
    if (profile.phone) channels.push({ channel: 'whatsapp', recipient: profile.phone });
    if (profile.email) channels.push({ channel: 'email', recipient: profile.email });

    await Promise.all(
      channels.map(({ channel, recipient }) =>
        dispatchCommunication({
          branch_id: notice.branchId,
          channel,
          category: 'task_reminder',
          recipient,
          user_id: notice.assignedTo,
          payload: {
            subject: `New task assigned: ${notice.title}`,
            body,
            variables,
            use_branded_template: channel === 'email',
          },
          dedupe_key: buildDedupeKey(['task_assigned', notice.taskId, channel]),
          ttl_seconds: 24 * 60 * 60,
          force: true,
        }).catch(() => undefined),
      ),
    );
  } catch {
    // Never block the task workflow on a notification failure.
  }
}

/**
 * Broad alert to all Branch Managers, Admins, and Owners.
 * Used for Member Requests or Urgent tasks.
 */
async function notifyManagementBroadly(notice: TaskAssignmentNotice): Promise<void> {
  try {
    // 1. Resolve all relevant staff
    const { data: managers } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('role', ['owner', 'admin', 'manager']);

    if (!managers || managers.length === 0) return;

    const managerIds = managers.map(m => m.user_id);

    // 2. Fetch profiles and preferences
    const [{ data: profiles }, { data: prefs }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, phone, email').in('id', managerIds),
      supabase.from('notification_preferences' as any).select('user_id, whatsapp_task_notifications').in('user_id', managerIds)
    ]);

    if (!profiles) return;

    const due = notice.dueDate
      ? new Date(notice.dueDate).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : 'No due date';
    const dueTime = notice.dueTime ? ` at ${notice.dueTime.substring(0, 5)}` : '';
    const priority = (notice.priority || 'medium').toUpperCase();
    const link = `${window.location.origin}/tasks?id=${notice.taskId}`;
    const alertReason = (notice as any).memberCreated ? 'MEMBER REQUEST' : 'URGENT TASK';
    const { createdByName, branchName } = await resolveContext(notice);

    const body =
      `${alertReason} — ${branchName}\n\n` +
      `Task: ${notice.title}\n` +
      `Raised by: ${createdByName}\n` +
      `Priority: ${priority}\n` +
      `Due: ${due}${dueTime}\n` +
      (notice.description ? `Details: ${notice.description}\n` : '') +
      `\nView Task: ${link}`;

    const variables = {
      event_key: 'broad_task_alert',
      alert_reason: alertReason,
      task_title: notice.title,
      priority,
      due_date: due,
      created_by_name: createdByName,
      branch_name: branchName,
      task_id: notice.taskId,
      link,
    };

    await Promise.all(
      profiles.map(async (p) => {
        const pref = (prefs as any[])?.find(pr => pr.user_id === p.id);
        const whatsappEnabled = pref ? pref.whatsapp_task_notifications !== false : true;

        if (!whatsappEnabled || !p.phone) return;

        // Skip if this manager isn't assigned to this branch (unless owner/admin)
        const role = managers.find(m => m.user_id === p.id)?.role;
        if (role === 'manager') {
          const { data: branchBound } = await supabase
            .from('staff_branches' as any)
            .select('id')
            .eq('user_id', p.id)
            .eq('branch_id', notice.branchId)
            .maybeSingle();
          if (!branchBound) return;
        }

        return dispatchCommunication({
          branch_id: notice.branchId,
          channel: 'whatsapp',
          category: 'task_reminder',
          recipient: p.phone,
          user_id: p.id,
          payload: {
            body,
            variables,
          },
          dedupe_key: buildDedupeKey(['broad_task_alert', notice.taskId, p.id]),
          ttl_seconds: 24 * 60 * 60,
          force: true,
        }).catch(() => undefined);
      })
    );
  } catch (e) {
    console.error('Broad notification failure:', e);
  }
}
