import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Dumbbell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DayRail } from './DayRail';
import { DaySessionCard } from './DaySessionCard';
import { WeekGrid } from './WeekGrid';
import { normalizeWorkoutPlan, type WorkoutDay } from './planNormalize';

type ViewMode = 'today' | 'day' | 'week';

interface WorkoutPlanViewerProps {
  planId: string;
  planData: unknown;
}

const todayIndex = () => new Date().getDay();
const storageKey = (planId: string) =>
  `workout-done:${planId}:${new Date().toISOString().slice(0, 10)}`;

/**
 * Member-facing plan viewer: focused Today / Day view plus the full-week grid.
 * Tick-offs are local to the current date and never touch the stored plan.
 */
export function WorkoutPlanViewer({ planId, planData }: WorkoutPlanViewerProps) {
  const plan = useMemo(() => normalizeWorkoutPlan(planData), [planData]);
  const days: WorkoutDay[] = plan?.days ?? [];

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

  const tabs: { key: ViewMode; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'day', label: 'Day view' },
    { key: 'week', label: 'Full week' },
  ];

  return (
    <div className="space-y-4">
      {/* Segmented control */}
      <div className="sticky top-16 z-10 -mx-1 px-1 py-1">
        <div
          role="tablist"
          aria-label="Workout plan view"
          className="inline-flex w-full gap-1 rounded-2xl border border-border/60 bg-card/95 p-1 shadow-sm backdrop-blur sm:w-auto"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={mode === tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                'flex-1 cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 sm:flex-none',
                'focus:outline-none focus:ring-2 focus:ring-primary',
                mode === tab.key
                  ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

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
          {mode === 'day' && <DayRail days={days} activeId={shownDay.id} onSelect={setActiveId} />}
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
