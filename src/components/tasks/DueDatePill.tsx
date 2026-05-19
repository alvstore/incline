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
      <span className={cn('inline-flex items-center gap-1 text-xs text-slate-400', className)}>
        <CalendarDays className="h-3 w-3" />
        No due date
      </span>
    );
  }
  const d = new Date(dueDate);
  const overdue = !completed && isPast(d) && !isToday(d);
  const dueSoon = !completed && !overdue && differenceInHours(d, new Date()) <= 24;

  const tone = completed
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
    : overdue
      ? 'bg-red-50 text-red-700 ring-red-100'
      : dueSoon
        ? 'bg-amber-50 text-amber-700 ring-amber-100'
        : 'bg-slate-50 text-slate-600 ring-slate-100';

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
