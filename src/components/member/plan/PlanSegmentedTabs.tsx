import { cn } from '@/lib/utils';

interface PlanSegmentedTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: { key: T; label: string }[];
  ariaLabel: string;
}

/** Shared Today / Day / Week segmented control for the member plan viewers. */
export function PlanSegmentedTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
}: PlanSegmentedTabsProps<T>) {
  return (
    <div className="sticky top-16 z-10 -mx-1 px-1 py-1">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="inline-flex w-full gap-1 rounded-2xl border border-border/60 bg-card/95 p-1 shadow-sm backdrop-blur sm:w-auto"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={value === tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex-1 cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 sm:flex-none',
              'focus:outline-none focus:ring-2 focus:ring-primary',
              value === tab.key
                ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
