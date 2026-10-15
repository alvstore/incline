import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarClock, CircleAlert, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpgradeSummary } from '@/components/analytics/useUpgradeSummary';
import { UpgradeDetailsPanel } from '@/components/analytics/UpgradeDetailsPanel';
import { selectUpgradePreview } from '@/lib/upgradePreview';
import { upgradeTimeLeft } from '../../../supabase/functions/_shared/upgradeWindow';
import { cn } from '@/lib/utils';

const joinedDate = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function UpgradeWindowWidget({ branchId, showRevenue }: { branchId: string | null; showRevenue: boolean }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const viewAllRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const { data, isLoading, isError, isFetching } = useUpgradeSummary(branchId, 0);
  const preview = selectUpgradePreview(data?.offers ?? [], now);
  const expired = data?.offers.filter(o => Date.parse(o.window_ends_at) <= now.getTime()).length ?? 0;
  const total = Math.max(0, (data?.total ?? 0) - expired);
  const metrics = [
    { label: 'Eligible', value: Math.max(0, (data?.stats.in_window ?? 0) - expired), tone: 'text-foreground' },
    { label: 'Closing soon', value: Math.max(0, (data?.stats.closing_soon ?? 0) - expired), tone: 'text-warning' },
    { label: 'Upgraded · month', value: data?.stats.converted_month ?? 0, tone: 'text-success' },
  ];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['upgrade-analytics-summary', branchId] });
  return <>
    <Card className="flex h-[410px] min-w-0 flex-col rounded-2xl border-none shadow-lg shadow-primary/5" aria-labelledby="upgrade-window-title" data-testid="annual-upgrade-widget">
      <CardHeader className="flex shrink-0 flex-row items-start justify-between gap-2 p-5 pb-3">
        <div className="min-w-0"><CardTitle id="upgrade-window-title" className="flex items-center gap-2 text-base font-bold"><CalendarClock className="h-5 w-5 shrink-0 text-primary" />Annual upgrades</CardTitle><p className="mt-1 text-xs text-muted-foreground">15-day window</p></div>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching || !branchId} aria-label="Refresh annual upgrades" className="-mr-2 -mt-1 h-11 w-11 shrink-0"><RefreshCw className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Refresh annual upgrades</TooltipContent></Tooltip>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-0">
        {!branchId ? <div className="flex flex-1 items-center justify-center text-center"><p className="text-sm text-muted-foreground">Choose a branch to see annual upgrades.</p></div> : isError ? <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" role="alert"><CircleAlert className="h-6 w-6 text-destructive" /><p className="text-sm text-muted-foreground">Couldn't load annual upgrades.</p><Button variant="outline" onClick={refresh}>Retry</Button></div> : <>
          <div className="grid grid-cols-3 gap-2 pb-2">{metrics.map(metric => <div key={metric.label} className="min-w-0">{isLoading ? <Skeleton className="h-7 w-10" /> : <p className={cn('text-2xl font-semibold tabular-nums', metric.tone)}>{metric.value}</p>}<p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{metric.label}</p></div>)}</div>
          {showRevenue && <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">Upgrade revenue · month</span>{isLoading ? <Skeleton className="h-4 w-14" /> : <span className="font-semibold tabular-nums">₹{Number(data?.stats.conversion_revenue_month ?? 0).toLocaleString('en-IN')}</span>}</div>}
          <div className="mt-3 min-h-0 flex-1 border-t border-border pt-2">
            {isLoading ? <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div> : !preview.length ? <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">No active upgrade windows.</div> : <ul aria-label="Nearest annual upgrade deadlines" className="space-y-1">{preview.map(offer => {
              const left = upgradeTimeLeft(offer.window_ends_at, now);
              const urgent = left.days <= 3;
              return <li key={offer.id} data-testid="upgrade-preview-row" className="py-1">
                <div className="flex items-center justify-between gap-2"><Button variant="link" className="h-6 min-w-0 justify-start truncate p-0 text-xs font-semibold text-foreground" title={offer.member_name} onClick={() => navigate(`/members?member=${offer.member_id}`)}><span className="truncate">{offer.member_name}</span></Button><span className={cn('shrink-0 text-xs font-semibold tabular-nums', urgent ? 'text-warning' : 'text-info')}>{left.milliseconds < 86_400_000 ? `${left.hours}h left` : `${left.days}d left`}</span></div>
                <p className="mb-1 text-[11px] leading-4 text-muted-foreground">Joined {joinedDate(offer.joined_at)}</p>
                <progress className={cn('block h-1 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full', urgent ? '[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning' : '[&::-webkit-progress-value]:bg-info [&::-moz-progress-bar]:bg-info')} value={left.percent} max={100} aria-label={`${offer.member_name}: time remaining to upgrade`} />
              </li>;
            })}</ul>}
          </div>
        </>}
        <Button ref={viewAllRef} variant="ghost" className="mt-2 h-11 w-full shrink-0 justify-between px-0 text-primary hover:bg-secondary" disabled={!branchId || isLoading || isError} onClick={() => setOpen(true)}>View all{data ? ` (${total})` : ''}<ArrowRight className="h-4 w-4" /></Button>
      </CardContent>
    </Card>
    <UpgradeDetailsPanel open={open} onOpenChange={setOpen} branchId={branchId} now={now} showRevenue={showRevenue} returnFocus={() => viewAllRef.current?.focus()} />
  </>;
}
