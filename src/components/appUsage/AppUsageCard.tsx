import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Apple, Smartphone, Globe, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CountUp, usePageEntrance } from '@/components/motion/pageMotion';

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
const PEOPLE = [['member', 'Members'], ['trainer', 'Trainers'], ['staff', 'Staff'], ['manager', 'Managers'], ['admin', 'Owners/Admins']] as const;

export function AppUsageCard() {
  const ref = useRef<HTMLDivElement>(null);
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
  const max = Math.max(1, ...(s?.trend ?? []).map((t) => t.users));
  const adoption = s && s.active_members > 0 ? Math.round((s.members_with_app / s.active_members) * 100) : 0;
  const platTotal = Math.max(1, PLATFORMS.reduce((a, p) => a + (s?.by_platform?.[p.key] ?? 0), 0));

  return (
    <Card ref={ref} data-anim="card" className="rounded-2xl border-0 shadow-lg shadow-foreground/5">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-lg">App usage</CardTitle>
          <p className="text-sm text-muted-foreground">Phone app and web, updates live</p>
        </div>
        {s && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse motion-reduce:animate-none" aria-hidden />
            <CountUp value={s.online_now} /> online now
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {q.isLoading && <Skeleton className="h-48 w-full rounded-xl" />}
        {q.isError && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load app usage.</p>
            <Button size="sm" variant="outline" onClick={() => q.refetch()}><RefreshCw className="mr-1 h-4 w-4" />Retry</Button>
          </div>
        )}
        {s && s.total_users === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No one has opened the app since tracking started. Numbers appear as people use it.</p>
        )}
        {s && s.total_users > 0 && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[['Today', s.dau], ['7 days', s.wau], ['30 days', s.mau]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-muted/50 p-3">
                  <p className="text-2xl font-bold tabular-nums"><CountUp value={v as number} /></p>
                  <p className="text-xs text-muted-foreground">Active · {l}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Daily active, last 30 days</span><span>peak {max}</span></div>
              <div className="flex h-20 items-end gap-[3px]" role="img" aria-label={`Daily active users over 30 days, peak ${max}`}>
                {s.trend.map((t, i) => (
                  <div key={t.day} title={`${t.day}: ${t.users}`}
                    className={`flex-1 rounded-full ${i === s.trend.length - 1 ? 'bg-primary' : 'bg-primary/30'}`}
                    style={{ height: `${Math.max(4, (t.users / max) * 100)}%` }} />
                ))}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-medium">By device (30 days)</p>
                {PLATFORMS.map(({ key, label, Icon }) => {
                  const n = s.by_platform?.[key] ?? 0;
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      <span className="w-28">{label}</span>
                      <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(n / platTotal) * 100}%` }} /></div>
                      <span className="w-8 text-right tabular-nums">{n}</span>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Who (30 days)</p>
                {PEOPLE.map(([k, l]) => (
                  <div key={k} className="flex justify-between text-sm"><span className="text-muted-foreground">{l}</span><span className="tabular-nums">{s.by_person?.[k] ?? 0}</span></div>
                ))}
                <div className="pt-2">
                  <div className="flex justify-between text-sm"><span>Active members using the app</span><span className="font-medium">{adoption}%</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-success" style={{ width: `${adoption}%` }} /></div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.members_with_app} of {s.active_members} active members</p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
