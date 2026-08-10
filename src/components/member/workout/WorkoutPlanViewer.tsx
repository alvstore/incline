import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dumbbell, Moon, Repeat, Shuffle } from 'lucide-react';
import { DaySessionCard } from './DaySessionCard';
import { WeekGrid } from './WeekGrid';
import { PlanSegmentedTabs } from '@/components/member/plan/PlanSegmentedTabs';
import { PlanDayRail } from '@/components/member/plan/PlanDayRail';
import { normalizeWorkoutPlan, type WorkoutDay } from './planNormalize';
import {
  daysUntilNextVariant,
  describeOffset,
  normalizeOffset,
  resolveRotatedPlan,
} from '@/lib/fitness/planRotation';

type ViewMode = 'today' | 'day' | 'week';

interface WorkoutPlanViewerProps {
  planId: string;
  planData: unknown;
  /** Member-specific weekday shift (0-6) so gym machines stay spread out. */
  offsetDays?: number;
  /** Exercise rotation interval in days (0 = off). */
  rotationIntervalDays?: number;
  /** Per-member rotation seed. */
  rotationSeed?: number;
  /** Plan start date (yyyy-MM-dd) — rotation anchor. */
  startDate?: string | null;
}

const todayIndex = () => new Date().getDay();
const storageKey = (planId: string) =>
  `workout-done:${planId}:${new Date().toISOString().slice(0, 10)}`;

/**
 * Member-facing plan viewer: focused Today / Day view plus the full-week grid.
 * Tick-offs are local to the current date and never touch the stored plan.
 */
export function WorkoutPlanViewer({
  planId,
  planData,
  offsetDays = 0,
  rotationIntervalDays = 0,
  rotationSeed = 0,
  startDate,
}: WorkoutPlanViewerProps) {
  const offset = normalizeOffset(offsetDays);

  const rotated = useMemo(
    () =>
      resolveRotatedPlan(planData, {
        intervalDays: rotationIntervalDays,
        seed: rotationSeed,
        startDate,
      }),
    [planData, rotationIntervalDays, rotationSeed, startDate],
  );

  const plan = useMemo(
    () => normalizeWorkoutPlan(rotated.data, { offsetDays: offset }),
    [rotated.data, offset],
  );
  const days: WorkoutDay[] = plan?.days ?? [];

  const nextSwitchIn = daysUntilNextVariant({
    intervalDays: rotationIntervalDays,
    startDate,
  });

  const defaultDayId = useMemo(() => {
    if (!days.length) return '';
    const match = days.find((d) => d.weekdayIndex === todayIndex());
    return (match ?? days[0]).id;
  }, [days]);

  const [mode, setMode] = useState<ViewMode>('today');
  const [activeId, setActiveId] = useState(defaultDayId);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  useEffect(() => setActiveId(defaultDayId), [defaultDayId]);


  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(planId));
      if (raw) setDoneKeys(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore corrupt local state */
    }
  }, [planId]);

  const toggleExercise = (dayId: string, index: number) => {
    setDoneKeys((prev) => {
      const next = new Set(prev);
      const key = `${dayId}:${index}`;
      next.has(key) ? next.delete(key) : next.add(key);
      try {
        localStorage.setItem(storageKey(planId), JSON.stringify([...next]));
      } catch {
        /* storage unavailable — ticks stay in-memory */
      }
      return next;
    });
  };

  if (!days.length) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="py-12 text-center">
          <Dumbbell className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">Your trainer is preparing the plan details.</p>
        </CardContent>
      </Card>
    );
  }

  const todaysDay = days.find((d) => d.weekdayIndex === todayIndex()) ?? null;
  const activeIndex = Math.max(0, days.findIndex((d) => d.id === activeId));
  const activeDay = days[activeIndex] ?? days[0];
  const shownDay = mode === 'today' ? (todaysDay ?? activeDay) : activeDay;

  return (
    <div className="space-y-4">
      {(offset > 0 || rotated.variantLabel) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          {offset > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Shuffle className="h-3 w-3" />
              Your schedule: {describeOffset(offset)}
            </Badge>
          )}
          {rotated.variantLabel && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Repeat className="h-3 w-3" />
              {rotated.variantLabel}
              {rotated.variantCount > 1 ? ` of ${rotated.variantCount}` : ''}
              {nextSwitchIn ? ` · switches in ${nextSwitchIn}d` : ''}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            Timed to keep the floor and machines free when you train.
          </span>
        </div>
      )}

      <PlanSegmentedTabs<ViewMode>
        ariaLabel="Workout plan view"
        value={mode}
        onChange={setMode}
        tabs={[
          { key: 'today', label: 'Today' },
          { key: 'day', label: 'Day view' },
          { key: 'week', label: 'Full week' },
        ]}
      />

      {mode === 'week' ? (
        <WeekGrid
          days={days}
          onOpenDay={(id) => {
            setActiveId(id);
            setMode('day');
          }}
        />
      ) : (
        <div className="space-y-4">
          {mode === 'today' && !todaysDay && (
            <p className="text-sm text-muted-foreground">
              No session is scheduled for today — showing the first session of your plan.
            </p>
          )}
          {mode === 'day' && (
            <PlanDayRail
              activeId={shownDay.id}
              onSelect={setActiveId}
              items={days.map((day) => ({
                id: day.id,
                label: day.dayLabel,
                sublabel: day.weekLabel,
                caption: day.isRest
                  ? 'Rest & recover'
                  : day.focus || `${day.exercises.length} exercises`,
                muted: day.isRest,
                icon: day.isRest ? <Moon className="h-3.5 w-3.5" /> : <Dumbbell className="h-3.5 w-3.5" />,
              }))}
            />
          )}
          <DaySessionCard
            day={shownDay}
            doneKeys={doneKeys}
            onToggleExercise={(i) => toggleExercise(shownDay.id, i)}
            hasPrev={mode === 'day' && activeIndex > 0}
            hasNext={mode === 'day' && activeIndex < days.length - 1}
            onPrev={() => setActiveId(days[Math.max(0, activeIndex - 1)].id)}
            onNext={() => setActiveId(days[Math.min(days.length - 1, activeIndex + 1)].id)}
          />
        </div>
      )}
    </div>
  );
}
