import { AppLayout } from '@/components/layout/AppLayout';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTasks, updateTaskStatus, getTaskStats, assignTask, type TaskStatus } from '@/services/taskService';
import { supabase } from '@/integrations/supabase/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const { data: tasks = [], isLoading } = useQuery({
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

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t: any) => {
      if (q && !(`${t.title} ${t.description || ''}`.toLowerCase().includes(q))) return false;
      return matchesFilter(t, filter);
    });
  }, [tasks, filter, search, matchesFilter]);

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

  return (
    <AppLayout>
      <div className="space-y-6">
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

        <TaskStatsBento
          stats={stats}
          myOpenCount={myOpenCount}
          onOpenMine={() => setFilter('mine')}
          onFilter={(k) => setFilter(k as QuickFilter)}
        />

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


        {view === 'board' && (
          <TaskBoard
            tasks={visibleTasks}
            onOpen={setSelectedTask}
            onMove={(id, status) => updateStatusMutation.mutate({ id, status })}
          />
        )}

        {view === 'list' && (
          <TaskListView
            tasks={visibleTasks}
            isLoading={isLoading}
            staffUsers={staffUsers}
            onOpen={setSelectedTask}
            onAssign={(taskId, userId) => assignTaskMutation.mutate({ taskId, userId })}
            onStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
          />
        )}

        {view === 'calendar' && <TaskCalendarView tasks={visibleTasks} onOpen={setSelectedTask} />}
      </div>
    </AppLayout>
  );
}
