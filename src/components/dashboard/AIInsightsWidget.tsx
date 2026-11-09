import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp, Info, AlertCircle, Lightbulb, Target, Repeat, Dumbbell, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { isInsightStale } from '@/lib/dashboard/insightsFreshness';
import { track } from '@/lib/analytics';

interface Insight { icon?: string; title: string; description: string; severity: 'info' | 'warning' | 'success' | 'critical' }
interface Trainer { name: string; pt_revenue: number; active_clients: number; sessions_done: number }
interface Forecast {
  collected_mtd: number;
  renewal: { this_month_due: number; this_month_renewed: number; last_month_due: number; last_month_renewed: number; remaining_due: number };
  pt: { sold_mtd: number; value_mtd: number; sold_last: number; value_last: number; expiring_7d: number };
  trainers: Trainer[];
  projection: { renewal_ratio: number; daily_pace: number; expected_renewals: number; low: number; likely: number; high: number };
  ideas?: string[];
}
interface InsightRow { insights: Insight[]; forecast: Forecast | null; generated_at: string }

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-info/10 text-info border-info/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  success: 'bg-success/10 text-success border-success/25',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
};
const SEVERITY_ICONS: Record<string, typeof Info> = { info: Info, warning: AlertTriangle, success: TrendingUp, critical: AlertCircle };
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

export function AIInsightsWidget({ branchId }: { branchId?: string }) {
  const qc = useQueryClient();
  const key = ['ai-dashboard-insights', branchId ?? 'all'];
  const autoTried = useRef<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<InsightRow | null> => {
      let q = supabase.from('ai_dashboard_insights').select('insights, forecast, generated_at')
        .order('generated_at', { ascending: false }).limit(1);
      q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data?.[0] as unknown as InsightRow) ?? null;
    },
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const gen = useMutation({
    mutationFn: async (force: boolean) => {
      const { data, error } = await supabase.functions.invoke('ai-dashboard-insights', { body: { branch_id: branchId ?? null, force } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as InsightRow & { reused?: boolean };
    },
    onSuccess: (row, force) => {
      qc.setQueryData(key, row);
      qc.invalidateQueries({ queryKey: key });
      track('ai_insights_refreshed', { manual: force, reused: !!row.reused });
      if (force) toast.success(row.reused ? 'Insights are already up to date' : 'AI insights updated');
    },
    onError: (e: Error, force) => { if (force) toast.error(e.message || 'Could not update insights'); },
  });

  // Auto-refresh when the saved insight is missing or older than 6 hours (once per branch per mount).
  useEffect(() => {
    if (isLoading || isError || gen.isPending) return;
    const k = branchId ?? 'all';
    if (autoTried.current === k) return;
    if (isInsightStale(data?.generated_at)) { autoTried.current = k; gen.mutate(false); }
    else { autoTried.current = k; track('ai_insights_viewed', { has_forecast: !!data?.forecast }); }
  }, [isLoading, isError, data?.generated_at, branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const insights = data?.insights ?? [];
  const f = data?.forecast;
  const busy = gen.isPending;
  const updatedLabel = data?.generated_at ? `Updated ${formatDistanceToNow(new Date(data.generated_at), { addSuffix: true })}` : null;

  return (
    <Card className="shadow-lg rounded-2xl border-0 bg-gradient-to-br from-card to-card/95">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10"><Sparkles className="h-4 w-4 text-primary" aria-hidden /></div>
            AI Insights
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" aria-live="polite">{busy ? 'Updating…' : updatedLabel}</span>
            <Button size="sm" variant="outline" onClick={() => gen.mutate(true)} disabled={busy}
              className="rounded-xl gap-1.5 min-h-9" aria-label="Refresh AI insights">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5" aria-busy={busy || isLoading}>
        {isLoading || (busy && !data) ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
            Could not load saved insights.
            <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : insights.length === 0 ? (
          <div className="text-center py-6">
            <Sparkles className="mx-auto h-6 w-6 text-primary/50 mb-2" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {gen.isError ? `Insights could not be generated: ${(gen.error as Error).message}` : 'No insights yet. Press Refresh to build them.'}
            </p>
          </div>
        ) : (
          <>
            {f?.projection && (
              <section aria-labelledby="forecast-h" className="space-y-3">
                <h3 id="forecast-h" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5" aria-hidden /> Sales forecast · this month
                </h3>
                <div className="rounded-xl bg-primary/5 p-4">
                  <p className="text-xs text-muted-foreground">Projected sales (likely)</p>
                  <p className="text-3xl font-bold tabular-nums">{inr(f.projection.likely)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Range {inr(f.projection.low)} – {inr(f.projection.high)} · collected so far {inr(f.collected_mtd)} · {inr(f.projection.daily_pace)}/day
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Repeat className="h-3 w-3" aria-hidden />Renewal ratio</p>
                    <p className="text-xl font-bold tabular-nums">{Math.round(f.projection.renewal_ratio * 100)}%</p>
                    <p className="text-xs text-muted-foreground">
                      This month {f.renewal.this_month_renewed}/{f.renewal.this_month_due} ({pct(f.renewal.this_month_renewed, f.renewal.this_month_due)}) · last month {f.renewal.last_month_renewed}/{f.renewal.last_month_due} · {f.renewal.remaining_due} still due (≈{inr(f.projection.expected_renewals)})
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Dumbbell className="h-3 w-3" aria-hidden />PT packages</p>
                    <p className="text-xl font-bold tabular-nums">{f.pt.sold_mtd} sold · {inr(f.pt.value_mtd)}</p>
                    <p className="text-xs text-muted-foreground">Last month {f.pt.sold_last} · {inr(f.pt.value_last)} · {f.pt.expiring_7d} expiring in 7 days</p>
                  </div>
                </div>
                {f.trainers?.length > 0 && (
                  <div className="rounded-xl bg-muted/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-2"><Users className="h-3 w-3" aria-hidden />Trainer performance</p>
                    <ul className="space-y-1.5">
                      {f.trainers.map((t, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                          <span className="font-medium truncate">{t.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{inr(t.pt_revenue)} PT · {t.active_clients} clients · {t.sessions_done} sessions</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!f.ideas?.length && (
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-2"><Lightbulb className="h-3 w-3" aria-hidden />Suggested ideas</p>
                    <ul className="list-disc pl-5 space-y-1 text-sm">{f.ideas.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                )}
              </section>
            )}
            <section aria-label="Insights" className="space-y-2.5">
              {insights.map((insight, idx) => {
                const Icon = SEVERITY_ICONS[insight.severity] || Info;
                return (
                  <div key={idx} className={`flex items-start gap-3 p-3 rounded-xl border ${SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info}`}>
                    <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">{insight.title}</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{insight.severity}</Badge>
                      </div>
                      <p className="text-xs mt-0.5 opacity-90">{insight.description}</p>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
