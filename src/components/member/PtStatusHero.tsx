import { CalendarDays, Dumbbell } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface PtStatusHeroProps {
  packageType: 'session_based' | 'monthly';
  packageName: string;
  trainerName?: string | null;
  sessionsRemaining?: number | null;
  sessionsTotal?: number | null;
  startDate?: string | null;
  expiryDate?: string | null;
  className?: string;
}

/** Premium member-facing hero card showing live PT status. */
export function PtStatusHero(props: PtStatusHeroProps) {
  return (
    <Card
      className={cn(
        'rounded-2xl border-0 shadow-lg shadow-indigo-500/10 overflow-hidden text-white',
        'bg-gradient-to-br from-violet-600 to-indigo-600',
        props.className,
      )}
    >
      <div className="p-5 flex items-center gap-5">
        <RingIndicator {...props} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs uppercase tracking-wider text-white/70 flex items-center gap-1">
            {props.packageType === 'monthly' ? (
              <CalendarDays className="h-3.5 w-3.5" />
            ) : (
              <Dumbbell className="h-3.5 w-3.5" />
            )}
            {props.packageType === 'monthly' ? 'Monthly Plan' : 'Session Pack'}
          </p>
          <h3 className="text-lg font-bold truncate">{props.packageName}</h3>
          <p className="text-sm text-white/80">
            {props.packageType === 'monthly'
              ? props.expiryDate
                ? `Plan ends ${format(new Date(props.expiryDate), 'd MMM yyyy')}`
                : 'Active monthly plan'
              : `${props.sessionsRemaining ?? 0} of ${props.sessionsTotal ?? 0} sessions remaining`}
          </p>
          {props.trainerName && (
            <p className="text-sm text-white/70">Trainer · {props.trainerName}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function RingIndicator(props: PtStatusHeroProps) {
  // SVG ring (no recharts dep — keeps bundle small).
  const size = 96;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let pct = 0;
  let centerTop = '0';
  let centerBottom = '';

  if (props.packageType === 'session_based') {
    const total = props.sessionsTotal ?? 0;
    const remaining = props.sessionsRemaining ?? 0;
    pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    centerTop = `${remaining}`;
    centerBottom = `/ ${total}`;
  } else {
    const total =
      props.startDate && props.expiryDate
        ? Math.max(
            1,
            differenceInCalendarDays(
              new Date(props.expiryDate),
              new Date(props.startDate),
            ),
          )
        : 30;
    const remaining = props.expiryDate
      ? Math.max(
          0,
          differenceInCalendarDays(new Date(props.expiryDate), new Date()),
        )
      : 0;
    pct = Math.max(0, Math.min(1, remaining / total));
    centerTop = `${remaining}`;
    centerBottom = remaining === 1 ? 'day' : 'days';
  }

  const dash = c * pct;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="white"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold leading-none">{centerTop}</span>
        {centerBottom && (
          <span className="text-[10px] uppercase tracking-wider text-white/80 mt-1">
            {centerBottom}
          </span>
        )}
      </div>
    </div>
  );
}
