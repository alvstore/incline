import { AppLayout } from '@/components/layout/AppLayout';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTasks, updateTaskStatus, getTaskStats, assignTask, type TaskStatus } from '@/services/taskService';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { usePageEntrance, useRowsEntrance, prefersReducedMotion } from '@/components/motion/pageMotion';
import { DecisionBarChart } from '@/components/motion/DecisionBarChart';
import { Button } from '@/components/ui/button';
import { XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AddTaskDrawer } from '@/components/tasks/AddTaskDrawer';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { TasksHeader, type TaskView } from '@/components/tasks/TasksHeader';
import { TaskStatsBento } from '@/components/tasks/TaskStatsBento';
import { TaskFilterPills, type QuickFilter } from '@/components/tasks/TaskFilterPills';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskCalendarView } from '@/components/tasks/TaskCalendarView';
import { TaskPrintSheet, PrintTasksButton } from '@/components/tasks/TaskPrintSheet';
import { useLinkedMembers } from '@/hooks/useLinkedMembers';
import { isTaskDueToday, isTaskOpen, isTaskOverdue } from '@/lib/tasks/taskStatus';

export default function TasksPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [view, setView] = useState<TaskView>('board');
  const [filter, setFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { effectiveBranchId } = useBranchContext();

  const { data: tasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['tasks', effectiveBranchId || 'all'],
    queryFn: () => fetchTasks(effectiveBranchId),
  });

  // Cmd+K deep links (preserved from original)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setDrawerOpen(true);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
    const taskId = url.searchParams.get('task');
    if (!taskId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (cancelled || !data) return;
      setSelectedTask(data);
      const u2 = new URL(window.location.href);
      u2.searchParams.delete('task');
      window.history.replaceState({}, '', u2.toString());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`tasks-live-${effectiveBranchId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['task-stats'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_status_history' }, () => {
        queryClient.invalidateQueries({ queryKey: ['task-history'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => {
        queryClient.invalidateQueries({ queryKey: ['task-comments'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [effectiveBranchId, queryClient]);

  const { data: stats } = useQuery({
    queryKey: ['task-stats', effectiveBranchId || 'all'],
    queryFn: () => getTaskStats(effectiveBranchId),
  });

  const { data: staffUsers = [] } = useQuery({
    queryKey: ['staff-users-for-tasks'],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['trainer', 'staff', 'manager', 'admin', 'owner']);
      if (!roles?.length) return [];
      const userIds = [...new Set(roles.map((r) => r.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      return profiles || [];
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => updateTaskStatus(id, status),
    onSuccess: () => {
      toast.success('Task updated');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-stats'] });
    },
  });

  const assignTaskMutation = useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) =>
      assignTask(taskId, userId, user?.id || ''),
    onSuccess: () => {
      toast.success('Task assigned');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: () => toast.error('Failed to assign task'),
  });

  // Quick-filter predicates — the single definition used for BOTH the pill
  // counts and the list that renders, so a badge can never promise rows the
  // view then refuses to show.
  const matchesFilter = useCallback(
    (t: any, key: QuickFilter) => {
      switch (key) {
        case 'mine':
          return t.assigned_to === user?.id && isTaskOpen(t);
        case 'today':
          return isTaskDueToday(t) && isTaskOpen(t);
        case 'overdue':
          return isTaskOverdue(t);
        case 'high':
          return (t.priority === 'high' || t.priority === 'urgent') && isTaskOpen(t);
        case 'unassigned':
          return !t.assigned_to && isTaskOpen(t);
        default:
          return true;
      }
    },
    [user?.id],
  );

  // Done-with-Undo: hide optimistically, commit after 5s unless undone.
  const [pendingDone, setPendingDone] = useState<Set<string>>(new Set());
  const doneTimers = useRef<Map<string, number>>(new Map());
  useEffect(() => () => { doneTimers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const changeStatus = useCallback((id: string, status: TaskStatus) => {
    if (status !== 'completed') { updateStatusMutation.mutate({ id, status }); return; }
    if (doneTimers.current.has(id)) return;
    setPendingDone((s) => new Set(s).add(id));
    const t = window.setTimeout(() => {
      doneTimers.current.delete(id);
      updateStatusMutation.mutate({ id, status }, {
        onSettled: () => setPendingDone((s) => { const n = new Set(s); n.delete(id); return n; }),
      });
    }, 5000);
    doneTimers.current.set(id, t);
    toast('Marking task done…', {
      duration: 5000,
      action: { label: 'Undo', onClick: () => {
        const tm = doneTimers.current.get(id);
        if (tm) window.clearTimeout(tm);
        doneTimers.current.delete(id);
        setPendingDone((s) => { const n = new Set(s); n.delete(id); return n; });
      } },
    });
  }, [updateStatusMutation]);

  const displayTasks = useMemo(
    () => (pendingDone.size ? tasks.map((t: any) => (pendingDone.has(t.id) ? { ...t, status: 'completed', completed_at: new Date().toISOString() } : t)) : tasks),
    [tasks, pendingDone],
  );

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayTasks.filter((t: any) => {
      if (q && !(`${t.title} ${t.description || ''}`.toLowerCase().includes(q))) return false;
      return matchesFilter(t, filter);
    });
  }, [displayTasks, filter, search, matchesFilter]);

  const linkedMembers = useLinkedMembers(tasks);

  const myOpenCount = useMemo(
    () => tasks.filter((t: any) => t.assigned_to === user?.id && isTaskOpen(t)).length,
    [tasks, user?.id],
  );

  const filterCounts = useMemo(
    () => ({
      all: tasks.length,
      mine: tasks.filter((t: any) => matchesFilter(t, 'mine')).length,
      today: tasks.filter((t: any) => matchesFilter(t, 'today')).length,
      overdue: tasks.filter((t: any) => matchesFilter(t, 'overdue')).length,
      high: tasks.filter((t: any) => matchesFilter(t, 'high')).length,
      unassigned: tasks.filter((t: any) => matchesFilter(t, 'unassigned')).length,
    }),
    [tasks, matchesFilter],
  );

  const openCount = (stats?.pending || 0) + (stats?.inProgress || 0);

  const subtitle = `${stats?.total || 0} total · ${openCount} open · ${filterCounts.overdue} overdue · ${
    filterCounts.today
  } due today`;

  const filterLabel =
    ({
      all: 'All tasks',
      mine: 'My tasks',
      today: 'Due today',
      overdue: 'Overdue',
      high: 'High priority',
      unassigned: 'Unassigned',
    } as Record<QuickFilter, string>)[filter] || 'All tasks';

  const pageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  usePageEntrance(pageRef);
  useRowsEntrance(viewRef, `${view}|${filter}|${effectiveBranchId}|${isLoading}`);

  // Keyboard: J/K move, Enter open, D done, N new
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"]')) return;
      if (drawerOpen || selectedTask) return;
      const ids = visibleTasks.map((x: any) => x.id);
      const i = focusId ? ids.indexOf(focusId) : -1;
      if (e.key === 'n') { setDrawerOpen(true); e.preventDefault(); return; }
      if (e.key === 'j' || e.key === 'k') {
        const n = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === 'j' ? 1 : -1)))];
        if (n) {
          setFocusId(n);
          const el = viewRef.current?.querySelector<HTMLElement>(`[data-flip-id="${n}"] button:not([aria-label="Drag task"]), [data-task-row="${n}"]`);
          el?.focus(); el?.scrollIntoView({ block: 'nearest' });
          e.preventDefault();
        }
        return;
      }
      const cur = visibleTasks.find((x: any) => x.id === focusId);
      if (!cur) return;
      if (e.key === 'Enter' && t === document.body) { setSelectedTask(cur); e.preventDefault(); }
      if (e.key === 'd' && cur.status !== 'completed' && cur.status !== 'cancelled') { changeStatus(cur.id, 'completed'); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleTasks, focusId, drawerOpen, selectedTask, changeStatus]);

  // Drawer contents stagger in when a task opens.
  useEffect(() => {
    if (!selectedTask || prefersReducedMotion()) return;
    const id = window.setTimeout(() => {
      const dlg = document.querySelector('[role="dialog"][data-state="open"]');
      const kids = dlg?.querySelectorAll(':scope > div > *, :scope > *:not(button)');
      if (kids?.length) gsap.from(kids, { opacity: 0, y: 14, duration: 0.5, ease: 'power3.out', delay: 0.12, stagger: 0.04, clearProps: 'opacity,transform' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [selectedTask?.id]);

  const finishedSeries = useMemo(() => [{ status: 'completed', label: 'Finished', dot: 'bg-success', bar: 'bg-success' }], []);

  return (
    <AppLayout>
      <div ref={pageRef} className="space-y-6">
        <TasksHeader
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          subtitle={subtitle}
          onNew={() => setDrawerOpen(true)}
        />

        <AddTaskDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
        <TaskDetailDrawer
          task={selectedTask}
          open={!!selectedTask}
          onOpenChange={(o) => !o && setSelectedTask(null)}
        />

        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <TaskStatsBento
              stats={stats}
              myOpenCount={myOpenCount}
              onOpenMine={() => setFilter('mine')}
              onFilter={(k) => setFilter(k as QuickFilter)}
            />
          </div>
          <div data-anim="card" className="rounded-2xl bg-card p-5 shadow-sm xl:col-span-4">
            <h2 className="mb-2 text-base font-semibold">Tasks finished · last 7 days</h2>
            <DecisionBarChart rows={displayTasks} series={finishedSeries} dateKey="completed_at" summaryNoun="tasks" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <TaskFilterPills value={filter} onChange={setFilter} counts={filterCounts} />
          <PrintTasksButton disabled={isLoading} />
        </div>

        <TaskPrintSheet
          tasks={visibleTasks}
          filterLabel={filterLabel}
          branchLabel={effectiveBranchId ? 'Selected branch' : 'All branches'}
          linkedMembers={linkedMembers}
        />


        <div ref={viewRef}>
        {isError ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-card py-12 text-center shadow-sm">
            <XCircle className="h-10 w-10 text-destructive/60" />
            <p className="text-sm text-muted-foreground">Couldn't load tasks.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : view === 'board' && isLoading ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading tasks">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-72 rounded-2xl bg-muted/60" />)}
          </div>
        ) : null}
        {!isError && !(view === 'board' && isLoading) && view === 'board' && (
          <TaskBoard
            tasks={visibleTasks}
            onOpen={setSelectedTask}
            onMove={changeStatus}
          />
        )}

        {!isError && view === 'list' && (
          <TaskListView
            tasks={visibleTasks}
            isLoading={isLoading}
            staffUsers={staffUsers}
            onOpen={setSelectedTask}
            onAssign={(taskId, userId) => assignTaskMutation.mutate({ taskId, userId })}
            onStatus={changeStatus}
          />
        )}

        {!isError && view === 'calendar' && <TaskCalendarView tasks={visibleTasks} onOpen={setSelectedTask} />}
        </div>
      </div>
    </AppLayout>
  );
}
