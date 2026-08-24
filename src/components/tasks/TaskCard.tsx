import { MessageSquare, GripVertical, Clock, UserRound } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { formatISTFull } from '@/lib/utils/datetime';
import { cn } from '@/lib/utils';
import { DueDatePill } from './DueDatePill';
import { AssigneeAvatar } from './AssigneeAvatar';
import { PRIORITY_DOT, PRIORITY_PILL } from './taskTokens';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Props {
  task: any;
  onClick: () => void;
  draggable?: boolean;
}

export function TaskCard({ task, onClick, draggable = true }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-xl bg-card p-3.5 shadow-sm ring-1 ring-border',
        'transition-all duration-200 hover:shadow-md hover:shadow-sm hover:ring-primary/30',
        isDragging && 'opacity-50 ring-primary shadow-xl',
        task.status === 'completed' && 'opacity-75',
      )}
    >
      {draggable && (
        <button
          {...attributes}
          {...listeners}
          className="absolute right-1 top-1 p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-ring rounded"
          aria-label="Drag task"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      <button onClick={onClick} className="w-full text-left focus:outline-none">
        <div className="flex items-start gap-2">
          <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0', PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium)} />
          <div className="min-w-0 flex-1">
            <h4
              className={cn(
                'text-sm font-semibold text-foreground leading-snug',
                task.status === 'completed' && 'line-through text-muted-foreground',
              )}
            >
              {task.title}
            </h4>
            {task.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{task.description}</p>
            )}
          </div>
        </div>

        {task.created_at && (
          <p
            className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground"
            title={formatISTFull(task.created_at)}
          >
            <UserRound className="h-2.5 w-2.5" />
            Created {formatDistanceToNowStrict(new Date(task.created_at))} ago
            {task.assigner?.full_name ? ` by ${task.assigner.full_name}` : ''}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <DueDatePill dueDate={task.due_date} completed={task.status === 'completed'} />

            {task.due_time && !task.status.includes('completed') && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                <Clock className="h-2.5 w-2.5" />
                {task.due_time.substring(0, 5)}
              </span>
            )}
            {task.member_created && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                Member
              </span>
            )}
            {task.priority && (task.priority === 'high' || task.priority === 'urgent') && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  PRIORITY_PILL[task.priority],
                )}
              >
                {task.priority}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {task.comments_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> {task.comments_count}
              </span>
            )}
            <AssigneeAvatar name={task.assignee?.full_name} email={task.assignee?.email} />
          </div>
        </div>
      </button>
    </div>
  );
}
