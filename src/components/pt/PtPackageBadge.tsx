import { CalendarDays, Dumbbell } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface PtPackageBadgeProps {
  packageType: 'session_based' | 'monthly';
  sessionsRemaining?: number | null;
  sessionsTotal?: number | null;
  expiryDate?: string | null;
  className?: string;
}

/** Compact roster badge that visually delineates session-based vs monthly PT packs. */
export function PtPackageBadge({
  packageType,
  sessionsRemaining,
  sessionsTotal,
  expiryDate,
  className,
}: PtPackageBadgeProps) {
  if (packageType === 'monthly') {
    const days = expiryDate
      ? differenceInCalendarDays(new Date(expiryDate), new Date())
      : null;
    const tone =
      days === null
        ? 'bg-slate-100 text-slate-700'
        : days < 0
          ? 'bg-red-100 text-red-700'
          : days <= 7
            ? 'bg-amber-100 text-amber-700'
            : 'bg-emerald-100 text-emerald-700';

    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
          tone,
          className,
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        <span>
          Monthly · Expires{' '}
          {expiryDate ? format(new Date(expiryDate), 'd MMM') : '—'}
        </span>
      </div>
    );
  }

  const total = sessionsTotal ?? 0;
  const remaining = sessionsRemaining ?? 0;
  const used = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <div className={cn('flex flex-col gap-1 min-w-[140px]', className)}>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 w-fit">
        <Dumbbell className="h-3.5 w-3.5" />
        <span>{remaining} sessions left</span>
      </div>
      {total > 0 && (
        <Progress
          value={pct}
          className="h-1 rounded-full bg-indigo-100 [&>div]:bg-indigo-500"
        />
      )}
    </div>
  );
}
