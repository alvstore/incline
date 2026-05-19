import { ArrowRight, AlertTriangle, Sparkles, ListChecks, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  stats?: { total: number; pending: number; inProgress: number; completed: number; overdue: number; highPriority: number };
  myOpenCount: number;
  onOpenMine: () => void;
  onFilter: (key: 'overdue' | 'high' | 'all') => void;
}

function ring(value: number) {
  // 0..100 -> stroke-dashoffset
  const r = 30;
  const c = 2 * Math.PI * r;
  const off = c - (c * value) / 100;
  return { c, off, r };
}

export function TaskStatsBento({ stats, myOpenCount, onOpenMine, onFilter }: Props) {
  const total = stats?.total || 0;
  const completed = stats?.completed || 0;
  const overdue = stats?.overdue || 0;
  const inProgress = stats?.inProgress || 0;
  const pending = stats?.pending || 0;
  const highPriority = stats?.highPriority || 0;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const { c, off, r } = ring(rate);

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
      {/* Hero: Today's focus */}
      <div className="col-span-2 lg:col-span-3 row-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-indigo-700 p-6 text-white shadow-xl shadow-indigo-500/30">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute right-8 bottom-4 h-24 w-24 rounded-full bg-violet-400/20 blur-2xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider">
            <Sparkles className="h-3 w-3" /> Today's focus
          </div>
          <div className="mt-4 flex items-end gap-3">
            <div className="text-5xl font-bold tabular-nums leading-none">{myOpenCount}</div>
            <div className="pb-1 text-sm text-indigo-100">tasks on your plate</div>
          </div>
          <p className="mt-1 text-xs text-indigo-100/80">
            {overdue > 0 ? `${overdue} overdue across the team — let's clear them.` : 'No overdue items. Stay sharp.'}
          </p>
          <button
            onClick={onOpenMine}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-indigo-700 shadow-lg shadow-indigo-900/20 hover:bg-indigo-50 transition-colors"
          >
            Open my queue <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Overdue */}
      <button
        onClick={() => onFilter('overdue')}
        className="text-left rounded-2xl bg-white p-4 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-red-500/10 transition-all duration-200 ring-1 ring-slate-100 group"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Overdue</span>
          <span className="rounded-full bg-red-50 text-red-600 p-1.5 group-hover:bg-red-100 transition-colors">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className={cn('mt-2 text-3xl font-bold tabular-nums', overdue > 0 ? 'text-red-600' : 'text-slate-900')}>
          {overdue}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">Needs attention</div>
      </button>

      {/* High priority */}
      <button
        onClick={() => onFilter('high')}
        className="text-left rounded-2xl bg-white p-4 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-orange-500/10 transition-all duration-200 ring-1 ring-slate-100 group"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">High priority</span>
          <span className="rounded-full bg-orange-50 text-orange-600 p-1.5 group-hover:bg-orange-100 transition-colors">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{highPriority}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">High & urgent</div>
      </button>

      {/* Completion rate ring */}
      <div className="col-span-2 lg:col-span-3 rounded-2xl bg-white p-4 shadow-lg shadow-slate-200/50 ring-1 ring-slate-100 flex items-center gap-4">
        <div className="relative h-20 w-20 flex-shrink-0">
          <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
            <circle cx="40" cy="40" r={r} stroke="currentColor" className="text-slate-100" strokeWidth="8" fill="none" />
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
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-slate-900 tabular-nums">{rate}%</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Completion rate</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {completed} of {total} tasks done
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-amber-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {pending} pending</span>
            <span className="inline-flex items-center gap-1 text-blue-600"><Loader2 className="h-3 w-3" /> {inProgress} in progress</span>
            <span className="inline-flex items-center gap-1 text-emerald-600"><ListChecks className="h-3 w-3" /> {completed} done</span>
          </div>
        </div>
      </div>
    </div>
  );
}
