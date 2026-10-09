import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { ArrowUpRight, CircleDollarSign, Clock3, Gift, RefreshCw, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';

export interface ReferralWorkspaceSummary {
  total: number;
  converted: number;
  awaiting_conversion: number;
  conversion_rate: number;
  awaiting_approval: number;
  available_to_claim: number;
  credited_count: number;
  credited_value: number;
  weekly: Array<{ week_start: string; referred: number; converted: number }>;
  funnel: Array<{ stage: string; value: number }>;
}

const chartConfig = {
  referred: { label: 'Referred', color: 'hsl(var(--primary))' },
  converted: { label: 'Converted', color: 'hsl(var(--success))' },
} satisfies ChartConfig;

function Metric({ label, value, note, icon: Icon, tone = 'primary' }: { label: string; value: string | number; note: string; icon: typeof Users; tone?: 'primary' | 'success' | 'warning' | 'accent' }) {
  const tones = { primary: 'bg-primary/10 text-primary', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', accent: 'bg-accent/10 text-accent' };
  return (
    <Card className="col-span-6 overflow-hidden rounded-2xl border-0 shadow-lg shadow-primary/5 transition-transform duration-200 motion-reduce:transition-none hover:-translate-y-0.5 lg:col-span-3">
      <CardContent className="flex min-h-32 items-start justify-between p-5">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      </CardContent>
    </Card>
  );
}

export function ReferralOverview({ summary, isLoading, isError, onRetry }: { summary?: ReferralWorkspaceSummary; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  if (isLoading) return <div className="grid grid-cols-12 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className={`col-span-6 h-32 rounded-2xl ${i > 3 ? 'lg:col-span-6 lg:h-80' : 'lg:col-span-3'}`} />)}</div>;
  if (isError || !summary) return <Card className="rounded-2xl border-0 shadow-lg shadow-primary/5"><CardContent className="flex min-h-44 flex-col items-center justify-center gap-3 p-6 text-center"><RefreshCw className="h-8 w-8 text-muted-foreground" /><div><p className="font-semibold">Could not load referral insights</p><p className="text-sm text-muted-foreground">Your referral records are unchanged.</p></div><Button variant="outline" onClick={onRetry}>Try again</Button></CardContent></Card>;

  const chartRows = summary.weekly.map((row) => ({ ...row, label: format(new Date(row.week_start), 'dd MMM') }));
  const funnelMax = Math.max(...summary.funnel.map((row) => row.value), 1);
  return (
    <div className="grid grid-cols-12 gap-4">
      <Metric label="Total referrals" value={summary.total} note="Across the selected branch view" icon={Users} />
      <Metric label="Conversion rate" value={`${summary.conversion_rate}%`} note={`${summary.converted} successfully converted`} icon={ArrowUpRight} tone="success" />
      <Metric label="Awaiting conversion" value={summary.awaiting_conversion} note="Need membership verification" icon={Clock3} tone="warning" />
      <Metric label="Reward queue" value={summary.awaiting_approval} note={`${summary.available_to_claim} ready to claim`} icon={Gift} tone="accent" />

      <Card className="col-span-12 rounded-2xl border-0 shadow-lg shadow-primary/5 lg:col-span-7">
        <CardHeader className="pb-2"><CardTitle className="text-base">12-week conversion trend</CardTitle><p className="text-xs text-muted-foreground">New referrals compared with completed conversions</p></CardHeader>
        <CardContent>
          <span className="sr-only">There are {summary.total} referrals and {summary.converted} conversions in the selected view.</span>
          <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto">
            <AreaChart data={chartRows} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="referred" type="monotone" stroke="var(--color-referred)" fill="var(--color-referred)" fillOpacity={0.12} strokeWidth={2} />
              <Area dataKey="converted" type="monotone" stroke="var(--color-converted)" fill="var(--color-converted)" fillOpacity={0.08} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="col-span-12 rounded-2xl border-0 shadow-lg shadow-primary/5 lg:col-span-5">
        <CardHeader className="pb-2"><CardTitle className="text-base">Referral journey</CardTitle><p className="text-xs text-muted-foreground">Where referrals are in the reward lifecycle</p></CardHeader>
        <CardContent className="space-y-4 pt-3">
          {summary.funnel.map((row, index) => <div key={row.stage} className="space-y-1.5"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{row.stage}</span><span className="font-semibold tabular-nums">{row.value}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.max(row.value ? 8 : 0, (row.value / funnelMax) * 100)}%`, opacity: 1 - index * 0.12 }} /></div></div>)}
          <div className="flex items-center justify-between rounded-xl bg-success/10 p-3"><span className="flex items-center gap-2 text-sm font-medium text-success"><CircleDollarSign className="h-4 w-4" />Wallet credited</span><span className="font-bold text-success">₹{Number(summary.credited_value || 0).toLocaleString()}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}
