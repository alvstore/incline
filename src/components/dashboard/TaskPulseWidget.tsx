import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight, CircleAlert, Inbox, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AssigneeAvatar } from '@/components/tasks/AssigneeAvatar';
import { getISTDayRange } from '@/lib/utils/datetime';
import { TASK_TYPE_LABEL, previewTasks, relativeAge, taskSubject, taskTypeOf } from '@/lib/tasks/taskType';
import { cn } from '@/lib/utils';
import { TaskQuickActions, TaskTypeTag, fullDate, useBranchStaff, type PulseTask } from './taskPulseShared';
import { TaskPulsePanel, type PulseFilter } from './TaskPulsePanel';

/**
 * Compact Task Pulse — fixed-height bento card matching the Annual upgrades widget.
 * Management sees the branch queue and can assign; staff/trainers see their own tasks.
 */
export function TaskPulseWidget({ branchFilter, className }: { branchFilter?: string | null; className?: string }) {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<PulseFilter>('all');
  const [open, setOpen] = useState(false);
  const viewAllRef = useRef<HTMLButtonElement>(null);

  // Same role split as the legacy widget (branch queue vs own tasks).
  const isManagement = useMemo(() => (roles || []).some((r: any) => ['owner', 'admin', 'manager'].includes(r.role)), [roles]);
  const queryKey = ['dashboard-my-tasks', user?.id ?? 'anon', isManagement ? branchFilter ?? 'all' : 'mine'];

  useRealtimeInvalidate({ channel: `dashboard-tasks-${user?.id ?? 'anon'}`, tables: ['tasks'], invalidateKeys: [['dashboard-my-tasks']], enabled: !!user });

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('tasks')
        .select('id, title, priority, status, due_date, due_time, assigned_to, created_at, description, linked_entity_type, linked_entity_id')
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: true })
        .limit(200);
      if (isManagement) { if (branchFilter) q = q.eq('branch_id', branchFilter); } else q = q.eq('assigned_to', user!.id);
      const { data: rows, error } = await q;
      if (error) throw error;
      const ids = [...new Set((rows || []).map((t) => t.assigned_to).filter(Boolean) as string[])];
      const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] as any[] };
      return (rows || []).map((t) => ({ ...t, assignee: (profiles || []).find((p: any) => p.id === t.assigned_to) || null })) as PulseTask[];
    },
  });

  const { data: staff = [] } = useBranchStaff(branchFilter, isManagement && !!user);

  const tasks = data || [];
  const todayKey = getISTDayRange().startISO.slice(0, 10);
  const isHigh = (t: PulseTask) => t.priority === 'high' || t.priority === 'urgent';
  const isOverdue = (t: PulseTask) => !!t.due_date && t.due_date.slice(0, 10) < todayKey;
  const isToday = (t: PulseTask) => !!t.due_date && t.due_date.slice(0, 10) === todayKey;
  const filtered = filter === 'today' ? tasks.filter(isToday) : filter === 'overdue' ? tasks.filter(isOverdue) : filter === 'urgent' ? tasks.filter(isHigh) : tasks;
  const preview = previewTasks(filtered, todayKey);

  const metrics: { key: PulseFilter; label: string; value: number; tone: string }[] = [
    { key: 'all', label: 'Open', value: tasks.length, tone: 'text-foreground' },
    { key: 'today', label: 'Due today', value: tasks.filter(isToday).length, tone: 'text-info' },
    { key: 'overdue', label: 'Overdue', value: tasks.filter(isOverdue).length, tone: 'text-destructive' },
    { key: 'urgent', label: 'High priority', value: tasks.filter(isHigh).length, tone: 'text-warning' },
  ];
  const refresh = () => qc.invalidateQueries({ queryKey: ['dashboard-my-tasks'] });

  return (
    <>
      <Card className={cn('flex h-[410px] min-w-0 flex-col rounded-2xl border-none shadow-lg shadow-primary/5 motion-safe:animate-fade-in', className)} aria-labelledby="task-pulse-title" data-testid="task-pulse-widget">
        <CardHeader className="flex shrink-0 flex-row items-start justify-between gap-2 p-5 pb-3">
          <div className="min-w-0">
            <CardTitle id="task-pulse-title" className="flex items-center gap-2 text-base font-bold"><Activity className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />Task Pulse</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{isManagement ? 'Live branch queue' : 'Your open tasks'}</p>
          </div>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching} aria-label="Refresh tasks" className="-mr-2 -mt-1 h-11 w-11 shrink-0"><RefreshCw className={cn('h-4 w-4', isFetching && 'motion-safe:animate-spin')} /></Button></TooltipTrigger><TooltipContent>Refresh tasks</TooltipContent></Tooltip>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-0">
          {isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" role="alert"><CircleAlert className="h-6 w-6 text-destructive" aria-hidden="true" /><p className="text-sm text-muted-foreground">Couldn't load tasks.</p><Button variant="outline" onClick={refresh}>Retry</Button></div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1 pb-2" role="group" aria-label="Filter tasks">
                {metrics.map((m) => (
                  <button key={m.key} type="button" aria-pressed={filter === m.key} onClick={() => setFilter(m.key)}
                    className={cn('min-h-11 min-w-0 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary', filter === m.key && 'bg-secondary')}>
                    {isLoading ? <Skeleton className="h-7 w-8" /> : <span className={cn('block text-2xl font-semibold tabular-nums', m.tone)}>{m.value}</span>}
                    <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">{m.label}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 min-h-0 flex-1 border-t border-border pt-1" aria-live="polite">
                {isLoading ? (
                  <div className="space-y-3 pt-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
                ) : !preview.length ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><Inbox className="h-6 w-6" aria-hidden="true" />All clear — nothing here.</div>
                ) : (
                  <ul aria-label="Most urgent tasks" className="divide-y divide-border">
                    {preview.map((t) => {
                      const tt = taskTypeOf(t);
                      const high = isHigh(t);
                      return (
                        <li key={t.id} data-testid="task-pulse-row" className="flex min-h-[60px] items-center gap-2 py-1.5">
                          <button type="button" onClick={() => navigate(`/tasks?task=${t.id}`)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Open ${t.title}`}>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <TaskTypeTag type={tt} high={high} compact />
                                <span className="truncate text-xs font-semibold text-foreground">{taskSubject(t)}</span>
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
                                {TASK_TYPE_LABEL[tt]}{isOverdue(t) ? ' · Overdue' : ''} · {t.assignee?.full_name || 'Unassigned'}
                              </span>
                            </span>
                            {t.assignee && <AssigneeAvatar name={t.assignee.full_name} email={t.assignee.email} />}
                            <time dateTime={t.created_at} title={fullDate(t.created_at)} className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                              {relativeAge(t.created_at)}<span className="sr-only">, created {fullDate(t.created_at)}</span>
                            </time>
                          </button>
                          <TaskQuickActions task={t} canAssign={isManagement} staff={staff} onOpen={() => navigate(`/tasks?task=${t.id}`)} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
          <Button ref={viewAllRef} variant="ghost" className="mt-2 h-11 w-full shrink-0 justify-between px-0 text-foreground hover:bg-secondary" disabled={isLoading || isError} onClick={() => setOpen(true)}>
            View all{data ? ` (${filtered.length})` : ''}<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
      <TaskPulsePanel open={open} onOpenChange={setOpen} filter={filter} onFilterChange={setFilter} isManagement={isManagement} branchFilter={branchFilter} userId={user?.id} staff={staff} returnFocus={() => viewAllRef.current?.focus()} />
    </>
  );
}
