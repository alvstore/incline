/**
 * MyShiftWeekCard — own roster strip, redesigned.
 * Shows weekly duty load, per-day morning/evening rails, check-in state
 * and Late badges. Used by TrainerDashboard, StaffDashboard, Preferences.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar as CalendarIcon, Clock, Sun, Moon, CheckCircle2 } from 'lucide-react';
import { useMyShiftWeek, fmtTime12, type MyShiftDay } from '@/hooks/useMyShiftWeek';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

function toMin(t?: string | null) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function dayHours(d: MyShiftDay) {
  if (d.is_off) return 0;
  let total = 0;
  const pairs: [string | null | undefined, string | null | undefined][] = [
    [d.morning_start, d.morning_end],
    [d.evening_start, d.evening_end],
  ];
  for (const [s, e] of pairs) {
    const a = toMin(s), b = toMin(e);
    if (a == null || b == null) continue;
    total += (b >= a ? b - a : 24 * 60 - a + b);
  }
  return total / 60;
}

function Rail({
  icon: Icon, start, end, tone,
}: { icon: any; start?: string | null; end?: string | null; tone: 'am' | 'pm' }) {
  if (!start || !end) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px] font-medium leading-none',
        tone === 'am' ? 'bg-amber-500/10 text-amber-600' : 'bg-indigo-500/10 text-indigo-600',
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate tabular-nums">{fmtTime12(start)}–{fmtTime12(end)}</span>
    </div>
  );
}

export function MyShiftWeekCard({ userId }: { userId: string | null | undefined }) {
  const { data: week = [], isLoading } = useMyShiftWeek(userId);
  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const totalHours = week.reduce((s, d) => s + dayHours(d), 0);
  const offDays = week.filter((d) => d.is_off).length;
  const lateDays = week.filter((d) => d.is_late).length;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
              <CalendarIcon className="h-4 w-4" />
            </span>
            My shift this week
          </CardTitle>
          <p className="mt-1 pl-11 text-xs text-muted-foreground">
            Late = check-in more than 10 min after start.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Badge className="rounded-full border-0 bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
            {totalHours ? `${totalHours.toFixed(totalHours % 1 ? 1 : 0)}h rostered` : 'No hours'}
          </Badge>
          {offDays > 0 && (
            <Badge className="rounded-full border-0 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              {offDays} off
            </Badge>
          )}
          {lateDays > 0 && (
            <Badge className="rounded-full border-0 bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">
              {lateDays} late
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
            {week.map((d) => {
              const isToday = d.date === todayISO;
              const unscheduled = !d.is_off && d.source === 'none';
              return (
                <div
                  key={d.date}
                  className={cn(
                    'flex min-h-[7rem] flex-col gap-1.5 rounded-xl p-2.5 transition-all duration-200',
                    isToday
                      ? 'bg-gradient-to-b from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20'
                      : 'bg-muted/40 hover:bg-muted/70',
                    d.is_off && !isToday && 'opacity-60',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-[11px] font-semibold uppercase tracking-wider',
                        isToday ? 'text-white/80' : 'text-muted-foreground',
                      )}
                    >
                      {d.label}
                    </span>
                    {isToday && (
                      <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase">
                        Today
                      </span>
                    )}
                  </div>

                  {d.is_off ? (
                    <span
                      className={cn(
                        'mt-1 w-fit rounded-lg px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
                        isToday ? 'bg-white/15 text-white' : 'bg-slate-200/70 text-slate-600',
                      )}
                    >
                      Weekly off
                    </span>
                  ) : unscheduled ? (
                    <span className={cn('mt-1 text-[10px]', isToday ? 'text-white/70' : 'text-muted-foreground')}>
                      Unscheduled
                    </span>
                  ) : (
                    <div className={cn('space-y-1', isToday && '[&_*]:!text-white [&>div]:!bg-white/15')}>
                      <Rail icon={Sun} start={d.morning_start} end={d.morning_end} tone="am" />
                      <Rail icon={Moon} start={d.evening_start} end={d.evening_end} tone="pm" />
                    </div>
                  )}

                  <div className="mt-auto space-y-1 pt-1">
                    {d.source === 'override' && !d.is_off && (
                      <span
                        className={cn(
                          'inline-flex w-fit rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                          isToday ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700',
                        )}
                      >
                        One-off
                      </span>
                    )}
                    {d.is_late && d.first_check_in ? (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                'inline-flex w-fit cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                isToday ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700',
                              )}
                            >
                              <Clock className="h-2.5 w-2.5" /> Late
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Checked in at {format(new Date(d.first_check_in), 'h:mm a')}
                            {d.late_minutes != null && d.late_minutes > 0 && ` (${d.late_minutes} min late)`}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : d.first_check_in && !d.is_off ? (
                      <span
                        className={cn(
                          'inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          isToday ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700',
                        )}
                      >
                        <CheckCircle2 className="h-2.5 w-2.5" /> {format(new Date(d.first_check_in), 'h:mm a')}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
