/**
 * Task type + ordering helpers for the dashboard Task Pulse widget.
 * Type is inferred from the deterministic member-request task titles
 * (`<Label> request from <Member>`), falling back to General.
 */
export type TaskTypeKey = 'diet' | 'workout' | 'trainer' | 'locker' | 'freeze' | 'resume' | 'general';

export const TASK_TYPE_LABEL: Record<TaskTypeKey, string> = {
  diet: 'Diet plan',
  workout: 'Workout plan',
  trainer: 'Trainer change',
  locker: 'Locker',
  freeze: 'Freeze',
  resume: 'Resume',
  general: 'General',
};

const PATTERNS: [RegExp, TaskTypeKey][] = [
  [/^diet plan request/i, 'diet'],
  [/^workout plan request/i, 'workout'],
  [/^trainer( change)? request/i, 'trainer'],
  [/^locker request/i, 'locker'],
  [/^membership freeze request/i, 'freeze'],
  [/^membership resume request/i, 'resume'],
];

export function taskTypeOf(task: { title?: string | null }): TaskTypeKey {
  const title = (task.title || '').trim();
  for (const [re, key] of PATTERNS) if (re.test(title)) return key;
  return 'general';
}

/** Member name from "<Label> request from <Name>", else the full title. */
export function taskSubject(task: { title?: string | null }): string {
  const title = (task.title || '').trim();
  const m = title.match(/request from (.+)$/i);
  return m ? m[1] : title;
}

export interface RankableTask {
  priority: string;
  due_date: string | null;
  created_at: string;
}

const isHigh = (p: string) => p === 'high' || p === 'urgent';

/** Overdue first, then high/urgent priority, then oldest created. */
export function rankTasks<T extends RankableTask>(tasks: T[], todayKey: string): T[] {
  const score = (t: T) => (t.due_date && t.due_date.slice(0, 10) < todayKey ? 0 : isHigh(t.priority) ? 1 : 2);
  return [...tasks].sort((a, b) => score(a) - score(b) || a.created_at.localeCompare(b.created_at));
}

export function previewTasks<T extends RankableTask>(tasks: T[], todayKey: string, size = 3): T[] {
  return rankTasks(tasks, todayKey).slice(0, size);
}

export function relativeAge(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins || 1}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
