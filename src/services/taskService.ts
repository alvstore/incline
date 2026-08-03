import { supabase } from '@/integrations/supabase/client';
import { notifyTaskAssignee } from '@/lib/tasks/taskNotify';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type LinkedEntityType = 'approval' | 'member' | 'invoice' | 'complaint' | 'booking' | 'lead' | 'none';

export interface Task {
  id: string;
  branch_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  linked_entity_type?: LinkedEntityType | null;
  linked_entity_id?: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: { id: string; full_name: string | null; email: string | null } | null;
}

export interface TaskStatusHistoryRow {
  id: string;
  task_id: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
  changer?: { id: string; full_name: string | null; email: string | null } | null;
}

export interface TaskReminderRow {
  id: string;
  task_id: string;
  remind_at: string;
  channel: string;
  sent_at: string | null;
  created_at: string;
}

/**
 * Branch-aware task list. If `branchId` is provided we scope to that branch
 * (including "All branches" view by passing undefined).
 * Owners/admins see everything; managers/staff/trainers only see tasks in
 * branches they are assigned to (enforced by RLS + visible-branch filter).
 */
export async function fetchTasks(branchId?: string, status?: TaskStatus) {
  let query = supabase.from('tasks').select('*').order('created_at', { ascending: false });

  if (branchId) query = query.eq('branch_id', branchId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  const userIds = [
    ...new Set([
      ...(data?.map((t) => t.assigned_to).filter(Boolean) || []),
      ...(data?.map((t) => t.assigned_by).filter(Boolean) || []),
    ]),
  ];

  let profiles: any[] = [];
  if (userIds.length > 0) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);
    profiles = profileData || [];
  }

  return (
    data?.map((task) => ({
      ...task,
      assignee: profiles.find((p) => p.id === task.assigned_to) || null,
      assigner: profiles.find((p) => p.id === task.assigned_by) || null,
    })) || []
  );
}

export async function fetchMyTasks(userId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigned_to', userId)
    .neq('status', 'completed')
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data;
}

export async function getTask(id: string) {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createTask(task: {
  branchId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  assignedTo?: string;
  assignedBy?: string;
  linkedEntityType?: LinkedEntityType;
  linkedEntityId?: string;
}) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      branch_id: task.branchId,
      title: task.title,
      description: task.description,
      priority: task.priority || 'medium',
      status: 'pending',
      due_date: task.dueDate,
      assigned_to: task.assignedTo,
      assigned_by: task.assignedBy,
      linked_entity_type: task.linkedEntityType,
      linked_entity_id: task.linkedEntityId,
    })
    .select()
    .single();

  if (error) throw error;

  await notifyTaskAssignee({
    taskId: data.id,
    branchId: data.branch_id,
    assignedTo: data.assigned_to,
    title: data.title,
    description: data.description,
    priority: data.priority,
    dueDate: data.due_date,
  });

  return data;
}

export async function updateTask(id: string, updates: Partial<Task>) {
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function assignTask(taskId: string, userId: string | null, assignedBy: string) {
  const { data, error } = await supabase
    .from('tasks')
    .update({
      assigned_to: userId === 'unassigned' ? null : userId,
      assigned_by: assignedBy,
    })
    .eq('id', taskId)
    .select()
    .single();

  if (error) throw error;

  await notifyTaskAssignee({
    taskId: data.id,
    branchId: data.branch_id,
    assignedTo: data.assigned_to,
    title: data.title,
    description: data.description,
    priority: data.priority,
    dueDate: data.due_date,
  });

  return data;
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
  const updates: Partial<Task> = { status };
  if (status === 'completed') updates.completed_at = new Date().toISOString();
  return updateTask(id, updates);
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function getTaskStats(branchId?: string) {
  const tasks = await fetchTasks(branchId);
  const now = new Date();
  const overdueTasks = tasks.filter(
    (t) => t.due_date && new Date(t.due_date) < now && t.status !== 'completed' && t.status !== 'cancelled'
  );
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    overdue: overdueTasks.length,
    highPriority: tasks.filter((t) => t.priority === 'high' || t.priority === 'urgent').length,
  };
}

// ─────────── Task drawer helpers (history / comments / reminders) ───────────

export async function fetchTaskHistory(taskId: string): Promise<TaskStatusHistoryRow[]> {
  const { data, error } = await supabase
    .from('task_status_history')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const ids = [...new Set((data || []).map((r) => r.changed_by).filter(Boolean) as string[])];
  let profiles: any[] = [];
  if (ids.length) {
    const { data: pd } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
    profiles = pd || [];
  }
  return (data || []).map((r) => ({
    ...r,
    changer: profiles.find((p) => p.id === r.changed_by) || null,
  })) as TaskStatusHistoryRow[];
}

export async function fetchTaskComments(taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from('task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const ids = [...new Set((data || []).map((r) => r.author_id).filter(Boolean) as string[])];
  let profiles: any[] = [];
  if (ids.length) {
    const { data: pd } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
    profiles = pd || [];
  }
  return (data || []).map((r) => ({
    ...r,
    author: profiles.find((p) => p.id === r.author_id) || null,
  })) as TaskComment[];
}

export async function addTaskComment(taskId: string, body: string, authorId: string) {
  const { data, error } = await supabase
    .from('task_comments')
    .insert({ task_id: taskId, body, author_id: authorId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchTaskReminders(taskId: string): Promise<TaskReminderRow[]> {
  const { data, error } = await supabase
    .from('task_reminders')
    .select('*')
    .eq('task_id', taskId)
    .order('remind_at', { ascending: true });
  if (error) throw error;
  return (data || []) as TaskReminderRow[];
}

export async function scheduleTaskReminder(taskId: string, remindAt: string, channel = 'in_app') {
  const { data, error } = await supabase
    .from('task_reminders')
    .insert({ task_id: taskId, remind_at: remindAt, channel })
    .select()
    .single();
  if (error) throw error;
  return data;
}
