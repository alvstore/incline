import { useMemo } from 'react';
import { eachDayOfInterval, format, isSameDay, startOfWeek, addDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttendanceHeatmapProps {
  start: Date;
  end: Date;
  visits: Map<string, number>;
  /** 'grid' = month day grid, 'compact' = week-column heatmap for longer ranges. */
  mode: 'grid' | 'compact';
  title: string;
}

function intensityClass(count: number, isFuture: boolean) {
  if (isFuture) return 'bg-muted/30';
  if (count <= 0) return 'bg-muted';
  if (count === 1) return 'bg-emerald-300 text-emerald-950';
  if (count === 2) return 'bg-emerald-500 text-white';
  return 'bg-emerald-700 text-white';
}

/** Visit heatmap — day grid for a month, week columns for quarter/year/all-time. */
export function AttendanceHeatmap({ start, end, visits, mode, title }: AttendanceHeatmapProps) {
  const today = new Date();

  const days = useMemo(
    () => (mode === 'grid' ? eachDayOfInterval({ start, end }) : []),
    [mode, start, end],
  );

  const weeks = useMemo(() => {
    if (mode === 'grid') return [];
    const cols: Date[][] = [];
    let cursor = startOfWeek(start, { weekStartsOn: 0 });
    while (cursor <= end) {
      const base = cursor;
      cols.push(Array.from({ length: 7 }, (_, i) => addDays(base, i)));
      cursor = addDays(cursor, 7);
    }
    return cols;
  }, [mode, start, end]);

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={100}>
          {mode === 'grid' ? (
            <div className="grid grid-cols-7 gap-1.5 text-center sm:gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {d}
                </div>
              ))}
              {Array.from({ length: start.getDay() }).map((_, i) => <div key={`pad-${i}`} />)}
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const count = visits.get(key) || 0;
                const isFuture = day > today;
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          'flex aspect-square cursor-default items-center justify-center rounded-xl text-sm font-medium transition-colors duration-150',
                          intensityClass(count, isFuture),
                          isSameDay(day, today) && 'ring-2 ring-primary ring-offset-1',
                        )}
                      >
                        {format(day, 'd')}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {format(day, 'EEE, d MMM yyyy')} — {count === 0 ? 'no visit' : `${count} visit${count > 1 ? 's' : ''}`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-1">
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-1">
                    {week.map((day) => {
                      const key = format(day, 'yyyy-MM-dd');
                      const inRange = day >= start && day <= end;
                      const count = inRange ? visits.get(key) || 0 : 0;
                      const isFuture = day > today;
                      return (
                        <Tooltip key={key}>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'h-3.5 w-3.5 rounded-[4px] transition-colors duration-150',
                                inRange ? intensityClass(count, isFuture) : 'bg-transparent',
                                isSameDay(day, today) && 'ring-1 ring-primary',
                              )}
                            />
                          </TooltipTrigger>
                          {inRange && (
                            <TooltipContent>
                              {format(day, 'EEE, d MMM yyyy')} — {count === 0 ? 'no visit' : `${count} visit${count > 1 ? 's' : ''}`}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TooltipProvider>

        <div className="mt-4 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Less</span>
          <span className="h-3 w-3 rounded-[4px] bg-muted" />
          <span className="h-3 w-3 rounded-[4px] bg-emerald-300" />
          <span className="h-3 w-3 rounded-[4px] bg-emerald-500" />
          <span className="h-3 w-3 rounded-[4px] bg-emerald-700" />
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}
