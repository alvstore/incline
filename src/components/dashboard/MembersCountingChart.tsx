import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { format, startOfDay, startOfMonth, startOfYear, subDays, subMonths, subYears, addDays, addMonths, addYears } from 'date-fns';

type Period = 'weekly' | 'monthly' | 'yearly';

interface Props {
  branchFilter: string | null;
}

interface Bucket {
  name: string;
  fullLabel: string;
  members: number;
  start: Date;
}

function buildBuckets(period: Period): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];
  if (period === 'weekly') {
    for (let i = 6; i >= 0; i--) {
      const d = startOfDay(subDays(now, i));
      buckets.push({ name: format(d, 'EEE'), fullLabel: format(d, 'EEE, MMM d'), members: 0, start: d });
    }
  } else if (period === 'monthly') {
    for (let i = 6; i >= 0; i--) {
      const d = startOfMonth(subMonths(now, i));
      buckets.push({ name: format(d, 'MMM'), fullLabel: format(d, 'MMMM yyyy'), members: 0, start: d });
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const d = startOfYear(subYears(now, i));
      buckets.push({ name: format(d, 'yyyy'), fullLabel: format(d, 'yyyy'), members: 0, start: d });
    }
  }
  return buckets;
}

function nextStart(period: Period, d: Date) {
  if (period === 'weekly') return addDays(d, 1);
  if (period === 'monthly') return addMonths(d, 1);
  return addYears(d, 1);
}

export default function MembersCountingChart({ branchFilter }: Props) {
  const [period, setPeriod] = useState<Period>('monthly');
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const buckets = useMemo(() => buildBuckets(period), [period]);

  const { data, isLoading } = useQuery({
    queryKey: ['members-counting', branchFilter, period],
    queryFn: async () => {
      const first = buckets[0].start.toISOString();
      let q = supabase.from('members').select('created_at').gte('created_at', first);
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data: rows } = await q;

      const filled = buckets.map((b, i) => {
        const end = nextStart(period, b.start);
        const count = (rows || []).filter((r: any) => {
          const c = new Date(r.created_at);
          return c >= b.start && c < end;
        }).length;
        return { ...b, members: count, idx: i };
      });
      return filled;
    },
  });

  const chartData = data ?? buckets.map((b, i) => ({ ...b, idx: i }));
  const maxIdx = chartData.reduce((acc, b, i) => (b.members > chartData[acc].members ? i : acc), 0);
  const highlightIdx = activeIdx ?? maxIdx;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-primary/5">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Members Counting</CardTitle>
        <div className="inline-flex bg-muted rounded-full p-1" role="group" aria-label="Select time period">
          {(['weekly', 'monthly', 'yearly'] as Period[]).map((p) => (
            <button aria-pressed={period === p}
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                'rounded-full text-xs font-semibold uppercase px-3 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                period === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                onMouseMove={(e: any) => {
                  if (typeof e?.activeTooltipIndex === 'number') setActiveIdx(e.activeTooltipIndex);
                }}
                onMouseLeave={() => setActiveIdx(null)}
                margin={{ top: 20, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="4 4" vertical={false} className="stroke-border" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-xs fill-muted-foreground" />
                <YAxis tickLine={false} axisLine={false} className="text-xs fill-muted-foreground" />
                <Tooltip cursor={{ fill: 'transparent' }} content={<DarkTooltip />} />
                <Bar dataKey="members" radius={[12, 12, 12, 12]} barSize={32}>
                  {chartData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={i === highlightIdx ? 'hsl(var(--primary))' : 'hsl(var(--muted))'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DarkTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Bucket;
  return (
    <div className="rounded-xl bg-foreground text-background px-4 py-2.5 shadow-xl text-xs">
      <div className="font-semibold">{p.fullLabel}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
        <span>{p.members.toLocaleString()} members</span>
      </div>
    </div>
  );
}
