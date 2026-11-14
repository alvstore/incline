import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import gsap from 'gsap';
import { Apple, Smartphone, Globe, MonitorSmartphone, RefreshCw, CircleAlert, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CountUp, usePageEntrance, prefersReducedMotion } from '@/components/motion/pageMotion';
import { cn } from '@/lib/utils';

type Summary = {
  online_now: number; dau: number; wau: number; mau: number; total_users: number;
  by_platform: Record<string, number>; by_person: Record<string, number>;
  active_members: number; members_with_app: number; trend: { day: string; users: number }[];
};

const PLATFORMS = [
  { key: 'ios', label: 'iPhone', Icon: Apple },
  { key: 'android', label: 'Android', Icon: Smartphone },
  { key: 'web_pwa', label: 'Installed web', Icon: MonitorSmartphone },
  { key: 'web_browser', label: 'Browser', Icon: Globe },
];
const PEOPLE = [['member', 'Members'], ['trainer', 'Trainers'], ['staff', 'Staff'], ['manager', 'Managers'], ['admin', 'Owners']] as const;

/** Compact App usage widget — fixed-height bento card matching Task Pulse. */
export function AppUsageCard({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const animated = useRef(false);
  usePageEntrance(ref);
  const qc = useQueryClient();
  const { selectedBranch } = useBranchContext();
  const branchId = selectedBranch && selectedBranch !== 'all' ? selectedBranch : null;
  const q = useQuery({
    queryKey: ['app-usage-summary', branchId],
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('app_usage_summary', { p_branch_id: branchId ?? undefined });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });
  useEffect(() => {
    const ch = supabase.channel(`app-usage-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_devices' }, () => qc.invalidateQueries({ queryKey: ['app-usage-summary'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const s = q.data;
  const hasData = !!s && s.total_users > 0;

  // Bars grow once on first data; live updates never replay the entrance.
  useEffect(() => {
    if (!hasData || animated.current || !barsRef.current) return;
    animated.current = true;
    if (prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-bar="trend"]', { scaleY: 0, transformOrigin: 'bottom', duration: 1, ease: 'expo.out', stagger: 0.02, delay: 0.15, clearProps: 'transform' });
      gsap.from('[data-bar="h"]', { scaleX: 0, transformOrigin: 'left', duration: 0.8, ease: 'expo.out', stagger: 0.06, delay: 0.3, clearProps: 'transform' });
    }, barsRef);
    return () => ctx.revert();
  }, [hasData]);

  const max = Math.max(1, ...(s?.trend ?? []).map((t) => t.users));
  const adoption = s && s.active_members > 0 ? Math.round((s.members_with_app / s.active_members) * 100) : 0;
  const platTotal = Math.max(1, PLATFORMS.reduce((a, p) => a + (s?.by_platform?.[p.key] ?? 0), 0));

  return (
    <Card ref={ref} data-anim="card" aria-labelledby="app-usage-title" className={cn('flex h-[410px] min-w-0 flex-col rounded-2xl border-none shadow-lg shadow-primary/5', className)}>
      <CardHeader className="flex shrink-0 flex-row items-start justify-between gap-2 space-y-0 p-5 pb-3">
        <div className="min-w-0">
          <CardTitle id="app-usage-title" className="flex items-center gap-2 text-base font-bold"><MonitorSmartphone className="h-5 w-5 shrink-0" aria-hidden="true" />App usage</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Phone app and web, updates live</p>
        </div>
        <div className="flex items-center gap-1">
          {s && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
              <CountUp value={s.online_now} /> online
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Refresh app usage" className="-mr-2 h-11 w-11">
            <RefreshCw className={cn('h-4 w-4', q.isFetching && 'motion-safe:animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-0">
        {q.isLoading && <Skeleton className="h-full w-full rounded-xl" />}
        {q.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" role="alert">
            <CircleAlert className="h-6 w-6 text-destructive" aria-hidden />
            <p className="text-sm text-muted-foreground">Couldn't load app usage.</p>
            <Button variant="outline" onClick={() => q.refetch()}>Retry</Button>
          </div>
        )}
        {s && !hasData && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Users className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No one has opened the app yet. Numbers appear as people use it.</p>
          </div>
        )}
        {hasData && s && (
          <div ref={barsRef} className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="grid grid-cols-3 gap-1">
              {[['Today', s.dau], ['7 days', s.wau], ['30 days', s.mau]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-secondary/60 px-2 py-1.5">
                  <p className="text-lg font-bold leading-tight tabular-nums"><CountUp value={v as number} /></p>
                  <p className="text-[11px] text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>Daily active · 30 days</span><span>peak {max}</span></div>
              <div className="flex h-10 items-end gap-[2px]" role="img" aria-label={`Daily active users over 30 days, peak ${max}`}>
                {s.trend.map((t, i) => (
                  <div key={t.day} data-bar="trend" title={`${t.day}: ${t.users}`}
                    className={cn('flex-1 rounded-sm', i === s.trend.length - 1 ? 'bg-primary' : 'bg-primary/30')}
                    style={{ height: `${Math.max(6, (t.users / max) * 100)}%` }} />
                ))}
              </div>
            </div>
            <div className="grid min-h-0 grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">By device</p>
                {PLATFORMS.map(({ key, label, Icon }) => {
                  const n = s.by_platform?.[key] ?? 0;
                  return (
                    <div key={key} className="text-xs">
                      <div className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /><span className="flex-1 truncate">{label}</span><span className="tabular-nums">{n}</span></div>
                      <div className="mt-0.5 h-1 rounded-full bg-muted"><div data-bar="h" className="h-1 rounded-full bg-primary" style={{ width: `${(n / platTotal) * 100}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold">Who</p>
                {PEOPLE.map(([k, l]) => (
                  <div key={k} className="flex justify-between text-xs"><span className="text-muted-foreground">{l}</span><span className="tabular-nums">{s.by_person?.[k] ?? 0}</span></div>
                ))}
              </div>
            </div>
            <div className="mt-auto">
              <div className="flex justify-between text-xs"><span>Active members on the app</span><span className="font-semibold">{adoption}%</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-muted"><div data-bar="h" className="h-1.5 rounded-full bg-success" style={{ width: `${adoption}%` }} /></div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.members_with_app} of {s.active_members} active members</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
