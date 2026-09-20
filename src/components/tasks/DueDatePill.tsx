import { Clock, AlertCircle, CalendarDays, CheckCircle2, Ban } from 'lucide-react';
import { formatDistanceToNowStrict, isPast, isToday, differenceInHours } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  dueDate: string | null;
  /** @deprecated prefer `status` — kept for callers that only know completion */
  completed?: boolean;
  status?: string;
  className?: string;
}

export function DueDatePill({ dueDate, completed, status, className }: Props) {
  const isCompleted = status ? status === 'completed' : !!completed;
  const isCancelled = status === 'cancelled';
  const isClosed = isCompleted || isCancelled;

  if (!dueDate) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <CalendarDays className="h-3 w-3" />
        No due date
      </span>
    );
  }

  const d = new Date(dueDate);
  const overdue = !isClosed && isPast(d) && !isToday(d);
  const dueSoon = !isClosed && !overdue && differenceInHours(d, new Date()) <= 24;

  const tone = isCancelled
    ? 'bg-muted text-muted-foreground ring-border'
    : isCompleted
      ? 'bg-success/10 text-success ring-success/30'
      : overdue
        ? 'bg-destructive/10 text-destructive ring-destructive/30'
        : dueSoon
          ? 'bg-warning/10 text-warning ring-warning/30'
          : 'bg-muted/40 text-muted-foreground ring-border';

  const label = isCancelled
    ? 'Cancelled'
    : isCompleted
      ? 'Done'
      : overdue
        ? `${formatDistanceToNowStrict(d)} overdue`
        : isToday(d)
          ? 'Today'
          : `in ${formatDistanceToNowStrict(d)}`;

  const Icon = isCancelled ? Ban : isCompleted ? CheckCircle2 : overdue ? AlertCircle : Clock;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        tone,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
