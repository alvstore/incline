import { Button } from '@/components/ui/button';
import { Check, RotateCcw, UserX } from 'lucide-react';
import { useMarkBookingAttendance, type AttendanceState } from '@/hooks/useMarkBookingAttendance';

interface AttendanceActionsProps {
  bookingId: string;
  status: string;
  /** Compact renders icon-only buttons for dense rows. */
  compact?: boolean;
}

/** Mark attended / no-show / reset for a facility booking. */
export function AttendanceActions({ bookingId, status, compact = false }: AttendanceActionsProps) {
  const { mutate, isPending, variables } = useMarkBookingAttendance();

  if (status === 'cancelled') return null;

  const busy = (state: AttendanceState) => isPending && variables?.bookingId === bookingId && variables?.state === state;
  const size = compact ? 'sm' : 'sm';

  return (
    <div className="flex items-center gap-1.5">
      {status !== 'attended' && (
        <Button
          type="button"
          size={size}
          variant="outline"
          disabled={isPending}
          onClick={() => mutate({ bookingId, state: 'attended' })}
          aria-label="Mark attended"
          className="rounded-lg gap-1.5 min-h-[36px] cursor-pointer border-success/30 text-success hover:bg-success/10 focus:ring-2 focus:ring-success/40 transition-colors duration-200"
        >
          <Check className="h-4 w-4" />
          {!compact && (busy('attended') ? 'Saving…' : 'Attended')}
        </Button>
      )}

      {status !== 'no_show' && (
        <Button
          type="button"
          size={size}
          variant="outline"
          disabled={isPending}
          onClick={() => mutate({ bookingId, state: 'no_show' })}
          aria-label="Mark no-show"
          className="rounded-lg gap-1.5 min-h-[36px] cursor-pointer border-destructive/30 text-destructive hover:bg-destructive/10 focus:ring-2 focus:ring-destructive/40 transition-colors duration-200"
        >
          <UserX className="h-4 w-4" />
          {!compact && (busy('no_show') ? 'Saving…' : 'No-show')}
        </Button>
      )}

      {(status === 'attended' || status === 'no_show') && (
        <Button
          type="button"
          size={size}
          variant="ghost"
          disabled={isPending}
          onClick={() => mutate({ bookingId, state: 'booked' })}
          aria-label="Undo attendance marking"
          className="rounded-lg gap-1.5 min-h-[36px] cursor-pointer text-muted-foreground focus:ring-2 focus:ring-primary/40 transition-colors duration-200"
        >
          <RotateCcw className="h-4 w-4" />
          {!compact && 'Undo'}
        </Button>
      )}
    </div>
  );
}
