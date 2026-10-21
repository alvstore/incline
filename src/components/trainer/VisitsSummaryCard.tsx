import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { addDaysKey, istDateKey } from '@/lib/classes/schedule';
import { cn } from '@/lib/utils';

interface VisitRow { member_id: string; visit_date: string }
const RANGES = [30, 15, 7] as const;

/** Gate visits of my clients per day (one per member per day — bounce scans don't inflate). */
export function VisitsSummaryCard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const q = useQuery({
    queryKey: ['trainer-client-visits-raw', 30],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trainer_client_visits', { p_days: 30 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });
  const { series, total, active } = useMemo(() => {
    const today = istDateKey(new Date());
    const keys = Array.from({ length: range }, (_, i) => addDaysKey(today, i - range + 1));
    const set = new Set(keys);
    const counts = new Map<string, number>();
    const members = new Set<string>();
    for (const r of q.data ?? []) {
      if (!set.has(r.visit_date)) continue;
      counts.set(r.visit_date, (counts.get(r.visit_date) ?? 0) + 1);
      members.add(r.member_id);
    }
    const s = keys.map((k) => ({ d: k.slice(8), v: counts.get(k) ?? 0 }));
    return { series: s, total: s.reduce((a, b) => a + b.v, 0), active: members.size };
  }, [q.data, range]);

  return (
    <Card className="rounded-2xl border border-border">
      <CardHeader className="pb-2"><CardTitle className="text-base font-semibold tracking-tight">Client visits</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : q.isError ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Couldn't load visits.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-[11px] text-muted-foreground">Total visits</p><p className="text-2xl font-bold tabular-nums">{total}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Clients who came</p><p className="text-2xl font-bold tabular-nums">{active}</p></div>
            </div>
            <div className="mt-3 h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" hide />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v, 'Visits']} labelFormatter={(l) => `Day ${l}`} />
                  <Bar dataKey="v" fill="hsl(var(--info))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex gap-1" role="tablist" aria-label="Range">
              {RANGES.map((r) => (
                <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}
                  className={cn('min-h-[32px] cursor-pointer rounded-lg px-2.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    range === r ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary')}>
                  {r} days
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
