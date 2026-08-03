import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PlanDayRailItem {
  id: string;
  label: string;
  sublabel?: string;
  caption: string;
  icon: ReactNode;
  /** Renders muted (rest day / empty day). */
  muted?: boolean;
}

interface PlanDayRailProps {
  items: PlanDayRailItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Horizontally scrollable day selector shared by workout + diet viewers. */
export function PlanDayRail({ items, activeId, onSelect }: PlanDayRailProps) {
  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-min gap-2 px-1">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
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
                <span
                  className={cn(
                    active
                      ? 'text-primary-foreground/80'
                      : item.muted
                        ? 'text-muted-foreground'
                        : 'text-accent',
                  )}
                >
                  {item.icon}
                </span>
                <span className="truncate text-sm font-semibold">{item.label}</span>
              </div>
              {item.sublabel && (
                <p
                  className={cn(
                    'mt-0.5 text-[11px]',
                    active ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {item.sublabel}
                </p>
              )}
              <p
                className={cn(
                  'mt-1 truncate text-xs',
                  active ? 'text-primary-foreground/85' : 'text-muted-foreground',
                )}
              >
                {item.caption}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
