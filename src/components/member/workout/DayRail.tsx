import { cn } from '@/lib/utils';
import { Dumbbell, Moon } from 'lucide-react';
import type { WorkoutDay } from './planNormalize';

interface DayRailProps {
  days: WorkoutDay[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Horizontally scrollable day selector. Rest days render muted so members
 * immediately see where the recovery days sit in the week.
 */
export function DayRail({ days, activeId, onSelect }: DayRailProps) {
  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-min gap-2 px-1">
        {days.map((day) => {
          const active = day.id === activeId;
          return (
            <button
              key={day.id}
              type="button"
              onClick={() => onSelect(day.id)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'group min-w-[132px] shrink-0 cursor-pointer rounded-2xl border p-3 text-left transition-all duration-200',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                active
                  ? 'border-transparent bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/20'
                  : 'border-border/60 bg-card hover:border-primary/40 hover:shadow-md',
              )}
            >
              <div className="flex items-center gap-1.5">
                {day.isRest ? (
                  <Moon className={cn('h-3.5 w-3.5', active ? 'text-primary-foreground/80' : 'text-muted-foreground')} />
                ) : (
                  <Dumbbell className={cn('h-3.5 w-3.5', active ? 'text-primary-foreground/80' : 'text-accent')} />
                )}
                <span className="truncate text-sm font-semibold">{day.dayLabel}</span>
              </div>
              {day.weekLabel && (
                <p className={cn('mt-0.5 text-[11px]', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  {day.weekLabel}
                </p>
              )}
              <p className={cn('mt-1 truncate text-xs', active ? 'text-primary-foreground/85' : 'text-muted-foreground')}>
                {day.isRest ? 'Rest & recover' : day.focus || `${day.exercises.length} exercises`}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
