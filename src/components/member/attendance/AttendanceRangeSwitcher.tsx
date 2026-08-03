import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RANGE_TABS, type AttendanceRange } from './attendanceRange';

interface AttendanceRangeSwitcherProps {
  range: AttendanceRange;
  onRangeChange: (range: AttendanceRange) => void;
  periodLabel: string;
  onStep: (direction: -1 | 1) => void;
  canStepForward: boolean;
}

/** Month / Quarter / Year / All-time switcher with period stepping. */
export function AttendanceRangeSwitcher({
  range, onRangeChange, periodLabel, onStep, canStepForward,
}: AttendanceRangeSwitcherProps) {
  const stepDisabled = range === 'all';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div
        role="tablist"
        aria-label="Attendance period range"
        className="inline-flex w-full gap-1 rounded-2xl border border-border/60 bg-card/95 p-1 shadow-sm sm:w-auto"
      >
        {RANGE_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={range === tab.key}
            onClick={() => onRangeChange(tab.key)}
            className={cn(
              'flex-1 cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 sm:flex-none',
              'focus:outline-none focus:ring-2 focus:ring-primary',
              range === tab.key
                ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="rounded-xl"
          aria-label="Previous period"
          disabled={stepDisabled}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[130px] text-center text-sm font-semibold text-foreground">{periodLabel}</span>
        <Button
          variant="outline"
          size="icon"
          className="rounded-xl"
          aria-label="Next period"
          disabled={stepDisabled || !canStepForward}
          onClick={() => onStep(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
