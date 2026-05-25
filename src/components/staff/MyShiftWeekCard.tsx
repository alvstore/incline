/**
 * MyShiftWeekCard — own roster strip with Late badge per day.
 * Used by TrainerDashboard and StaffDashboard.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar as CalendarIcon, Clock, AlertTriangle } from 'lucide-react';
import { useMyShiftWeek, fmtTime12, type MyShiftDay } from '@/hooks/useMyShiftWeek';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

function blockLabel(d: MyShiftDay) {
  if (d.is_off) return 'Weekly off';
  if (d.source === 'none') return 'Unscheduled';
  const parts: string[] = [];
  if (d.morning_start && d.morning_end) parts.push(`${fmtTime12(d.morning_start)} – ${fmtTime12(d.morning_end)}`);
  if (d.evening_start && d.evening_end) parts.push(`${fmtTime12(d.evening_start)} – ${fmtTime12(d.evening_end)}`);
  return parts.join(' · ') || '—';
}

export function MyShiftWeekCard({ userId }: { userId: string | null | undefined }) {
  const { data: week = [], isLoading } = useMyShiftWeek(userId);
  const todayISO = format(new Date(), 'yyyy-MM-dd');

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-indigo-600" />
          My shift this week
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {week.map((d) => {
              const isToday = d.date === todayISO;
              return (
                <div
                  key={d.date}
                  className={cn(
                    'rounded-xl border p-2.5 flex flex-col gap-1.5 transition-colors',
                    isToday ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-100 bg-white',
                    d.is_off && 'opacity-70',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      'text-[11px] font-semibold uppercase tracking-wider',
                      isToday ? 'text-indigo-700' : 'text-slate-500',
                    )}>
                      {d.label}
                    </span>
                    {isToday && (
                      <Badge variant="outline" className="rounded-full px-1.5 py-0 text-[9px] border-indigo-300 text-indigo-700">
                        Today
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] font-medium text-slate-700 leading-tight min-h-[28px]">
                    {blockLabel(d)}
                  </div>
                  {d.source === 'override' && !d.is_off && (
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                      One-off
                    </span>
                  )}
                  {d.is_late && d.first_check_in && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                            <Clock className="h-2.5 w-2.5" /> Late
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Checked in at {format(new Date(d.first_check_in), 'h:mm a')}
                          {d.late_minutes != null && d.late_minutes > 0 && ` (${d.late_minutes} min late)`}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {!d.is_late && d.first_check_in && !d.is_off && (
                    <span className="text-[10px] text-emerald-700">
                      In {format(new Date(d.first_check_in), 'h:mm a')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[10px] text-slate-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Late = check-in more than 10 min after scheduled start.
        </p>
      </CardContent>
    </Card>
  );
}
