import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, X, Clock, CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor, initialsOf, type PTSessionRow } from './ptTypes';
import { splitSessionTimeline } from './sessionTimeline';
import { formatIST } from '@/lib/utils/datetime';

interface Props {
  sessions: PTSessionRow[];
  loading?: boolean;
  busy?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onSchedule: () => void;
}

/**
 * The trainer's actual daily job: who is coming today, and marking each
 * session done or cancelled without leaving the row.
 *
 * Trainer scoping happens in the parent query (`useTrainerSessions` is called
 * with only the signed-in trainer's id), so this panel renders what it is given.
 */
export function TodaySessionsPanel({
  sessions,
  loading,
  busy,
  isError,
  onRetry,
  onComplete,
  onCancel,
  onSchedule,
}: Props) {
  const [period, setPeriod] = useState('today');
  const { today, upcoming } = splitSessionTimeline(sessions);

  if (loading) {
    return (
      <Card className="rounded-2xl border-0 bg-card shadow-sm">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Appointments</h2>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList aria-label="Appointment period" className="h-auto rounded-xl">
            <TabsTrigger value="today" className="min-h-11 rounded-lg">Today · {today.length}</TabsTrigger>
            <TabsTrigger value="upcoming" className="min-h-11 rounded-lg">Upcoming · {upcoming.length}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {isError ? (
        <Card className="rounded-2xl border-0 bg-card shadow-sm">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive">Could not load appointments.</p>
            <Button variant="outline" onClick={onRetry} className="mt-3 min-h-11">Retry</Button>
          </CardContent>
        </Card>
      ) : (
      <Section
        title={period === 'today' ? 'Today' : 'Upcoming appointments'}
        rows={period === 'today' ? today : upcoming}
        emptyTitle={period === 'today' ? 'No appointments today' : 'No upcoming appointments'}
        emptyHint="Walk-in attendance is recorded in the daily roster."
        onSchedule={onSchedule}
        onComplete={onComplete}
        onCancel={onCancel}
        busy={busy}
      />
      )}
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
        'rounded-2xl border-0 bg-card shadow-sm',
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
                <Avatar className="h-9 w-9 shrink-0">
                  {s.member_avatar_url && (
                    <AvatarImage src={s.member_avatar_url} alt={s.member_name || 'Member'} />
                  )}
                  <AvatarFallback className={cn('text-xs font-semibold', avatarColor(s.member_name))}>
                    {initialsOf(s.member_name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {s.member_name || 'Member'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                     {formatIST(s.scheduled_at)} · {s.duration_minutes ?? 60} min
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
