import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CalendarClock, CircleAlert, Crown, Clock, RefreshCw, Wallet, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { UpgradeTimelineRow, type UpgradeTimelineOffer } from '@/components/analytics/UpgradeTimelineRow';

interface UpgradeSummary {
  stats: { in_window: number; closing_soon: number; converted_month: number; conversion_revenue_month: number };
  offers: UpgradeTimelineOffer[]; total: number; server_now: string;
}
export function UpgradeWindowWidget({ branchId, showRevenue }: { branchId: string | null; showRevenue: boolean }) {
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(new Date());
  useEffect(() => { setPage(0); }, [branchId]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['upgrade-analytics-summary', branchId, page], enabled: !!branchId,
    staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: async (): Promise<UpgradeSummary> => {
      if (!branchId) throw new Error('Select a branch');
      const { data, error } = await supabase.rpc('upgrade_analytics_summary', { p_branch_id: branchId, p_page: page });
      if (error) throw error;
      return data as unknown as UpgradeSummary;
    },
  });
  const offers = data?.offers.filter(o => Date.parse(o.window_ends_at) > now.getTime()) ?? [];
  const expiredOnPage = (data?.offers.length ?? 0) - offers.length;
  const tiles = [
    { label: 'In window', value: Math.max(0, (data?.stats.in_window ?? 0) - expiredOnPage), icon: CalendarClock, tone: 'text-info bg-info/10' },
    { label: 'Closing in 3 days', value: Math.max(0, (data?.stats.closing_soon ?? 0) - expiredOnPage), icon: Clock, tone: 'text-foreground bg-warning/15' },
    { label: 'Upgraded this month', value: data?.stats.converted_month ?? 0, icon: Crown, tone: 'text-success bg-success/10' },
    ...(showRevenue ? [{ label: 'Upgrade revenue · month', value: `₹${Number(data?.stats.conversion_revenue_month ?? 0).toLocaleString('en-IN')}`, icon: Wallet, tone: 'text-primary bg-primary/10' }] : []),
  ];
  return <section aria-labelledby="upgrade-window-title" className="space-y-4 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="upgrade-window-title" className="text-xl font-semibold text-foreground">Annual upgrades</h2><p className="mt-1 text-sm text-muted-foreground">15-day window · Monthly, quarterly & half-yearly members</p></div>
      <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching || !branchId} aria-label="Refresh annual upgrades" className="h-11 w-11"><RefreshCw className="h-4 w-4" /></Button>
    </div>
    {!branchId ? <Card className="rounded-2xl border-0"><CardContent className="flex items-center gap-3 p-6"><CalendarClock className="h-5 w-5 text-muted-foreground" /><p className="text-sm text-muted-foreground">Choose a branch to see its annual upgrade windows.</p></CardContent></Card> : isError ?
      <Card className="rounded-2xl border-0"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-6" role="alert"><p className="flex items-center gap-2 text-sm"><CircleAlert className="h-5 w-5 text-destructive" />Couldn't load annual upgrades.</p><Button variant="outline" onClick={() => refetch()} className="min-h-11">Retry</Button></CardContent></Card> : <>
      <div className="grid grid-cols-12 gap-4">{tiles.map(tile => <Card key={tile.label} className={`col-span-6 ${showRevenue ? 'lg:col-span-3' : 'lg:col-span-4'} min-w-0 rounded-2xl border-0 shadow-sm`}><CardContent className="p-5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{tile.label}</p><span className={`shrink-0 rounded-lg p-2 ${tile.tone}`}><tile.icon className="h-4 w-4" aria-hidden="true" /></span></div>{isLoading ? <Skeleton className="mt-3 h-8 w-20" /> : <p className="mt-2 break-words text-2xl font-semibold tabular-nums">{tile.value}</p>}</CardContent></Card>)}</div>
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-4"><CardTitle className="text-base font-semibold">Active upgrade windows</CardTitle><Badge variant="secondary" className="border-0">Deadline first</Badge></CardHeader>
        <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
          {isLoading ? <div className="space-y-5">{[0,1,2].map(i => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}</div> : !offers.length ? <div className="flex flex-col items-center gap-3 py-8 text-center"><CalendarClock className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{page ? 'No active windows on this page.' : 'No members are currently in an annual upgrade window.'}</p>{page > 0 && <Button variant="outline" onClick={() => setPage(0)}>First page</Button>}</div> : <ul className="divide-y divide-border" aria-label="Active annual upgrade timelines">{offers.map(offer => <UpgradeTimelineRow key={offer.id} offer={offer} now={now} showRevenue={showRevenue} />)}</ul>}
          {!isLoading && (data?.total ?? 0) > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-muted-foreground">Showing {offers.length} of {Math.max(0, (data?.total ?? 0) - expiredOnPage)} · Page {page + 1}</p><div className="flex gap-2"><Button variant="outline" size="icon" className="h-11 w-11" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous upgrade page"><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-11 w-11" disabled={(page + 1) * 10 >= (data?.total ?? 0)} onClick={() => setPage(p => p + 1)} aria-label="Next upgrade page"><ChevronRight className="h-4 w-4" /></Button></div></div>}
        </CardContent>
      </Card>
    </>}
  </section>;
}
