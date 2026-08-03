import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, Layers, Moon, Timer } from 'lucide-react';
import { estimatedMinutes, totalSets, type WorkoutDay } from './planNormalize';

interface DaySessionCardProps {
  day: WorkoutDay;
  doneKeys: Set<string>;
  onToggleExercise: (exerciseIndex: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** One focused training day: hero band, exercise rows with tick-off, progress. */
export function DaySessionCard({
  day,
  doneKeys,
  onToggleExercise,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: DaySessionCardProps) {
  const doneCount = day.exercises.filter((_, i) => doneKeys.has(`${day.id}:${i}`)).length;
  const pct = day.exercises.length ? Math.round((doneCount / day.exercises.length) * 100) : 0;

  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
      {/* Hero band */}
      <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-primary/5 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-lg font-bold">{day.dayLabel}</h3>
              {day.weekLabel && <Badge variant="secondary" className="text-[11px]">{day.weekLabel}</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {day.isRest ? 'Recovery day — mobility, walking and sleep' : day.focus || 'Training session'}
            </p>
          </div>
          {!day.isRest && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Stat icon={<Layers className="h-3.5 w-3.5" />} label={`${day.exercises.length} exercises`} />
              <Stat icon={<Timer className="h-3.5 w-3.5" />} label={`${totalSets(day)} sets`} />
              <Stat icon={<Clock className="h-3.5 w-3.5" />} label={`~${estimatedMinutes(day)} min`} />
            </div>
          )}
        </div>

        {!day.isRest && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Session progress</span>
              <span className="font-semibold text-foreground">{doneCount}/{day.exercises.length}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        )}
      </div>

      <CardContent className="space-y-2.5 p-4 sm:p-5">
        {day.isRest ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Moon className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No training scheduled. Focus on recovery and hydration.</p>
          </div>
        ) : (
          day.exercises.map((exercise, i) => {
            const key = `${day.id}:${i}`;
            const done = doneKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleExercise(i)}
                aria-pressed={done}
                aria-label={`Mark ${exercise.name} as ${done ? 'not done' : 'done'}`}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-all duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                  done
                    ? 'border-success/30 bg-success/5'
                    : 'border-border/60 bg-muted/40 hover:border-primary/40 hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    done ? 'bg-success/15 text-success' : 'bg-background text-muted-foreground',
                  )}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-semibold', done && 'line-through opacity-70')}>
                    {exercise.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{exercise.sets} sets × {exercise.reps || '—'}</span>
                    {exercise.rest && <span>Rest {exercise.rest}</span>}
                  </span>
                  {exercise.notes && (
                    <span className="mt-1 block text-xs italic text-muted-foreground">{exercise.notes}</span>
                  )}
                </span>
                <Circle className={cn('mt-1 h-4 w-4 shrink-0', done ? 'hidden' : 'text-muted-foreground/40')} />
              </button>
            );
          })
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 font-medium text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}
