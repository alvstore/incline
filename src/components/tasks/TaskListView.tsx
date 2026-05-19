import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssigneeAvatar } from './AssigneeAvatar';
import { DueDatePill } from './DueDatePill';
import { STATUS_PILL, STATUS_LABEL, PRIORITY_PILL, PRIORITY_DOT } from './taskTokens';
import type { TaskStatus } from '@/services/taskService';

interface Props {
  tasks: any[];
  isLoading: boolean;
  staffUsers: any[];
  onOpen: (task: any) => void;
  onAssign: (taskId: string, userId: string) => void;
  onStatus: (taskId: string, status: TaskStatus) => void;
}

export function TaskListView({ tasks, isLoading, staffUsers, onOpen, onAssign, onStatus }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
            <Skeleton className="h-2 w-2 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2 w-1/2" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-12 shadow-lg shadow-slate-200/50 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
          <CheckSquare className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">No tasks here yet</h3>
        <p className="mt-1 text-xs text-slate-500">Adjust filters, or click "New Task" to create one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          onClick={() => onOpen(task)}
          className={cn(
            'group flex items-center gap-3 rounded-xl bg-white p-3 sm:p-4 shadow-sm ring-1 ring-slate-200/60 cursor-pointer',
            'transition-all duration-150 hover:shadow-md hover:shadow-indigo-500/5 hover:ring-indigo-200',
            task.status === 'completed' && 'opacity-70',
          )}
        >
          <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', PRIORITY_DOT[task.priority])} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className={cn('text-sm font-semibold text-slate-900 truncate', task.status === 'completed' && 'line-through text-slate-500')}>
                {task.title}
              </h4>
              {(task.priority === 'high' || task.priority === 'urgent') && (
                <span className={cn('hidden sm:inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', PRIORITY_PILL[task.priority])}>
                  {task.priority}
                </span>
              )}
            </div>
            {task.description && (
              <p className="text-xs text-slate-500 truncate mt-0.5">{task.description}</p>
            )}
            <div className="mt-1.5 flex items-center gap-2 sm:hidden">
              <DueDatePill dueDate={task.due_date} completed={task.status === 'completed'} />
            </div>
          </div>

          <div className="hidden md:block">
            <DueDatePill dueDate={task.due_date} completed={task.status === 'completed'} />
          </div>

          <div onClick={(e) => e.stopPropagation()} className="hidden md:block">
            <Select value={task.assigned_to || 'unassigned'} onValueChange={(v) => onAssign(task.id, v)}>
              <SelectTrigger className="h-8 w-40 rounded-lg border-slate-200 text-xs">
                <SelectValue placeholder="Assign…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {staffUsers.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name || s.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:hidden">
            <AssigneeAvatar name={task.assignee?.full_name} email={task.assignee?.email} />
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <Select value={task.status} onValueChange={(v) => onStatus(task.id, v as TaskStatus)}>
              <SelectTrigger
                className={cn(
                  'h-7 w-auto min-w-[110px] rounded-full border-0 text-xs font-semibold focus:ring-2 focus:ring-indigo-500',
                  STATUS_PILL[task.status],
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}
    </div>
  );
}
