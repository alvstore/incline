import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ShieldX, Check, Wallet, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { getISTToday } from '@/lib/utils/datetime';
import { toast } from 'sonner';

interface GateAlertRow {
  id: string;
  member_id: string;
  tier: 'red' | 'amber';
  mode: string;
  reasons: string[];
  base_due: number;
  pt_due: number;
  store_due: number;
  addon_due: number;
  scan_count: number;
  status: 'open' | 'acknowledged' | 'resolved';
  updated_at: string;
  members: { member_code: string | null; profiles: { full_name: string | null } | null } | null;
}

const REASON_LABEL: Record<string, string> = {
  membership_dues: 'Membership',
  pt_dues: 'Personal training',
  store_dues: 'Store',
  addon_dues: 'Add-on',
};

const inr = (n: number) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

/** Live RED/AMBER gate alerts for the front desk (today, IST). */
export function GateAlertsCard({ branchId }: { branchId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = getISTToday();

  useRealtimeInvalidate({
    channel: `gate-alerts-${branchId ?? 'all'}`,
    tables: ['front_desk_alerts'],
    invalidateKeys: [['gate-alerts']],
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['gate-alerts', branchId, today],
    queryFn: async (): Promise<GateAlertRow[]> => {
      let q = supabase
        .from('front_desk_alerts')
        .select('id, member_id, tier, mode, reasons, base_due, pt_due, store_due, addon_due, scan_count, status, updated_at, members:member_id(member_code, profiles:user_id(full_name))')
        .eq('alert_day', today)
        .neq('status', 'resolved')
        .order('updated_at', { ascending: false })
        .limit(20);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as GateAlertRow[];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'acknowledged' | 'resolved' }) => {
      const { error } = await supabase.rpc('update_gate_alert', { _alert_id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gate-alerts'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data ?? [];
  const shadow = rows.some((r) => r.mode === 'shadow');

  return (
    <Card className="rounded-xl border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <ShieldAlert className="h-4 w-4 text-warning" aria-hidden /> Gate alerts
        </CardTitle>
        <CardDescription className="text-xs">
          Members with dues who scanned at the gate today.{shadow ? ' Trial mode — the gate is not changed yet.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2" aria-live="polite">
        {isLoading ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
        ) : isError ? (
          <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
            Couldn't load gate alerts.
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> No gate alerts today.
          </div>
        ) : (
          rows.map((r) => {
            const red = r.tier === 'red';
            const name = r.members?.profiles?.full_name ?? 'Member';
            const parts = [
              ['membership_dues', r.base_due], ['pt_dues', r.pt_due], ['store_dues', r.store_due], ['addon_dues', r.addon_due],
            ].filter(([, v]) => Number(v) > 0) as [string, number][];
            return (
              <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        red
                          ? 'border border-destructive/20 bg-destructive/10 text-destructive'
                          : 'border border-amber-500/20 bg-amber-500/10 text-amber-600'
                      }`}
                    >
                      {red ? <ShieldX className="h-3 w-3" aria-hidden /> : <ShieldAlert className="h-3 w-3" aria-hidden />}
                      {red ? 'Denied' : 'Let in — dues pending'}
                    </span>
                    <span className="truncate font-medium text-foreground">{name}</span>
                    {r.members?.member_code && <span className="text-xs text-muted-foreground">{r.members.member_code}</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {parts.map(([k, v]) => `${REASON_LABEL[k]} ${inr(v)}`).join(' · ')}
                    {r.scan_count > 1 ? ` · ${r.scan_count} scans` : ''}
                    {r.status === 'acknowledged' ? ' · Seen' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" className="min-h-[44px] sm:min-h-9" onClick={() => navigate(`/members?member=${r.member_id}`)}>
                    <Wallet className="mr-1 h-3.5 w-3.5" aria-hidden /> Collect
                  </Button>
                  {r.status === 'open' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[44px] sm:min-h-9"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: r.id, status: 'acknowledged' })}
                      aria-label={`Mark alert for ${name} as seen`}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Seen
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
