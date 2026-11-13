import { Plus, Search, LayoutGrid, List, CalendarDays, Command } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { SplitTitle } from '@/components/motion/pageMotion';

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
  const { roles } = useAuth();
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operations · Tasks
          </div>
          <SplitTitle text="Mission Control" className="mt-1 text-2xl sm:text-3xl font-bold text-foreground tracking-tight" />
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">{subtitle}<span className="hidden lg:inline"> · Shortcuts: J/K move, Enter open, D done, N new</span></p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {roles.some((r) => ['owner', 'admin', 'manager', 'staff'].includes(r.role)) && (
            <Button
              onClick={onNew}
              className="rounded-full shadow-md"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New Task
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks…"
            className="pl-9 pr-16 h-10 rounded-full border-border bg-card shadow-sm focus-visible:ring-ring"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </div>

        <div className="inline-flex rounded-full bg-muted p-1" role="group" aria-label="View">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = view === v.id;
            return (
              <button type="button"
                key={v.id}
                onClick={() => onViewChange(v.id)}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                  active
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
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
