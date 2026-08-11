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
  title: string;
  description?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
}

export async function notifyTaskAssignee(notice: TaskAssignmentNotice): Promise<void> {
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
    const priority = (notice.priority || 'medium').toUpperCase();
    const link = `${window.location.origin}/tasks?id=${notice.taskId}`;

    const body =
      `Hi ${assigneeName}, a new task has been assigned to you.\n\n` +
      `Task: ${notice.title}\n` +
      `Priority: ${priority}\n` +
      `Due: ${due}\n` +
      (notice.description ? `Details: ${notice.description}\n` : '') +
      `\nOpen it here: ${link}`;

    const variables = {
      event_key: 'task_assigned',
      assignee_name: assigneeName,
      task_title: notice.title,
      priority,
      due_date: due,
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
