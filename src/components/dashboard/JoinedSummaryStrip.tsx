import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, TrendingUp, TrendingDown, Minus, Users } from 'lucide-react';
import { startOfDay, startOfYear, subDays, format, eachDayOfInterval } from 'date-fns';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { cn } from '@/lib/utils';

interface Props {
  branchFilter: string | null;
}

type PeriodKey = 'today' | 'week' | 'month' | 'ytd';

const PERIODS: { key: PeriodKey; label: string; days: number | 'ytd' }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: '7D', days: 7 },
  { key: 'month', label: '30D', days: 30 },
  { key: 'ytd', label: 'YTD', days: 'ytd' },
];

async function fetchSignupDates(branchFilter: string | null) {
  const yearStart = startOfYear(new Date()).toISOString();
  let q = supabase
    .from('members')
    .select('created_at')
    .gte('created_at', yearStart)
    .order('created_at', { ascending: true })
    .limit(10000);
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => new Date(r.created_at as string));
}

function countInWindow(dates: Date[], start: Date, end: Date) {
  return dates.filter((d) => d >= start && d < end).length;
}

export function JoinedSummaryStrip({ branchFilter }: Props) {
  const [period, setPeriod] = useState<PeriodKey>('month');

  const { data: dates, isLoading } = useQuery({
    queryKey: ['growth-pulse', branchFilter],
    queryFn: () => fetchSignupDates(branchFilter),
  });

  const stats = useMemo(() => {
    if (!dates) return null;
    const now = new Date();
    const startToday = startOfDay(now);
    const tomorrow = new Date(startToday.getTime() + 24 * 3600 * 1000);

    const periodWindow = (key: PeriodKey): { start: Date; end: Date; prevStart: Date; prevEnd: Date; days: number } => {
      if (key === 'today') {
        return {
          start: startToday,
          end: tomorrow,
          prevStart: subDays(startToday, 1),
          prevEnd: startToday,
          days: 1,
        };
      }
      if (key === 'ytd') {
        const start = startOfYear(now);
        const days = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (24 * 3600 * 1000)));
        return {
          start,
          end: tomorrow,
          prevStart: subDays(start, days),
          prevEnd: start,
          days,
        };
      }
      const d = key === 'week' ? 7 : 30;
      const start = subDays(startToday, d - 1);
      return {
        start,
        end: tomorrow,
        prevStart: subDays(start, d),
        prevEnd: start,
        days: d,
      };
    };

    const totals: Record<PeriodKey, number> = {
      today: countInWindow(dates, startToday, tomorrow),
      week: 0,
      month: 0,
      ytd: 0,
    };
    (['week', 'month', 'ytd'] as PeriodKey[]).forEach((k) => {
      const w = periodWindow(k);
      totals[k] = countInWindow(dates, w.start, w.end);
    });

    const cur = periodWindow(period);
    const current = totals[period];
    const previous = countInWindow(dates, cur.prevStart, cur.prevEnd);
    const delta =
      previous === 0
        ? current === 0
          ? 0
          : 100
        : Math.round(((current - previous) / previous) * 100);

    // Sparkline: daily buckets across current window (cap at 60 points)
    const sparkDays = Math.min(cur.days, 60);
    const sparkStart = subDays(startToday, sparkDays - 1);
    const buckets = eachDayOfInterval({ start: sparkStart, end: startToday }).map((day) => {
      const next = new Date(day.getTime() + 24 * 3600 * 1000);
      return {
        date: format(day, 'MMM d'),
        value: countInWindow(dates, day, next),
      };
    });

    return { totals, current, previous, delta, spark: buckets };
  }, [dates, period]);

  if (isLoading || !stats) {
    return <Skeleton className="h-[180px] w-full rounded-2xl" />;
  }

  const deltaPositive = stats.delta > 0;
  const deltaNegative = stats.delta < 0;
  const DeltaIcon = deltaPositive ? TrendingUp : deltaNegative ? TrendingDown : Minus;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 shadow-lg p-4 sm:p-5">
      {/* Decorative halo */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-indigo-500/20 via-violet-500/15 to-fuchsia-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">New Members</h3>
            <p className="text-[11px] text-muted-foreground">Growth pulse</p>
          </div>
        </div>

        <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/70 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all',
                period === p.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hero + sparkline */}
      <div className="relative mt-4 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 md:gap-6 items-end">
        <div className="flex items-end gap-3">
          <div className="text-4xl md:text-5xl font-bold tabular-nums leading-none text-foreground">
            {stats.current.toLocaleString()}
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold mb-1',
              deltaPositive && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
              deltaNegative && 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
              !deltaPositive && !deltaNegative && 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400',
            )}
            title={`Previous period: ${stats.previous}`}
          >
            <DeltaIcon className="h-3 w-3" />
            {stats.delta === 0 && stats.current === 0 ? '—' : `${deltaPositive ? '+' : ''}${stats.delta}%`}
          </div>
        </div>

        <div className="h-[72px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.spark} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="growthPulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <Tooltip
                cursor={{ stroke: 'hsl(var(--primary))', strokeOpacity: 0.2 }}
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                  padding: '6px 10px',
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                formatter={(v: number) => [`${v} new`, '']}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#growthPulseFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Summary row */}
      <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3">
        {PERIODS.map((p) => {
          const active = p.key === period;
          return (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'group inline-flex items-center gap-1.5 text-xs transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="font-medium uppercase tracking-wider text-[10px]">{p.label}</span>
              <span
                className={cn(
                  'tabular-nums font-bold',
                  active ? 'text-foreground' : 'text-foreground/80',
                )}
              >
                {stats.totals[p.key].toLocaleString()}
              </span>
            </button>
          );
        })}
        <div className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>vs previous {PERIODS.find((p) => p.key === period)?.label}</span>
        </div>
      </div>
    </div>
  );
}
