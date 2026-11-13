import { cn } from '@/lib/utils';

export type QuickFilter = 'all' | 'mine' | 'today' | 'overdue' | 'high' | 'unassigned';

const FILTERS: { id: QuickFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'high', label: 'High priority' },
  { id: 'unassigned', label: 'Unassigned' },
];

interface Props {
  value: QuickFilter;
  onChange: (v: QuickFilter) => void;
  counts?: Partial<Record<QuickFilter, number>>;
}

export function TaskFilterPills({ value, onChange, counts }: Props) {
  return (
    <div className="-mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Quick filters">
      {FILTERS.map((f) => {
        const active = value === f.id;
        const count = counts?.[f.id];
        return (
          <button aria-pressed={active} type="button"
            key={f.id}
            onClick={() => onChange(f.id)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-all duration-150',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            {typeof count === 'number' && count > 0 && (
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                  active ? 'bg-primary-foreground/20' : 'bg-background',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
