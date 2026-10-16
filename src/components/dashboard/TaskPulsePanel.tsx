import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Inbox } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AssigneeAvatar } from '@/components/tasks/AssigneeAvatar';
import { DueDatePill } from '@/components/tasks/DueDatePill';
import { TASK_TYPE_LABEL, relativeAge, taskTypeOf, type TaskTypeKey } from '@/lib/tasks/taskType';
import { getISTDayRange } from '@/lib/utils/datetime';
import { cn } from '@/lib/utils';
import { TaskQuickActions, TaskTypeTag, fullDate, type PulseTask } from './taskPulseShared';

export type PulseFilter = 'all' | 'today' | 'overdue' | 'urgent';
const PAGE = 10;
const TYPE_PREFIX: Record<Exclude<TaskTypeKey, 'general'>, string> = {
  diet: 'Diet plan request%', workout: 'Workout plan request%', trainer: 'Trainer%request%',
  locker: 'Locker request%', freeze: 'Membership freeze request%', resume: 'Membership resume request%',
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filter: PulseFilter;
  onFilterChange: (f: PulseFilter) => void;
  isManagement: boolean;
  branchFilter?: string | null;
  userId?: string;
  staff: { id: string; full_name: string | null }[];
  returnFocus: () => void;
}

export function TaskPulsePanel({ open, onOpenChange, filter, onFilterChange, isManagement, branchFilter, userId, staff, returnFocus }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<TaskTypeKey | 'any'>('any');
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => setPage(0), [filter, type, debounced, branchFilter]);

  const { startISO } = getISTDayRange();
  const todayKey = startISO.slice(0, 10);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['task-pulse-panel', isManagement ? branchFilter ?? 'all' : userId, filter, type, debounced, page],
    enabled: open && !!userId,
    queryFn: async () => {
      let q = supabase
        .from('tasks')
        .select('id, title, priority, status, due_date, due_time, assigned_to, created_at, description', { count: 'exact' })
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (isManagement) { if (branchFilter) q = q.eq('branch_id', branchFilter); } else q = q.eq('assigned_to', userId!);
      if (filter === 'today') q = q.eq('due_date', todayKey);
      if (filter === 'overdue') q = q.lt('due_date', todayKey);
      if (filter === 'urgent') q = q.in('priority', ['high', 'urgent']);
      if (type !== 'any' && type !== 'general') q = q.ilike('title', TYPE_PREFIX[type]);
      if (debounced) q = q.ilike('title', `%${debounced.replace(/[%_]/g, '')}%`);
      const { data: rows, error, count } = await q;
      if (error) throw error;
      const ids = [...new Set((rows || []).map((r) => r.assigned_to).filter(Boolean) as string[])];
      const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] as any[] };
      const tasks = (rows || []).map((t) => ({ ...t, assignee: (profiles || []).find((p: any) => p.id === t.assigned_to) || null })) as PulseTask[];
      return { tasks: type === 'general' ? tasks.filter((t) => taskTypeOf(t) === 'general') : tasks, count: count ?? 0 };
    },
  });

  const total = data?.count ?? 0;
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE);
  const chips: { key: PulseFilter; label: string }[] = [
    { key: 'all', label: 'Open' }, { key: 'today', label: 'Due today' }, { key: 'overdue', label: 'Overdue' }, { key: 'urgent', label: 'High priority' },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus(); }}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Task Pulse</SheetTitle>
          <SheetDescription>{isManagement ? 'Open tasks in this branch' : 'Tasks assigned to you'}</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 border-b border-border px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks or member" className="pl-9" aria-label="Search tasks" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filter">
            {chips.map((c) => (
              <Button key={c.key} size="sm" variant={filter === c.key ? 'default' : 'outline'} aria-pressed={filter === c.key} className="h-9 rounded-full" onClick={() => onFilterChange(c.key)}>{c.label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Request type filter">
            {(['any', ...Object.keys(TASK_TYPE_LABEL)] as (TaskTypeKey | 'any')[]).map((k) => (
              <Button key={k} size="sm" variant={type === k ? 'secondary' : 'ghost'} aria-pressed={type === k} className={cn('h-8 rounded-full text-xs', type === k && 'font-semibold')} onClick={() => setType(k)}>
                {k === 'any' ? 'All types' : TASK_TYPE_LABEL[k]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2" aria-live="polite">
          {isLoading ? (
            <div className="space-y-2 py-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center" role="alert">
              <p className="text-sm text-muted-foreground">Couldn't load tasks.</p>
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : !data?.tasks.length ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No tasks match these filters.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.tasks.map((t) => {
                const tt = taskTypeOf(t);
                const high = t.priority === 'high' || t.priority === 'urgent';
                return (
                  <li key={t.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <TaskTypeTag type={tt} high={high} />
                        {high && <span className="text-[11px] font-semibold uppercase text-destructive">{t.priority}</span>}
                      </div>
                      <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <time dateTime={t.created_at} title={fullDate(t.created_at)}>Created {relativeAge(t.created_at)}</time>
                        {t.due_date && <DueDatePill dueDate={t.due_date} status={t.status} />}
                        {t.assignee ? <AssigneeAvatar name={t.assignee.full_name} email={t.assignee.email} showName /> : <span>Unassigned</span>}
                      </div>
                    </div>
                    <TaskQuickActions task={t} canAssign={isManagement} staff={staff} onOpen={() => navigate(`/tasks?task=${t.id}`)} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-sm">
          <span className="text-muted-foreground">Showing {from}–{to} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-10" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" className="h-10" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
