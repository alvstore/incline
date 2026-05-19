import { Plus, Search, LayoutGrid, List, CalendarDays, Command } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type TaskView = 'board' | 'list' | 'calendar';

interface Props {
  view: TaskView;
  onViewChange: (v: TaskView) => void;
  search: string;
  onSearchChange: (s: string) => void;
  subtitle: string;
  onNew: () => void;
}

const VIEWS: { id: TaskView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'list', label: 'List', icon: List },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

export function TasksHeader({ view, onViewChange, search, onSearchChange, subtitle, onNew }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Operations · Tasks
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Mission Control
          </h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            onClick={onNew}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:from-violet-700 hover:to-indigo-700 rounded-xl"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New Task
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks…"
            className="pl-9 pr-16 h-10 rounded-xl border-slate-200 bg-white shadow-sm focus-visible:ring-indigo-500"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </div>

        <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = view === v.id;
            return (
              <button
                key={v.id}
                onClick={() => onViewChange(v.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-indigo-500',
                  active
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'text-slate-600 hover:text-indigo-700 hover:bg-slate-50',
                )}
                aria-pressed={active}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
