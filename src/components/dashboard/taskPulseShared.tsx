import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Apple, Dumbbell, UserCog, Lock, Snowflake, Sun, ClipboardList, MoreHorizontal, Check, X, ExternalLink, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { assignTask, updateTaskStatus } from '@/services/taskService';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TASK_TYPE_LABEL, type TaskTypeKey } from '@/lib/tasks/taskType';
import { cn } from '@/lib/utils';

export interface PulseTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  assigned_to: string | null;
  created_at: string;
  description?: string | null;
  linked_entity_type?: string | null;
  linked_entity_id?: string | null;
  assignee?: { id: string; full_name: string | null; email: string | null } | null;
}

const TYPE_STYLE: Record<TaskTypeKey, { icon: LucideIcon; tone: string }> = {
  diet: { icon: Apple, tone: 'bg-success/10 text-success' },
  workout: { icon: Dumbbell, tone: 'bg-info/10 text-info' },
  trainer: { icon: UserCog, tone: 'bg-primary/10 text-primary' },
  locker: { icon: Lock, tone: 'bg-warning/10 text-warning' },
  freeze: { icon: Snowflake, tone: 'bg-info/10 text-info' },
  resume: { icon: Sun, tone: 'bg-warning/10 text-warning' },
  general: { icon: ClipboardList, tone: 'bg-muted text-muted-foreground' },
};

/** Icon + text — never colour alone. High priority gets a destructive ring. */
export function TaskTypeTag({ type, high, compact }: { type: TaskTypeKey; high?: boolean; compact?: boolean }) {
  const { icon: Icon, tone } = TYPE_STYLE[type];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', high ? 'bg-destructive/10 text-destructive' : tone)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {compact ? null : TASK_TYPE_LABEL[type]}
      {compact && <span className="sr-only">{TASK_TYPE_LABEL[type]}</span>}
    </span>
  );
}

export const fullDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Staff/trainers working in the branch (falls back to all staff when no branch selected). */
export function useBranchStaff(branchId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['task-pulse-staff', branchId ?? 'all'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let ids: string[] = [];
      if (branchId) {
        const [{ data: sb }, { data: tr }] = await Promise.all([
          supabase.from('staff_branches').select('user_id').eq('branch_id', branchId),
          (supabase as any).from('trainers').select('user_id').eq('branch_id', branchId).eq('is_active', true),
        ]);
        ids = [...(sb || []), ...(tr || [])].map((r: any) => r.user_id).filter(Boolean);
      } else {
        const { data } = await supabase.from('user_roles').select('user_id').in('role', ['trainer', 'staff', 'manager']);
        ids = (data || []).map((r) => r.user_id);
      }
      ids = [...new Set(ids)];
      if (!ids.length) return [] as { id: string; full_name: string | null }[];
      const { data: p } = await supabase.from('profiles').select('id, full_name').in('id', ids).order('full_name');
      return (p || []) as { id: string; full_name: string | null }[];
    },
  });
}

/** Assign + status mutations with optimistic cache update and Undo for close. */
export function useTaskPulseActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dashboard-my-tasks'] });
    qc.invalidateQueries({ queryKey: ['task-pulse-panel'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task-stats'] });
  };
  const hideOptimistic = (id: string) => {
    qc.setQueriesData({ queryKey: ['dashboard-my-tasks'] }, (old: any) =>
      Array.isArray(old) ? old.filter((t: PulseTask) => t.id !== id) : old,
    );
  };

  const assign = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string; name: string }) => assignTask(id, userId, user?.id || ''),
    onSuccess: (_d, v) => toast.success(`Assigned to ${v.name}`),
    onError: () => toast.error('Could not assign task'),
    onSettled: refresh,
  });

  const close = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'completed' | 'cancelled'; title: string }) => updateTaskStatus(id, status),
    onMutate: ({ id }) => hideOptimistic(id),
    onSuccess: (_d, v) =>
      toast.success(v.status === 'completed' ? 'Task marked done' : 'Task cancelled', {
        description: v.title,
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => updateTaskStatus(v.id, 'pending').then(refresh).catch(() => toast.error('Undo failed')),
        },
      }),
    onError: () => toast.error('Could not update task'),
    onSettled: refresh,
  });

  return { assign, close };
}

export function TaskQuickActions({
  task, canAssign, staff, onOpen,
}: {
  task: PulseTask;
  canAssign: boolean;
  staff: { id: string; full_name: string | null }[];
  onOpen: () => void;
}) {
  const { assign, close } = useTaskPulseActions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Actions for ${task.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs">{task.title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canAssign && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><UserPlus className="mr-2 h-4 w-4" />Assign to…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
              {staff.length === 0 && <DropdownMenuItem disabled>No staff in this branch</DropdownMenuItem>}
              {staff.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => assign.mutate({ id: task.id, userId: s.id, name: s.full_name || 'staff' })}
                >
                  {task.assigned_to === s.id && <Check className="mr-2 h-4 w-4" />}
                  <span className="truncate">{s.full_name || 'Unnamed'}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem onSelect={() => close.mutate({ id: task.id, status: 'completed', title: task.title })}>
          <Check className="mr-2 h-4 w-4" />Mark done
        </DropdownMenuItem>
        {canAssign && (
          <DropdownMenuItem onSelect={() => close.mutate({ id: task.id, status: 'cancelled', title: task.title })}>
            <X className="mr-2 h-4 w-4" />Cancel task
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpen}><ExternalLink className="mr-2 h-4 w-4" />Open</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
