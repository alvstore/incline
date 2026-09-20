import { ArrowRight, AlertTriangle, Sparkles, ListChecks, Loader2, Ban, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  stats?: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled?: number;
    overdue: number;
    highPriority: number;
  };
  myOpenCount: number;
  onOpenMine: () => void;
  onFilter: (key: 'overdue' | 'high' | 'all') => void;
}

function ring(value: number) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const off = c - (c * value) / 100;
  return { c, off, r };
}

export function TaskStatsBento({ stats, myOpenCount, onOpenMine, onFilter }: Props) {
  const total = stats?.total || 0;
  const completed = stats?.completed || 0;
  const cancelled = stats?.cancelled || 0;
  const overdue = stats?.overdue || 0;
  const inProgress = stats?.inProgress || 0;
  const pending = stats?.pending || 0;
  const highPriority = stats?.highPriority || 0;

  // Completion rate is measured against work that was actually delivered —
  // cancelled tasks are excluded from the denominator so the ring and the
  // legend below it always add up to the same number of tasks.
  const closable = total - cancelled;
  const rate = closable > 0 ? Math.round((completed / closable) * 100) : 0;
  const { c, off, r } = ring(rate);

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
      {/* Hero: Today's focus */}
      <div className="col-span-2 lg:col-span-3 row-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/90 p-6 text-primary-foreground shadow-lg shadow-primary/20">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="absolute right-8 bottom-4 h-24 w-24 rounded-full bg-primary-foreground/10 blur-2xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/20 backdrop-blur px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider">
            <Sparkles className="h-3 w-3" /> Today's focus
          </div>
          <div className="mt-4 flex items-end gap-3">
            <div className="text-5xl font-bold tabular-nums leading-none">{myOpenCount}</div>
            <div className="pb-1 text-sm text-primary-foreground/90">
              {myOpenCount === 1 ? 'task on your plate' : 'tasks on your plate'}
            </div>
          </div>
          <p className="mt-1 text-xs text-primary-foreground/80">
            {overdue > 0 ? `${overdue} overdue across the team — let's clear them.` : 'No overdue items. Stay sharp.'}
          </p>
          <button
            onClick={onOpenMine}
            disabled={myOpenCount === 0}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 text-xs font-semibold text-primary shadow-lg transition-all duration-200 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary-foreground/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {myOpenCount === 0 ? 'Nothing assigned to you' : 'Open my queue'}
            {myOpenCount > 0 && <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Overdue */}
      <button
        onClick={() => onFilter('overdue')}
        aria-label={`Show ${overdue} overdue tasks`}
        className="text-left rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-primary/10 transition-all duration-200 ring-1 ring-border group focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Overdue</span>
          <span className="rounded-full bg-destructive/10 text-destructive p-1.5 group-hover:bg-destructive/20 transition-colors">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className={cn('mt-2 text-3xl font-bold tabular-nums', overdue > 0 ? 'text-destructive' : 'text-foreground')}>
          {overdue}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">Needs attention</div>
      </button>

      {/* High priority */}
      <button
        onClick={() => onFilter('high')}
        aria-label={`Show ${highPriority} high priority tasks`}
        className="text-left rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-primary/10 transition-all duration-200 ring-1 ring-border group focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">High priority</span>
          <span className="rounded-full bg-warning/10 text-warning p-1.5 group-hover:bg-warning/20 transition-colors">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2 text-3xl font-bold text-foreground tabular-nums">{highPriority}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">Still open &amp; urgent</div>
      </button>

      {/* Completion rate ring */}
      <div className="col-span-2 lg:col-span-3 rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 ring-1 ring-border flex items-center gap-4">
        <div className="relative h-20 w-20 flex-shrink-0">
          <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden="true">
            <circle cx="40" cy="40" r={r} stroke="currentColor" className="text-muted" strokeWidth="8" fill="none" />
            <circle
              cx="40"
              cy="40"
              r={r}
              stroke="url(#g1)"
              strokeWidth="8"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={off}
              className="transition-all duration-500"
            />
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="hsl(var(--success))" />
                <stop offset="100%" stopColor="hsl(var(--primary))" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-foreground tabular-nums">{rate}%</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Completion rate</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {completed} of {closable} active tasks done
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="inline-flex items-center gap-1 text-warning">
              <CircleDot className="h-3 w-3" /> {pending} pending
            </span>
            <span className="inline-flex items-center gap-1 text-info">
              <Loader2 className="h-3 w-3" /> {inProgress} in progress
            </span>
            <span className="inline-flex items-center gap-1 text-success">
              <ListChecks className="h-3 w-3" /> {completed} done
            </span>
            {cancelled > 0 && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Ban className="h-3 w-3" /> {cancelled} cancelled
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
