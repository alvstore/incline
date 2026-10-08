import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { DueDatePill } from '@/components/tasks/DueDatePill';
import { AssigneeAvatar } from '@/components/tasks/AssigneeAvatar';
import { PRIORITY_DOT, PRIORITY_PILL } from '@/components/tasks/taskTokens';
import { cn } from '@/lib/utils';
import {
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  CalendarClock,
  Flame,
  Inbox,
  ChevronRight,
} from 'lucide-react';
import { getISTDayRange } from '@/lib/utils/datetime';

interface Props {
  branchFilter?: string | null;
  className?: string;
}

const REALTIME_TABLES = ['tasks'];

interface TaskRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  assigned_to: string | null;
  created_at: string;
}

type FilterKey = 'all' | 'today' | 'overdue' | 'urgent';

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/**
 * Live task pulse for every operational dashboard.
 * Owners / admins / managers see the branch queue; staff and trainers see
 * only the tasks assigned to them.
 */
export function MyTasksWidget({ branchFilter, className }: Props) {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');

  const isManagement = useMemo(
    () => (roles || []).some((r: any) => ['owner', 'admin', 'manager'].includes(r.role)),
    [roles],
  );

  const queryKey = ['dashboard-my-tasks', user?.id ?? 'anon', isManagement ? branchFilter ?? 'all' : 'mine'];

  useRealtimeInvalidate({
    channel: `dashboard-tasks-${user?.id ?? 'anon'}`,
    tables: REALTIME_TABLES,
    invalidateKeys: [['dashboard-my-tasks']],
    enabled: !!user,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select('id, title, priority, status, due_date, due_time, assigned_to, created_at')
        .not('status', 'in', '(completed,cancelled)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(50);

      if (isManagement) {
        if (branchFilter) query = query.eq('branch_id', branchFilter);
      } else {
        query = query.eq('assigned_to', user!.id);
      }

      const { data: rows, error } = await query;
      if (error) throw error;

      const tasks = (rows || []) as TaskRow[];
      const assigneeIds = [...new Set(tasks.map((t) => t.assigned_to).filter(Boolean) as string[])];
      let profiles: any[] = [];
      if (assigneeIds.length) {
        const { data: p } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', assigneeIds);
        profiles = p || [];
      }
      return tasks.map((t) => ({
        ...t,
        assignee: profiles.find((p) => p.id === t.assigned_to) || null,
      }));
    },
  });

  const tasks = useMemo(() => data || [], [data]);
  const { startISO, endISO } = getISTDayRange();
  const todayKey = startISO.slice(0, 10);
  const endKey = endISO.slice(0, 10);

  const isDueToday = useCallback(
    (t: any) => !!t.due_date && t.due_date >= todayKey && t.due_date <= endKey,
    [todayKey, endKey],
  );
  const isOverdue = useCallback(
    (t: any) => !!t.due_date && new Date(t.due_date).getTime() < new Date(startISO).getTime(),
    [startISO],
  );

  const dueToday = tasks.filter(isDueToday).length;
  const overdue = tasks.filter(isOverdue).length;
  const urgent = tasks.filter((t) => t.priority === 'urgent' || t.priority === 'high').length;

  const visibleTasks = useMemo(() => {
    switch (filter) {
      case 'today':
        return tasks.filter(isDueToday);
      case 'overdue':
        return tasks.filter(isOverdue);
      case 'urgent':
        return tasks.filter((t) => t.priority === 'urgent' || t.priority === 'high');
      default:
        return tasks;
    }
  }, [tasks, filter, isDueToday, isOverdue]);

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: tasks.length },
    { key: 'today', label: 'Due today', count: dueToday },
    { key: 'overdue', label: 'Overdue', count: overdue },
    { key: 'urgent', label: 'High priority', count: urgent },
  ];

  return (
    <Card
      className={cn(
        'rounded-2xl border-none shadow-lg shadow-primary/10 transition-all duration-200 hover:shadow-xl hover:shadow-primary/15',
        className,
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-4">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-primary/10 p-2.5 text-primary">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              {isManagement ? 'Task Pulse' : 'My Tasks'}
              <span className="relative inline-flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isManagement ? 'Live branch queue, updated in real time' : 'Your open work, updated in real time'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 cursor-pointer rounded-full text-primary hover:bg-primary/10"
          onClick={() => navigate('/tasks')}
          aria-label="Open tasks page"
        >
          View all <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
            <Skeleton className="h-8 w-2/3 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="rounded-full bg-destructive/10 p-2.5 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-sm text-muted-foreground">Could not load tasks right now.</p>
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Ambient metric tiles */}
            <div className="grid grid-cols-3 gap-3">
              <MetricTile
                label="Open"
                value={tasks.length}
                icon={Inbox}
                tone="primary"
                active={filter === 'all'}
                onClick={() => setFilter('all')}
              />
              <MetricTile
                label="Due today"
                value={dueToday}
                icon={CalendarClock}
                tone="warning"
                active={filter === 'today'}
                onClick={() => setFilter('today')}
              />
              <MetricTile
                label="Overdue"
                value={overdue}
                icon={Flame}
                tone="destructive"
                active={filter === 'overdue'}
                onClick={() => setFilter('overdue')}
              />
            </div>

            {/* Quick filters */}
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn(
                    'inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                    filter === f.key
                      ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                      filter === f.key ? 'bg-primary-foreground/20' : 'bg-background/70',
                    )}
                  >
                    {f.count}
                  </span>
                </button>
              ))}
            </div>

            {visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-success/5 py-8 text-center">
                <span className="rounded-full bg-success/10 p-2.5 text-success">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-foreground">
                  {filter === 'all' ? 'No open tasks' : 'Nothing in this view'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {filter === 'all' ? 'Everything is clear right now.' : 'Try another filter above.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {visibleTasks.slice(0, 5).map((task) => {
                  const late = isOverdue(task);
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/tasks?id=${task.id}`)}
                        className={cn(
                          'group flex w-full min-h-[56px] items-center gap-3 rounded-xl p-3 text-left transition-all duration-200 cursor-pointer',
                          'bg-muted/30 hover:bg-muted/60 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary',
                          late && 'bg-destructive/5 hover:bg-destructive/10',
                        )}
                      >
                        <span
                          className={cn(
                            'h-8 w-1 shrink-0 rounded-full',
                            PRIORITY_DOT[task.priority as keyof typeof PRIORITY_DOT] || PRIORITY_DOT.medium,
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{task.title}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                PRIORITY_PILL[task.priority as keyof typeof PRIORITY_PILL] || PRIORITY_PILL.medium,
                              )}
                            >
                              {PRIORITY_LABEL[task.priority] || 'Medium'}
                            </span>
                            <DueDatePill dueDate={task.due_date} />
                          </span>
                        </span>
                        <AssigneeAvatar name={task.assignee?.full_name} email={task.assignee?.email} />
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone: 'primary' | 'warning' | 'destructive';
  active: boolean;
  onClick: () => void;
}) {
  const toneMap = {
    primary: { bg: 'bg-primary/5', ring: 'ring-primary/40', text: 'text-primary', badge: 'bg-primary/10 text-primary' },
    warning: { bg: 'bg-warning/5', ring: 'ring-warning/40', text: 'text-warning', badge: 'bg-warning/10 text-warning' },
    destructive: {
      bg: 'bg-destructive/5',
      ring: 'ring-destructive/40',
      text: 'text-destructive',
      badge: 'bg-destructive/10 text-destructive',
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${value}`}
      className={cn(
        'cursor-pointer rounded-2xl p-3.5 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary',
        toneMap.bg,
        'hover:shadow-md',
        active && `ring-2 ${toneMap.ring}`,
      )}
    >
      <span className={cn('inline-flex rounded-full p-1.5', toneMap.badge)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', toneMap.text)}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    </button>
  );
}
