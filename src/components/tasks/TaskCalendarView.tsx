import { useMemo, useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PRIORITY_DOT } from './taskTokens';

interface Props {
  tasks: any[];
  onOpen: (task: any) => void;
}

export function TaskCalendarView({ tasks, onOpen }: Props) {
  const [cursor, setCursor] = useState(new Date());

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    const arr: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) arr.push(d);
    return arr;
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const key = format(new Date(t.due_date), 'yyyy-MM-dd');
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  return (
    <div className="rounded-2xl bg-card p-4 sm:p-6 shadow-lg shadow-md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold text-foreground">{format(cursor, 'MMMM yyyy')}</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setCursor(subMonths(cursor, 1))} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
          <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px text-xs font-semibold text-muted-foreground mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-2 py-1 text-center uppercase tracking-wider">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const list = byDay.get(key) || [];
          const inMonth = isSameMonth(d, cursor);
          const today = isSameDay(d, new Date());
          return (
            <div
              key={key}
              className={cn(
                'relative min-h-[88px] rounded-lg p-1.5 ring-1 ring-border',
                inMonth ? 'bg-muted/30' : 'bg-card opacity-50',
                today && 'ring-2 ring-ring bg-primary/10/50',
              )}
            >
              <div className={cn('text-[11px] font-bold mb-1', today ? 'text-primary' : 'text-muted-foreground')}>
                {format(d, 'd')}
              </div>
              <div className="space-y-1">
                {list.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onOpen(t)}
                    className="w-full flex items-center gap-1 rounded bg-card px-1.5 py-1 text-left text-[10px] font-medium text-foreground ring-1 ring-border hover:ring-primary/40 hover:bg-primary/10 transition-colors"
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', PRIORITY_DOT[t.priority])} />
                    <span className="truncate">{t.title}</span>
                  </button>
                ))}
                {list.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">+{list.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
