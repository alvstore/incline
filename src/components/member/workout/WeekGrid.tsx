import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, Layers, Moon, Target } from 'lucide-react';
import { estimatedMinutes, totalSets, type WorkoutDay } from './planNormalize';

interface WeekGridProps {
  days: WorkoutDay[];
  onOpenDay: (id: string) => void;
}

/** Week-at-a-glance grid. Clicking a card drops into the focused day view. */
export function WeekGrid({ days, onOpenDay }: WeekGridProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {days.map((day) => (
        <Card
          key={day.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDay(day.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenDay(day.id);
            }
          }}
          className={cn(
            'cursor-pointer rounded-2xl border-border/60 shadow-sm transition-all duration-200',
            'hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary',
            day.isRest && 'bg-muted/30',
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  day.isRest ? 'bg-muted text-muted-foreground' : 'bg-accent/10 text-accent',
                )}
              >
                {day.isRest ? <Moon className="h-4 w-4" /> : <Target className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{day.dayLabel}</span>
              {day.weekLabel && <Badge variant="secondary" className="text-[11px]">{day.weekLabel}</Badge>}
            </CardTitle>
            <p className="pl-10 text-xs text-muted-foreground">
              {day.isRest ? 'Rest & recover' : day.focus || 'Training session'}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {day.isRest ? (
              <p className="text-sm text-muted-foreground">No exercises scheduled.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" /> {day.exercises.length} exercises · {totalSets(day)} sets
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> ~{estimatedMinutes(day)} min
                  </span>
                </div>
                <ul className="space-y-1 pt-1">
                  {day.exercises.slice(0, 4).map((ex, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">{ex.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ex.sets}×{ex.reps || '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                {day.exercises.length > 4 && (
                  <p className="text-xs font-medium text-accent">+{day.exercises.length - 4} more</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
