import { cn } from '@/lib/utils';

export interface DayRailItem {
  /** Day label, e.g. "Monday" */
  label: string;
  /** Secondary line, e.g. "6 exercises" or "1820 kcal · 103g P" */
  meta?: string;
  /** Muted styling for rest / empty days */
  muted?: boolean;
}

interface DayRailProps {
  days: DayRailItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  ariaLabel?: string;
  /** Optional actions rendered at the top of the rail (desktop) / right (mobile) */
  action?: React.ReactNode;
  /** Enables drag-and-drop; swaps the content of two days (labels stay fixed). */
  onMove?: (from: number, to: number) => void;
}

/**
 * Day selector for the plan builders.
 * Vertical list on desktop, horizontal scroll-snap rail on mobile.
 */
export function DayRail({ days, activeIndex, onSelect, ariaLabel = 'Select day', action, onMove }: DayRailProps) {

  return (
    <div className="space-y-2">
      {action && <div className="flex justify-end lg:justify-start">{action}</div>}
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          'flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none',
          'lg:flex-col lg:overflow-visible lg:pb-0',
        )}
      >
        {days.map((d, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={d.label + i}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(i)}
              draggable={!!onMove}
              onDragStart={
                onMove
                  ? (e) => {
                      e.dataTransfer.setData('text/plain', String(i));
                      e.dataTransfer.effectAllowed = 'move';
                    }
                  : undefined
              }
              onDragOver={onMove ? (e) => e.preventDefault() : undefined}
              onDrop={
                onMove
                  ? (e) => {
                      e.preventDefault();
                      const from = Number(e.dataTransfer.getData('text/plain'));
                      if (Number.isFinite(from) && from !== i) onMove(from, i);
                    }
                  : undefined
              }
              className={cn(
                'min-h-[44px] min-w-[116px] shrink-0 snap-start cursor-pointer rounded-xl border px-3 py-2 text-left',
                'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary',
                'lg:w-full lg:min-w-0',
                active
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border hover:bg-muted/60',
                !active && d.muted && 'opacity-60',
              )}
            >
              <p className={cn('text-sm font-semibold leading-tight', active && 'text-primary')}>
                {d.label}
              </p>
              {d.meta && <p className="text-[11px] text-muted-foreground mt-0.5">{d.meta}</p>}
            </button>
          );
        })}

      </div>
    </div>
  );
}
