import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { UtensilsCrossed } from 'lucide-react';
import { PlanSegmentedTabs } from '@/components/member/plan/PlanSegmentedTabs';
import { PlanDayRail } from '@/components/member/plan/PlanDayRail';
import { DietDayCard } from './DietDayCard';
import { DietWeekGrid } from './DietWeekGrid';
import { normalizeDietPlan } from '@/lib/planNormalizer';

type ViewMode = 'today' | 'day' | 'week';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const weekdayIndexOf = (label: string): number | null => {
  const lower = (label || '').toLowerCase();
  const idx = WEEKDAYS.findIndex((d) => lower.includes(d) || lower.includes(d.slice(0, 3)));
  return idx >= 0 ? idx : null;
};

/**
 * Member-facing diet viewer: Today / Day / Full week — the exact same
 * navigation model as the workout plan viewer.
 */
export function DietPlanViewer({ planData }: { planData: unknown }) {
  const days = useMemo(() => normalizeDietPlan(planData as any).days ?? [], [planData]);

  const todayIdx = useMemo(() => {
    const now = new Date().getDay();
    const found = days.findIndex((d) => weekdayIndexOf(d.day) === now);
    return found >= 0 ? found : null;
  }, [days]);

  const [mode, setMode] = useState<ViewMode>('today');
  const [activeIndex, setActiveIndex] = useState(todayIdx ?? 0);

  if (!days.length) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="py-12 text-center">
          <UtensilsCrossed className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">Meal details are being prepared by your trainer.</p>
        </CardContent>
      </Card>
    );
  }

  const safeIndex = Math.min(Math.max(0, activeIndex), days.length - 1);
  const shownIndex = mode === 'today' ? (todayIdx ?? safeIndex) : safeIndex;
  const shownDay = days[shownIndex];

  return (
    <div className="space-y-4">
      <PlanSegmentedTabs
        ariaLabel="Diet plan view"
        value={mode}
        onChange={setMode}
        tabs={[
          { key: 'today', label: 'Today' },
          { key: 'day', label: 'Day view' },
          { key: 'week', label: 'Full week' },
        ]}
      />

      {mode === 'week' ? (
        <DietWeekGrid
          days={days}
          onOpenDay={(index) => {
            setActiveIndex(index);
            setMode('day');
          }}
        />
      ) : (
        <div className="space-y-4">
          {mode === 'today' && todayIdx === null && days.length > 1 && (
            <p className="text-sm text-muted-foreground">
              No day is mapped to today — showing the first day of your plan.
            </p>
          )}
          {mode === 'day' && days.length > 1 && (
            <PlanDayRail
              activeId={String(shownIndex)}
              onSelect={(id) => setActiveIndex(Number(id))}
              items={days.map((day, index) => ({
                id: String(index),
                label: day.day,
                caption: day.slots.length
                  ? `${day.slots.length} meals · ${Math.round(day.totals.calories)} kcal`
                  : 'No meals',
                muted: day.slots.length === 0,
                icon: <UtensilsCrossed className="h-3.5 w-3.5" />,
              }))}
            />
          )}
          <DietDayCard
            day={shownDay}
            hasPrev={mode === 'day' && shownIndex > 0}
            hasNext={mode === 'day' && shownIndex < days.length - 1}
            onPrev={() => setActiveIndex(Math.max(0, shownIndex - 1))}
            onNext={() => setActiveIndex(Math.min(days.length - 1, shownIndex + 1))}
          />
        </div>
      )}
    </div>
  );
}
