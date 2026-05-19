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
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS.map((f) => {
        const active = value === f.id;
        const count = counts?.[f.id];
        return (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
              active
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-300 hover:text-indigo-700',
            )}
          >
            {f.label}
            {typeof count === 'number' && count > 0 && (
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600',
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
