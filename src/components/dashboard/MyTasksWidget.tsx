import { useMemo } from 'react';
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
import { PRIORITY_DOT } from '@/components/tasks/taskTokens';
import { cn } from '@/lib/utils';
import { ClipboardList, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
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

/**
 * Live task pulse for every operational dashboard.
 * Owners / admins / managers see the branch queue; staff and trainers see
 * only the tasks assigned to them.
 */
export function MyTasksWidget({ branchFilter, className }: Props) {
  const { user, roles } = useAuth();
  const navigate = useNavigate();

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

  const tasks = data || [];
  const { startISO, endISO } = getISTDayRange();
  const dueToday = tasks.filter(
    (t) => t.due_date && t.due_date >= startISO.slice(0, 10) && t.due_date <= endISO.slice(0, 10),
  ).length;
  const overdue = tasks.filter(
    (t) => t.due_date && new Date(t.due_date).getTime() < new Date(startISO).getTime(),
  ).length;

  return (
    <Card className={cn('rounded-2xl border-none shadow-lg shadow-primary/10', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold">
          <span className="rounded-full bg-primary/10 p-2 text-primary">
            <ClipboardList className="h-4 w-4" />
          </span>
          {isManagement ? 'Task Pulse' : 'My Tasks'}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          onClick={() => navigate('/tasks')}
          aria-label="Open tasks page"
        >
          View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Could not load tasks right now.</p>
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-xl font-bold text-foreground">{tasks.length}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Open</p>
              </div>
              <div className="rounded-xl bg-warning/10 p-3 text-center">
                <p className="text-xl font-bold text-warning">{dueToday}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Due today</p>
              </div>
              <div className="rounded-xl bg-destructive/10 p-3 text-center">
                <p className="text-xl font-bold text-destructive">{overdue}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Overdue</p>
              </div>
            </div>

            {tasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle2 className="h-6 w-6 text-success" />
                <p className="text-sm font-medium text-foreground">No open tasks</p>
                <p className="text-xs text-muted-foreground">Everything is clear right now.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {tasks.slice(0, 5).map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/tasks?id=${task.id}`)}
                      className="flex w-full items-center gap-2 rounded-xl p-2.5 text-left transition-colors duration-150 hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          PRIORITY_DOT[task.priority as keyof typeof PRIORITY_DOT] || PRIORITY_DOT.medium,
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
                        <DueDatePill dueDate={task.due_date} className="mt-1" />
                      </span>
                      <AssigneeAvatar name={task.assignee?.full_name} email={task.assignee?.email} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
