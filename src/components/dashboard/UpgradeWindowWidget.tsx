import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CalendarClock, CircleAlert, Crown, Send, Sparkles, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

export interface UpgradeOfferRow {
  id: string;
  status: 'pending' | 'day7_sent' | 'day12_sent' | 'converted';
  window_ends_at: string;
  upgrade_cost: number | null;
  annual_price: number | null;
  already_paid: number | null;
  converted_at: string | null;
  member_id: string;
  member_name: string;
  plan_name: string | null;
}

interface UpgradeSummary {
  stats: { in_window: number; sent_7d: number; converted_month: number; conversion_revenue_month: number };
  offers: UpgradeOfferRow[];
}

const inr = (n: number | null | undefined) => `₹${Math.round(Number(n ?? 0)).toLocaleString('en-IN')}`;

/** Day N of the 15-day window, derived from the window end (Day 1 = purchase day). */
export function upgradeWindowDay(windowEndsAt: string, now = new Date()): number {
  const msLeft = new Date(windowEndsAt).getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  return Math.min(15, Math.max(1, 15 - daysLeft + 1));
}

const STATUS: Record<UpgradeOfferRow['status'], { label: string; cls: string }> = {
  pending: { label: 'In window', cls: 'bg-muted text-muted-foreground border border-border' },
  day7_sent: { label: 'Past Day 7', cls: 'bg-blue-500/10 text-blue-500 border border-blue-500/20' },
  day12_sent: { label: 'Closing soon', cls: 'bg-amber-500/10 text-amber-500 border border-amber-500/20' },
  converted: { label: 'Upgraded', cls: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' },
};

export function UpgradeWindowWidget({ branchId, showRevenue }: { branchId: string | null; showRevenue: boolean }) {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['upgrade-window-summary', branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: async (): Promise<UpgradeSummary> => {
      const { data, error } = await supabase.rpc('upgrade_window_summary', { p_branch_id: branchId as string });
      if (error) throw error;
      return data as unknown as UpgradeSummary;
    },
  });

  const tiles = [
    { label: 'In window now', value: data?.stats.in_window ?? 0, icon: CalendarClock },
    { label: 'Offers sent (7d)', value: data?.stats.sent_7d ?? 0, icon: Send },
    { label: 'Upgraded this month', value: data?.stats.converted_month ?? 0, icon: Crown },
    ...(showRevenue
      ? [{ label: 'Upgrade revenue', value: inr(data?.stats.conversion_revenue_month), icon: Wallet }]
      : []),
  ];

  return (
    <Card className="rounded-2xl border border-border" aria-labelledby="upgrade-window-title">
      <CardHeader className="pb-3">
        <CardTitle id="upgrade-window-title" className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
          15-day Annual upgrade window
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Members on 1, 3 or 6-month plans can switch to Annual with everything paid adjusted. Mention it when they walk in.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!branchId ? (
          <p className="text-sm text-muted-foreground">Choose a branch to see its upgrade window.</p>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-destructive/10 p-4 text-sm text-destructive" role="alert">
            <span className="flex items-center gap-2"><CircleAlert className="h-4 w-4" aria-hidden="true" />Couldn't load upgrade offers.</span>
            <button type="button" onClick={() => refetch()} className="min-h-11 px-3 font-medium underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">Retry</button>
          </div>
        ) : (
          <>
            <div className={cn('grid grid-cols-2 gap-4', showRevenue ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
              {tiles.map((t) => (
                <div key={t.label} className="rounded-xl bg-muted/50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</span>
                    <t.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                  {isLoading ? <Skeleton className="mt-2 h-8 w-16" /> : (
                    <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{t.value}</p>
                  )}
                </div>
              ))}
            </div>

            {isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
            ) : !data?.offers.length ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
                <CalendarClock className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">No one is in their upgrade window right now. New 1, 3 and 6-month members appear here automatically.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Members in upgrade window">
                {data.offers.slice(0, 8).map((o) => {
                  const day = upgradeWindowDay(o.window_ends_at);
                  const st = STATUS[o.status];
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/members?member=${o.member_id}`)}
                        className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-secondary transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${o.member_name}, ${o.status === 'converted' ? 'upgraded' : `day ${day} of 15`}, upgrade cost ${inr(o.upgrade_cost)}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{o.member_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {o.plan_name ?? 'Membership'} · {o.status === 'converted' ? 'Upgraded' : `Day ${day} of 15`}
                          </p>
                        </div>
                        {showRevenue && (
                          <span className="hidden sm:block text-sm font-semibold tabular-nums text-foreground">{inr(o.upgrade_cost)}</span>
                        )}
                        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', st.cls)}>{st.label}</span>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
