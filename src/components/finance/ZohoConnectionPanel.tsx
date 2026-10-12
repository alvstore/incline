import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, Link2, Loader2, PlugZap, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { ZOHO_STATUS_KEY, zohoAction, zohoBadge, type ZohoStatus } from './zohoConnection';
import { ZohoDirectSetupSheet } from './ZohoDirectSetupSheet';

const BADGES = {
  not_configured: { label: 'Not configured', cls: 'bg-muted text-muted-foreground border border-border', Icon: PlugZap },
  direct: { label: 'Connected (direct)', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20', Icon: CheckCircle2 },
  connector: { label: 'Using connector', cls: 'bg-blue-500/10 text-blue-600 border border-blue-500/20', Icon: Link2 },
  reconnect: { label: 'Needs reconnect', cls: 'bg-destructive/10 text-destructive border border-destructive/20', Icon: AlertTriangle },
} as const;

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function ZohoConnectionPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const status = useQuery({
    queryKey: ZOHO_STATUS_KEY,
    queryFn: () => zohoAction<ZohoStatus>({ action: 'status' }),
    staleTime: 30_000,
  });

  useEffect(() => {
    const z = params.get('zoho');
    if (!z) return;
    if (z === 'connected') toast({ title: 'Zoho Books connected', description: 'Run "Test connection", then switch to Direct.' });
    else toast({ title: 'Zoho connection failed', description: params.get('reason') ?? 'Please try again.', variant: 'destructive' });
    const next = new URLSearchParams(params); next.delete('zoho'); next.delete('reason');
    setParams(next, { replace: true });
    qc.invalidateQueries({ queryKey: ZOHO_STATUS_KEY });
  }, [params, setParams, toast, qc]);

  const done = () => qc.invalidateQueries({ queryKey: ZOHO_STATUS_KEY });
  const test = useMutation({
    mutationFn: () => zohoAction<{ org_name: string }>({ action: 'test' }),
    onSuccess: (r) => toast({ title: 'Connection works', description: `Organisation: ${r.org_name}` }),
    onError: (e: Error) => toast({ title: 'Connection test failed', description: e.message, variant: 'destructive' }),
    onSettled: done,
  });
  const setMode = useMutation({
    mutationFn: (mode: 'connector' | 'direct') => zohoAction({ action: 'set_mode', mode }),
    onMutate: async (mode) => {
      await qc.cancelQueries({ queryKey: ZOHO_STATUS_KEY });
      const prev = qc.getQueryData<ZohoStatus>(ZOHO_STATUS_KEY);
      if (prev) qc.setQueryData(ZOHO_STATUS_KEY, { ...prev, mode });
      return { prev };
    },
    onError: (e: Error, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(ZOHO_STATUS_KEY, ctx.prev);
      toast({ title: 'Could not change mode', description: e.message, variant: 'destructive' });
    },
    onSettled: done,
  });
  const reconnect = useMutation({
    mutationFn: () => zohoAction<{ url: string }>({ action: 'start', origin: window.location.origin }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e: Error) => toast({ title: 'Could not open Zoho', description: e.message, variant: 'destructive' }),
  });
  const disconnect = useMutation({
    mutationFn: () => zohoAction({ action: 'disconnect' }),
    onSuccess: () => toast({ title: 'Direct connection removed', description: 'Sync is back on the connector.' }),
    onError: (e: Error) => toast({ title: 'Disconnect failed', description: e.message, variant: 'destructive' }),
    onSettled: () => { setConfirmDisconnect(false); done(); },
  });

  if (status.isLoading) return <Skeleton className="h-28 rounded-xl" />;
  if (status.isError) return <p role="alert" className="text-sm text-destructive">Couldn’t load Zoho connection status.</p>;

  const s = status.data!;
  const badge = BADGES[zohoBadge(s)];
  const canDirect = s.connected && !!s.last_test_ok_at;

  return (
    <section aria-labelledby="zoho-conn-title" className="space-y-4 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 id="zoho-conn-title" className="text-sm font-semibold text-foreground">Connection</h3>
          <Badge className={`gap-1 rounded-full ${badge.cls}`}><badge.Icon className="h-3 w-3" aria-hidden="true" />{badge.label}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="zoho-direct-mode" checked={s.mode === 'direct'} disabled={setMode.isPending || (!canDirect && s.mode !== 'direct')}
            onCheckedChange={(on) => setMode.mutate(on ? 'direct' : 'connector')} aria-describedby="zoho-mode-help" />
          <Label htmlFor="zoho-direct-mode" className="cursor-pointer text-sm">Use direct connection</Label>
        </div>
      </div>
      <p id="zoho-mode-help" className="text-xs text-muted-foreground">
        {canDirect ? 'Turn off any time to go back to the connector instantly.' : 'Connect and pass a test before switching to direct.'}
      </p>

      {s.has_client && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organisation</dt><dd className="text-foreground">{s.org_name ?? '—'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data centre</dt><dd className="text-foreground">zoho.{s.dc}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected</dt><dd className="text-foreground">{fmt(s.connected_at)}{s.connected_by_name ? ` · ${s.connected_by_name}` : ''}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last test passed</dt><dd className="text-foreground">{fmt(s.last_test_ok_at)}</dd></div>
        </dl>
      )}

      {s.last_refresh_error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Zoho refused the saved login: {s.last_refresh_error}. Press Reconnect.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11 gap-2" onClick={() => setSheetOpen(true)}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />{s.has_client ? 'Edit direct setup' : 'Set up direct connection'}
        </Button>
        {s.has_client && (
          <>
            <Button variant="outline" className="h-11 gap-2" onClick={() => test.mutate()} disabled={!s.connected || test.isPending}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}Test connection
            </Button>
            <Button variant="outline" className="h-11 gap-2" onClick={() => reconnect.mutate()} disabled={reconnect.isPending}>
              {reconnect.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}{s.connected ? 'Reconnect' : 'Connect with Zoho'}
            </Button>
            <Button variant="outline" className="h-11 gap-2 text-destructive hover:text-destructive" onClick={() => setConfirmDisconnect(true)}>
              <Unplug className="h-4 w-4" aria-hidden="true" />Disconnect
            </Button>
          </>
        )}
      </div>

      <ZohoDirectSetupSheet open={sheetOpen} onOpenChange={setSheetOpen} status={s} />
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove direct Zoho connection?</AlertDialogTitle>
            <AlertDialogDescription>The saved Client ID, secret and Zoho login are deleted. Sync goes back to the connector.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); disconnect.mutate(); }} disabled={disconnect.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {disconnect.isPending ? 'Removing…' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
