import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { ArrowUpRight, Clock, PauseCircle, Wallet, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

type Tone = 'primary' | 'accent' | 'success' | 'info';
const toneCls: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
};

export function KpiCard({ label, value, hint, icon: Icon, tone = 'primary', to, footer }: {
  label: string; value: ReactNode; hint?: string; icon: ComponentType<{ className?: string }>;
  tone?: Tone; to?: string; footer?: ReactNode;
}) {
  const body = (
    <div className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-5 transition-colors duration-150 hover:bg-secondary">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={cn('rounded-xl p-2', toneCls[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div>
        <div className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</div>
        {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {footer}
    </div>
  );
  return to ? (
    <Link to={to} aria-label={`${label}: open details`} className="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>
  ) : body;
}

export interface EarningsKpiData {
  payable: number; onHold: number; upcoming: number; paid: number;
  trend: { month: string; paid: number; pending: number }[];
}

/** Net commission this month (after the trainer's GST cut), from instalments only. */
export function TrainerEarningsKpi({ data, isLoading, isError, onRetry }: {
  data?: EarningsKpiData; isLoading: boolean; isError: boolean; onRetry: () => void;
}) {
  if (isLoading) return <Skeleton className="h-full min-h-[220px] w-full rounded-2xl" />;
  if (isError || !data) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-5 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">Couldn't load your earnings.</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  const series = data.trend.map((t) => ({ m: format(new Date(t.month), 'MMM'), v: Number(t.paid) + Number(t.pending) }));
  const thisMonth = data.payable + data.paid;
  return (
    <Link to="/trainer-earnings" aria-label="Open my earnings" className="group block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors duration-150 hover:bg-secondary">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My earnings · {format(new Date(), 'MMMM')}</span>
            <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-foreground">{inr(thisMonth)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Net commission after your 5% GST</p>
          </div>
          <span className="rounded-xl bg-accent/10 p-2 text-accent"><Wallet className="h-5 w-5" /></span>
        </div>
        <div className="mt-3 h-16" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <Area type="monotone" dataKey="v" stroke="hsl(var(--accent))" strokeWidth={2} fill="hsl(var(--accent) / 0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <span className="sr-only">Last 6 months: {series.map((s) => `${s.m} ${inr(s.v)}`).join(', ')}</span>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-2">
            <PauseCircle className="h-3.5 w-3.5 text-warning" />
            <span className="text-muted-foreground">On hold</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{inr(data.onHold)}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-2">
            <Clock className="h-3.5 w-3.5 text-info" />
            <span className="text-muted-foreground">Upcoming</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{inr(data.upcoming)}</span>
          </div>
        </div>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
          View breakdown <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
