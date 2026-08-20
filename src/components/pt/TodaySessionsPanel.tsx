import { useMemo } from 'react';
import { format, isSameDay, isAfter } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, Clock, CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor, initialsOf, type PTSessionRow } from './ptTypes';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  sessions: PTSessionRow[];
  loading?: boolean;
  busy?: boolean;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onSchedule: () => void;
}

/**
 * The trainer's actual daily job: who is coming today, and marking each
 * session done or cancelled without leaving the row.
 */
export function TodaySessionsPanel({
  sessions,
  loading,
  busy,
  onComplete,
  onCancel,
  onSchedule,
}: Props) {
  const now = new Date();
  const { user, roles } = useAuth();
  const isTrainer = roles.some(r => r.role === 'trainer');
  const isAdmin = roles.some(r => ['owner', 'admin', 'manager'].includes(r.role));

  const filteredSessions = useMemo(() => {
    // If user is a trainer and NOT an admin/manager, filter sessions to only show their own.
    // The session data comes from fetchTrainerSessions which includes trainer_id.
    if (isTrainer && !isAdmin && user?.id) {
      return sessions.filter(s => (s as any).trainer_id === user.id);
    }
    return sessions;
  }, [sessions, isTrainer, isAdmin, user?.id]);

  const { today, upcoming } = useMemo(() => {
    const sorted = [...filteredSessions].sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
    );
    return {
      today: sorted.filter((s) => isSameDay(new Date(s.scheduled_at), now)),
      upcoming: sorted.filter(
        (s) => !isSameDay(new Date(s.scheduled_at), now) && isAfter(new Date(s.scheduled_at), now),
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSessions, now]);

  if (loading) {
    return (
      <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
        <CardContent className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title={`Today · ${format(now, 'EEEE, d MMM')}`}
        rows={today}
        emptyTitle="No sessions today"
        emptyHint="Schedule a session and it will show up here."
        onSchedule={onSchedule}
        onComplete={onComplete}
        onCancel={onCancel}
        busy={busy}
        highlight
      />
      <Section
        title="Upcoming"
        rows={upcoming.slice(0, 20)}
        emptyTitle="Nothing scheduled ahead"
        emptyHint="Future sessions will appear here."
        onSchedule={onSchedule}
        onComplete={onComplete}
        onCancel={onCancel}
        busy={busy}
      />
    </div>
  );
}

function Section({
  title,
  rows,
  emptyTitle,
  emptyHint,
  onSchedule,
  onComplete,
  onCancel,
  busy,
  highlight,
}: {
  title: string;
  rows: PTSessionRow[];
  emptyTitle: string;
  emptyHint: string;
  onSchedule: () => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  busy?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        'rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50',
        highlight && 'ring-1 ring-primary/20',
      )}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {rows.length} session{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
              aria-hidden
            >
              <Clock className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{emptyHint}</p>
            <Button onClick={onSchedule} className="mt-4 gap-2">
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Schedule session
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    avatarColor(s.member_name),
                  )}
                  aria-hidden
                >
                  {initialsOf(s.member_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {s.member_name || 'Member'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {format(new Date(s.scheduled_at), 'PPP p')} · {s.duration_minutes ?? 60} min
                  </p>
                </div>

                <Badge
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium',
                    s.status === 'completed'
                      ? 'bg-success/10 text-success hover:bg-success/10'
                      : s.status === 'cancelled'
                        ? 'bg-destructive/10 text-destructive hover:bg-destructive/10'
                        : 'bg-primary/10 text-primary hover:bg-primary/10',
                  )}
                >
                  {s.status}
                </Badge>

                {s.status === 'scheduled' && (
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Mark session for ${s.member_name || 'member'} complete`}
                      className="h-11 w-11 cursor-pointer rounded-lg text-success hover:bg-success/10"
                      onClick={() => onComplete(s.id)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Cancel session for ${s.member_name || 'member'}`}
                      className="h-11 w-11 cursor-pointer rounded-lg text-destructive hover:bg-destructive/10"
                      onClick={() => onCancel(s.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
