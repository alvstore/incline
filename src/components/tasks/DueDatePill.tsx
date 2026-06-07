import { Clock, AlertCircle, CalendarDays } from 'lucide-react';
import { formatDistanceToNowStrict, isPast, isToday, differenceInHours } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  dueDate: string | null;
  completed?: boolean;
  className?: string;
}

export function DueDatePill({ dueDate, completed, className }: Props) {
  if (!dueDate) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <CalendarDays className="h-3 w-3" />
        No due date
      </span>
    );
  }
  const d = new Date(dueDate);
  const overdue = !completed && isPast(d) && !isToday(d);
  const dueSoon = !completed && !overdue && differenceInHours(d, new Date()) <= 24;

  const tone = completed
    ? 'bg-success/10 text-success ring-success/30'
    : overdue
      ? 'bg-destructive/10 text-destructive ring-destructive/30'
      : dueSoon
        ? 'bg-warning/10 text-warning ring-warning/30'
        : 'bg-muted/40 text-muted-foreground ring-border';

  const label = overdue
    ? `${formatDistanceToNowStrict(d)} overdue`
    : isToday(d)
      ? 'Today'
      : `in ${formatDistanceToNowStrict(d)}`;

  const Icon = overdue ? AlertCircle : Clock;

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
