import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ChevronLeft, ChevronRight, CalendarDays, Filter, Sunrise, Sun, Sunset } from 'lucide-react';
import { useClassSessions, useClassTypes } from '@/hooks/useClassTypes';
import { SessionOverrideDrawer } from '@/components/classes/SessionOverrideDrawer';
import { SHIFT_META, addDaysKey, groupSessionsByShift, istDateKey, istTimeKey, labelForDateKey, sessionInstructor, slotsLeft } from '@/lib/classes/schedule';
import { cn } from '@/lib/utils';
import type { ClassSession, ClassShift } from '@/types/classEngine';

interface Props {
  branchId: string;
  onOpenRoster?: (classId: string) => void;
}

const SHIFT_ICON: Record<ClassShift, typeof Sunrise> = { morning: Sunrise, afternoon: Sun, evening: Sunset };
const IST_OFFSET = '+05:30';

/** ISO instant for IST midnight of a yyyy-MM-dd key. */
function istMidnightISO(key: string): string {
  return new Date(`${key}T00:00:00${IST_OFFSET}`).toISOString();
}

/**
 * Master calendar — a 7-day board of every generated session. Staff click a
 * session to swap the trainer, move the time, or cancel just that slot.
 */
export function MasterClassCalendar({ branchId, onOpenRoster }: Props) {
  const todayKey = useMemo(() => istDateKey(new Date()), []);
  const [weekStart, setWeekStart] = useState(todayKey);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [active, setActive] = useState<ClassSession | null>(null);

  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)), [weekStart]);
  const fromISO = istMidnightISO(weekStart);
  const toISO = istMidnightISO(addDaysKey(weekStart, 7));

  const { data: classTypes } = useClassTypes(branchId, true);
  const { data: sessions, isLoading, isError, refetch } = useClassSessions(branchId, {
    fromISO, toISO, includeCancelled, classTypeId: typeFilter === 'all' ? undefined : typeFilter,
  });

  const byDay = useMemo(() => {
    const map: Record<string, ClassSession[]> = {};
    for (const k of dayKeys) map[k] = [];
    for (const s of sessions ?? []) {
      const k = istDateKey(s.scheduled_at);
      if (map[k]) map[k].push(s);
    }
    return map;
  }, [sessions, dayKeys]);

  const weekTotals = useMemo(() => {
    const live = (sessions ?? []).filter((s) => !s.cancelled_at && s.is_active);
    const booked = live.reduce((a, s) => a + (s.booked_count ?? 0), 0);
    const cap = live.reduce((a, s) => a + (s.capacity ?? 0), 0);
    return { sessions: live.length, booked, cap, full: live.filter((s) => slotsLeft(s) === 0).length, cancelled: (sessions ?? []).filter((s) => !!s.cancelled_at).length };
  }, [sessions]);

  const rangeLabel = `${labelForDateKey(weekStart, todayKey)} → ${labelForDateKey(addDaysKey(weekStart, 6), todayKey)}`;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10 cursor-pointer" aria-label="Previous week" onClick={() => setWeekStart(addDaysKey(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" className="h-10 cursor-pointer" onClick={() => setWeekStart(todayKey)} disabled={weekStart === todayKey}>Today</Button>
          <Button variant="outline" size="icon" className="h-10 w-10 cursor-pointer" aria-label="Next week" onClick={() => setWeekStart(addDaysKey(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
          <p className="ml-2 text-sm font-semibold text-foreground">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-10 w-[180px]" aria-label="Filter by class"><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="All classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {(classTypes ?? []).map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
            <Switch checked={includeCancelled} onCheckedChange={setIncludeCancelled} aria-label="Show cancelled sessions" />
            <span className="text-muted-foreground">Show cancelled</span>
          </label>
        </div>
      </div>

      {/* Week summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Sessions this week', value: weekTotals.sessions, tone: 'text-foreground' },
          { label: 'Spots booked', value: `${weekTotals.booked} / ${weekTotals.cap}`, tone: 'text-primary' },
          { label: 'Full classes', value: weekTotals.full, tone: weekTotals.full ? 'text-destructive' : 'text-foreground' },
          { label: 'Cancelled', value: weekTotals.cancelled, tone: weekTotals.cancelled ? 'text-warning' : 'text-foreground' },
        ].map((k) => (
          <Card key={k.label} className="rounded-2xl"><CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</p>
            <p className={cn('mt-1 text-2xl font-bold', k.tone)}>{k.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {isError ? (
        <Card className="rounded-2xl"><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Could not load the calendar.</p>
          <Button variant="outline" className="cursor-pointer" onClick={() => refetch()}>Try again</Button>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {dayKeys.map((k) => {
            const daySessions = byDay[k] ?? [];
            const isToday = k === todayKey;
            const isPastDay = k < todayKey;
            const groups = groupSessionsByShift(daySessions);
            return (
              <Card key={k} className={cn('flex min-h-[220px] flex-col rounded-2xl', isToday && 'ring-2 ring-primary/30', isPastDay && 'opacity-70')}>
                <div className={cn('flex items-center justify-between rounded-t-2xl px-3 py-2', isToday ? 'bg-primary text-primary-foreground' : 'bg-muted/50')}>
                  <p className="text-sm font-semibold">{labelForDateKey(k, todayKey)}</p>
                  <Badge variant={isToday ? 'secondary' : 'outline'} className="rounded-full text-[10px]">{daySessions.filter((s) => !s.cancelled_at).length}</Badge>
                </div>
                <CardContent className="flex-1 space-y-3 p-2">
                  {isLoading ? (
                    <><Skeleton className="h-16 w-full rounded-xl" /><Skeleton className="h-16 w-full rounded-xl" /></>
                  ) : daySessions.length === 0 ? (
                    <div className="flex h-full min-h-[120px] flex-col items-center justify-center text-center">
                      <CalendarDays className="mb-1 h-5 w-5 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">No sessions</p>
                    </div>
                  ) : (
                    groups.map(({ shift, sessions: list }) => {
                      const Icon = SHIFT_ICON[shift];
                      return (
                        <div key={shift} className="space-y-1.5">
                          <p className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Icon className="h-3 w-3" />{SHIFT_META[shift].label}</p>
                          {list.map((s) => {
                            const cancelled = !!s.cancelled_at || !s.is_active;
                            const left = slotsLeft(s);
                            const full = left === 0;
                            const past = new Date(s.scheduled_at).getTime() < Date.now();
                            const who = sessionInstructor(s);
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setActive(s)}
                                aria-label={`${s.name} at ${istTimeKey(s.scheduled_at)}${cancelled ? ', cancelled' : full ? ', full' : `, ${left} spots left`}`}
                                className={cn(
                                  'group w-full cursor-pointer rounded-xl border-l-4 bg-card p-2.5 text-left shadow-sm transition-all duration-150 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary',
                                  cancelled ? 'border-l-destructive/60 opacity-60' : full ? 'border-l-destructive' : past ? 'border-l-muted-foreground/40' : 'border-l-primary',
                                )}
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <p className={cn('truncate text-sm font-semibold text-foreground', cancelled && 'line-through')}>{s.parent?.name ?? s.name}</p>
                                  {s.is_overridden && !cancelled && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Hand-edited" />}
                                </div>
                                <p className="text-xs text-muted-foreground">{istTimeKey(s.scheduled_at)} · {s.duration_minutes} min</p>
                                <p className="truncate text-xs text-muted-foreground">{who.name}{who.isGuest ? ' (guest)' : ''}</p>
                                <div className="mt-1.5 flex items-center justify-between">
                                  {cancelled ? (
                                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">Cancelled</span>
                                  ) : full ? (
                                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">Class full</span>
                                  ) : (
                                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">{left} left</span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">{s.booked_count}/{s.capacity}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SessionOverrideDrawer
        open={!!active}
        onOpenChange={(open) => { if (!open) setActive(null); }}
        session={active}
        branchId={branchId}
        onOpenRoster={onOpenRoster}
      />
    </div>
  );
}
