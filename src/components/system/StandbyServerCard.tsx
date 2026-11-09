import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, Pencil, PlugZap, Server, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Check { ok: boolean; detail: string; ms?: number }
interface TestResult { ok: boolean; checkedAt: string; standbyUrl: string; checks: Record<string, Check> }
interface StandbyConfig {
  standby_url: string | null;
  standby_label: string | null;
  standby_app_url: string | null;
  has_service_key: boolean;
  service_key_hint: string | null;
  has_db_url: boolean;
  last_test: TestResult | null;
  updated_at: string | null;
}

const KEY = ['dr-standby-config'] as const;
const CHECK_LABELS: Record<string, string> = {
  address: 'Server address', secretKey: 'Secret key', api: 'Records', auth: 'Sign-in', storage: 'Files', helpers: 'Copy helpers',
};
const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

export function StandbyServerCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const cfg = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<StandbyConfig> => {
      const { data, error } = await supabase.rpc('dr_get_standby_config');
      if (error) throw error;
      return data as unknown as StandbyConfig;
    },
  });

  const test = useMutation({
    mutationFn: async (): Promise<TestResult> => {
      const { data, error } = await supabase.functions.invoke('dr-replicate', { body: { mode: 'test' } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Test failed');
      return data.result as TestResult;
    },
    onSuccess: (r) => {
      r.ok ? toast.success('Standby server is ready') : toast.warning('Standby server needs attention');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast.error("Couldn't test the standby server", { description: e.message }),
  });

  const c = cfg.data;
  const last = c?.last_test ?? null;
  const configured = !!c?.standby_url && !!c?.has_service_key;

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Server className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">Standby server</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The second server that receives the nightly copy and takes over if the main app goes down.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" className="min-h-11 gap-2 hover:bg-secondary" onClick={() => setOpen(true)} disabled={cfg.isLoading}>
              <Pencil className="h-4 w-4" /> {configured ? 'Edit details' : 'Add details'}
            </Button>
            <Button className="min-h-11 gap-2" onClick={() => test.mutate()} disabled={!c?.standby_url || test.isPending}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Test connection
            </Button>
          </div>
        </div>

        {cfg.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
        {cfg.isError && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Couldn't load standby details.</span>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => cfg.refetch()}>Try again</Button>
          </div>
        )}

        {c && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted/40 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server address</dt>
              <dd className="mt-1 break-all text-sm font-medium text-foreground">{c.standby_url ?? 'Not set'}</dd>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secret key</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                {c.has_service_key ? `Saved ${c.service_key_hint ?? ''}` : 'Using earlier saved key or not set'}
              </dd>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Standby app address</dt>
              <dd className="mt-1 break-all text-sm font-medium text-foreground">
                {c.standby_app_url
                  ? <a href={c.standby_app_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{c.standby_app_url}<ExternalLink className="h-3 w-3" /></a>
                  : 'Not set'}
              </dd>
            </div>
          </dl>
        )}

        {last && (
          <div className={cn('rounded-xl p-4', last.ok ? 'bg-success/10' : 'bg-warning/10')} aria-live="polite">
            <p className={cn('flex items-center gap-2 text-sm font-semibold', last.ok ? 'text-success' : 'text-warning')}>
              {last.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {last.ok ? 'Ready to take over' : 'Needs attention'} · tested {fmt(last.checkedAt)}
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(last.checks).map(([k, v]) => (
                <li key={k} className="flex items-start gap-2 rounded-lg bg-card p-2.5 text-xs">
                  {v.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                  <span className="min-w-0">
                    <span className="font-semibold text-foreground">{CHECK_LABELS[k] ?? k}</span>
                    <span className="block break-words text-muted-foreground">{v.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <SwitchGuide appUrl={c?.standby_app_url ?? null} ready={!!last?.ok} />
      </CardContent>
      <StandbyDetailsSheet open={open} onOpenChange={setOpen} config={c ?? null} />
    </Card>
  );
}

function SwitchGuide({ appUrl, ready }: { appUrl: string | null; ready: boolean }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm font-semibold text-foreground">If the main app goes down</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Press “Test connection” above and make sure every check is green.</li>
        <li>Open the standby app address and sign in with your usual account.</li>
        <li>Point the gate devices and team to the standby address until the main app is back.</li>
      </ol>
      <Button asChild={!!appUrl && ready} variant="outline" className="mt-3 min-h-11 gap-2 hover:bg-secondary" disabled={!appUrl || !ready}>
        {appUrl && ready
          ? <a href={appUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open standby app</a>
          : <span><ExternalLink className="h-4 w-4" /> Open standby app</span>}
      </Button>
      {!appUrl && <p className="mt-2 text-xs text-muted-foreground">Add the standby app address to enable this button.</p>}
    </div>
  );
}

function StandbyDetailsSheet({ open, onOpenChange, config }: {
  open: boolean; onOpenChange: (o: boolean) => void; config: StandbyConfig | null;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [key, setKey] = useState('');
  const [dbUrl, setDbUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    setUrl(config?.standby_url ?? '');
    setLabel(config?.standby_label ?? '');
    setAppUrl(config?.standby_app_url ?? '');
    setKey('');
    setDbUrl('');
  }, [open, config]);

  const urlValid = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(url.trim());
  const appValid = !appUrl.trim() || /^https:\/\//.test(appUrl.trim());

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('dr_save_standby_config', {
        p_standby_url: url.trim(),
        p_service_key: key.trim() ? key.trim() : null,
        p_db_url: dbUrl.trim() ? dbUrl.trim() : null,
        p_label: label.trim(),
        p_app_url: appUrl.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Standby details saved — press “Test connection” to check them');
      qc.invalidateQueries({ queryKey: KEY });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle>Standby server details</SheetTitle>
          <SheetDescription>Used for the nightly copy and for switching over. Secret values are never shown again after saving.</SheetDescription>
        </SheetHeader>
        <form
          id="standby-form"
          className="flex-1 space-y-5 overflow-y-auto p-5"
          onSubmit={(e) => { e.preventDefault(); if (urlValid && appValid) save.mutate(); }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sb-label">Name</Label>
            <Input id="sb-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Incline standby" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-url">Server address <span className="text-destructive">*</span></Label>
            <Input id="sb-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" aria-required aria-invalid={!!url && !urlValid} aria-describedby="sb-url-help" />
            <p id="sb-url-help" className={cn('text-xs', url && !urlValid ? 'text-destructive' : 'text-muted-foreground')}>
              {url && !urlValid ? 'Must start with https:// and contain only the host.' : 'The standby server’s secure web address.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-key">Secret key</Label>
            <Input id="sb-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
              placeholder={config?.has_service_key ? `Saved ${config.service_key_hint ?? ''} — leave blank to keep` : 'Paste the standby’s full-access key'} aria-describedby="sb-key-help" />
            <p id="sb-key-help" className="text-xs text-muted-foreground">Full-access key from the standby server. Stored privately; only the copy worker reads it.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-db">Database login (optional)</Label>
            <Input id="sb-db" type="password" autoComplete="off" value={dbUrl} onChange={(e) => setDbUrl(e.target.value)}
              placeholder={config?.has_db_url ? 'Saved — leave blank to keep' : 'postgresql://…'} aria-describedby="sb-db-help" />
            <p id="sb-db-help" className="text-xs text-muted-foreground">Fallback only, used if the secure address can’t install the copy helpers.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-app">Standby app address</Label>
            <Input id="sb-app" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://standby.theincline.in" aria-invalid={!appValid} aria-describedby="sb-app-help" />
            <p id="sb-app-help" className={cn('text-xs', !appValid ? 'text-destructive' : 'text-muted-foreground')}>
              {!appValid ? 'Must start with https://' : 'Where the team signs in when you switch over.'}
            </p>
          </div>
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="standby-form" className="min-h-11 gap-2" disabled={!urlValid || !appValid || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
