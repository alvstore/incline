import { endOfDay, isToday } from 'date-fns';

export const CLOSED_TASK_STATUSES = ['completed', 'cancelled'] as const;

export interface TaskLike {
  status?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

export function isTaskClosed(task: TaskLike): boolean {
  return task.status === 'completed' || task.status === 'cancelled';
}

export function isTaskOpen(task: TaskLike): boolean {
  return !isTaskClosed(task);
}

/**
 * Resolve the moment a task actually becomes late.
 * A task with an explicit `due_time` is late after that time; a date-only task
 * is late once the whole day has passed. This is the single source of truth so
 * the stats cards, the filter pills and the due-date badge never disagree.
 */
export function taskDueMoment(task: TaskLike): Date | null {
  if (!task.due_date) return null;
  const base = new Date(task.due_date);
  if (Number.isNaN(base.getTime())) return null;
  if (task.due_time) {
    const [h, m] = String(task.due_time).split(':');
    const withTime = new Date(base);
    withTime.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
    return withTime;
  }
  return endOfDay(base);
}

export function isTaskOverdue(task: TaskLike, now: Date = new Date()): boolean {
  if (isTaskClosed(task)) return false;
  const due = taskDueMoment(task);
  if (!due) return false;
  return due.getTime() < now.getTime();
}

export function isTaskDueToday(task: TaskLike): boolean {
  if (!task.due_date) return false;
  const d = new Date(task.due_date);
  return !Number.isNaN(d.getTime()) && isToday(d);
}
