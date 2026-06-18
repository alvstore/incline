/**
 * RcsHub — Telinfy RCS management hub.
 *
 * Tabs: Overview · Templates · Test Console · Wallet & Reports · Webhooks
 * All sends route through dispatch-communication → send-rcs (Telinfy x-api-key).
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Activity, RefreshCw, Send, Wallet, Webhook, Copy, CheckCircle2, XCircle,
  Loader2, MessageSquare, FileText, Radio,
} from 'lucide-react';
import { toast } from 'sonner';

const FN_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
const WEBHOOK_URLS = {
  delivery: `${FN_BASE}/rcs-webhook/delivery`,
  userAction: `${FN_BASE}/rcs-webhook/user-action`,
  userMessage: `${FN_BASE}/rcs-webhook/user-message`,
};

type Template = {
  id: string;
  template_name: string;
  body_preview: string | null;
  variables: string[];
  status: string;
  last_synced_at: string;
};

export function RcsHub({ onConfigure }: { onConfigure?: () => void } = {}) {
  const { roles: roleInfos } = useAuth();
  const roles = (roleInfos ?? []).map((r: any) => r.role as string);
  const isAdmin = can.rcsAdmin(roles);
  const canSeeWallet = can.rcsWalletView(roles);
  const { selectedBranch } = useBranchContext();
  const branchId = (selectedBranch as any)?.id ?? null;
  const [tab, setTab] = useState('overview');

  // Telinfy config probe — drives empty / disabled / active state.
  const { data: cfg, isLoading: cfgLoading } = useQuery({
    queryKey: ['rcs-telinfy-cfg', branchId],
    queryFn: async () => {
      const q = supabase.from('integration_settings')
        .select('is_active, credentials, config, updated_at')
        .eq('integration_type', 'rcs').eq('provider', 'telinfy');
      const { data } = branchId
        ? await q.or(`branch_id.eq.${branchId},branch_id.is.null`).order('branch_id', { ascending: false, nullsFirst: false }).limit(1)
        : await q.is('branch_id', null).limit(1);
      return ((data as any[]) ?? [])[0] ?? null;
    },
  });

  const hasCreds = !!(cfg && ((cfg as any).credentials?.api_key || (cfg as any).credentials?.has_key));
  const isActive = !!cfg?.is_active;
  const state: 'unconfigured' | 'inactive' | 'active' =
    !hasCreds ? 'unconfigured' : !isActive ? 'inactive' : 'active';

  const testMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('rcs-wallet', { body: { branch_id: branchId } });
      if (error) throw new Error(error.message);
      if (!(data as any)?.ok) throw new Error((data as any)?.reason || 'connection_failed');
      return data as any;
    },
    onSuccess: (d: any) => toast.success(`Telinfy reachable — wallet ${d.currency || 'INR'} ${Number(d.balance ?? 0).toLocaleString('en-IN')}`),
    onError: (e: any) => toast.error(`Telinfy unreachable: ${e.message}`),
  });

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Radio className="h-5 w-5 text-primary" />
              RCS Hub <span className="text-slate-400 font-normal">— Telinfy</span>
              <Badge variant="secondary" className="ml-1">Beta</Badge>
              <StatusPill state={state} loading={cfgLoading} />
            </CardTitle>
            <CardDescription className="mt-1">
              Templates, direct sends, wallet, reports, and inbound webhooks for Telinfy RCS.
            </CardDescription>
          </div>
          {state === 'active' && (
            <Button size="sm" variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
              {testMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
              Test connection
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {state === 'unconfigured' ? (
          <EmptyConfigure onConfigure={onConfigure} />
        ) : (
          <>
            {state === 'inactive' && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3">
                <PauseCircleIcon />
                <div className="flex-1">
                  <p className="font-semibold">Credentials saved, but integration is disabled.</p>
                  <p className="text-amber-700/90 text-xs mt-0.5">Flip the Enable Integration toggle in Provider credentials above to start sending.</p>
                </div>
                {onConfigure && (
                  <Button size="sm" variant="outline" onClick={onConfigure}>Open</Button>
                )}
              </div>
            )}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="overview"><Activity className="h-3.5 w-3.5 mr-1.5" />Overview</TabsTrigger>
                <TabsTrigger value="templates"><FileText className="h-3.5 w-3.5 mr-1.5" />Templates</TabsTrigger>
                <TabsTrigger value="test"><Send className="h-3.5 w-3.5 mr-1.5" />Test Send</TabsTrigger>
                <TabsTrigger value="wallet" disabled={!canSeeWallet}><Wallet className="h-3.5 w-3.5 mr-1.5" />Wallet</TabsTrigger>
                <TabsTrigger value="webhooks"><Webhook className="h-3.5 w-3.5 mr-1.5" />Webhooks</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                <OverviewPanel branchId={branchId} canSeeWallet={canSeeWallet} />
              </TabsContent>
              <TabsContent value="templates" className="mt-4">
                <TemplatesPanel branchId={branchId} isAdmin={isAdmin} />
              </TabsContent>
              <TabsContent value="test" className="mt-4">
                <TestSendPanel branchId={branchId} isAdmin={isAdmin} disabled={state !== 'active'} />
              </TabsContent>
              <TabsContent value="wallet" className="mt-4">
                {canSeeWallet ? <WalletPanel branchId={branchId} /> : <div className="text-sm text-muted-foreground">No access.</div>}
              </TabsContent>
              <TabsContent value="webhooks" className="mt-4">
                <WebhooksPanel />
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ state, loading }: { state: 'unconfigured' | 'inactive' | 'active'; loading: boolean }) {
  if (loading) return <Badge className="bg-slate-100 text-slate-500">Checking…</Badge>;
  if (state === 'active') return <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>;
  if (state === 'inactive') return <Badge className="bg-amber-100 text-amber-700">Disabled</Badge>;
  return <Badge className="bg-slate-100 text-slate-600">Not configured</Badge>;
}

function PauseCircleIcon() {
  return <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold">!</span>;
}

function EmptyConfigure({ onConfigure }: { onConfigure?: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
        <Radio className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">Telinfy RCS isn't connected yet</h3>
      <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
        Add your Telinfy <code className="px-1 py-0.5 rounded bg-slate-200 font-mono text-[11px]">x-api-key</code> and (optional) Brand ID in Provider credentials above, then enable the integration.
      </p>
      {onConfigure && (
        <Button className="mt-4" onClick={onConfigure}>
          <Send className="h-4 w-4 mr-2" />Configure Telinfy
        </Button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── Overview ──────────────────── */
function OverviewPanel({ branchId, canSeeWallet }: { branchId: string | null; canSeeWallet: boolean }) {
  const { data: counts, isLoading } = useQuery({
    queryKey: ['rcs-overview-counts', branchId],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const base = supabase.from('communication_logs').select('delivery_status', { count: 'exact', head: false })
        .eq('channel', 'rcs').gte('created_at', since);
      const { data } = branchId ? await base.eq('branch_id', branchId) : await base;
      const rows = (data as any[]) ?? [];
      const tally = { sent: 0, delivered: 0, read: 0, failed: 0, total: rows.length };
      rows.forEach((r) => {
        const s = (r.delivery_status || '').toLowerCase();
        if (s === 'read') tally.read++;
        else if (s === 'delivered') tally.delivered++;
        else if (s === 'failed') tally.failed++;
        else tally.sent++;
      });
      return tally;
    },
    refetchInterval: 30_000,
  });

  const { data: wallet } = useQuery({
    enabled: canSeeWallet,
    queryKey: ['rcs-wallet-latest', branchId],
    queryFn: async () => {
      const q = supabase.from('rcs_wallet_snapshots').select('balance, currency, fetched_at')
        .order('fetched_at', { ascending: false }).limit(1);
      const { data } = branchId ? await q.eq('branch_id', branchId) : await q;
      return (data as any[])?.[0] ?? null;
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full rounded-2xl" />;
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <KpiCard label="Sent (24h)" value={counts?.total ?? 0} icon={<Send className="h-4 w-4" />} />
      <KpiCard label="Delivered" value={counts?.delivered ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" />
      <KpiCard label="Read" value={counts?.read ?? 0} icon={<MessageSquare className="h-4 w-4" />} tone="indigo" />
      <KpiCard label="Failed" value={counts?.failed ?? 0} icon={<XCircle className="h-4 w-4" />} tone="red" />
      {canSeeWallet && (
        <Card className="md:col-span-4 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-0 shadow-lg shadow-indigo-500/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-white/80">Wallet balance</p>
              <p className="text-3xl font-bold mt-1">
                {wallet?.balance != null ? `${wallet.currency || 'INR'} ${Number(wallet.balance).toLocaleString('en-IN')}` : '—'}
              </p>
              <p className="text-xs text-white/70 mt-1">
                {wallet?.fetched_at ? `Last synced ${new Date(wallet.fetched_at).toLocaleString('en-IN')}` : 'Not synced yet'}
              </p>
            </div>
            <Wallet className="h-10 w-10 opacity-80" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, tone = 'slate' }: { label: string; value: number; icon: React.ReactNode; tone?: string }) {
  const toneMap: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <Card className="rounded-2xl shadow-md shadow-slate-200/50 border-0">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
          <span className={`p-2 rounded-full ${toneMap[tone]}`}>{icon}</span>
        </div>
        <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────── Templates ────────────────── */
function TemplatesPanel({ branchId, isAdmin }: { branchId: string | null; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ['rcs-templates', branchId],
    queryFn: async () => {
      const q = supabase.from('rcs_templates').select('*').order('template_name');
      const { data, error } = branchId ? await q.or(`branch_id.eq.${branchId},branch_id.is.null`) : await q.is('branch_id', null);
      if (error) throw error;
      return (data as Template[]) ?? [];
    },
  });

  const syncMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('rcs-templates-sync', { body: { branch_id: branchId } });
      if (error) throw new Error(error.message);
      if (!(data as any)?.ok) throw new Error((data as any)?.reason || 'sync_failed');
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`Synced ${d.upserted}/${d.count} templates from Telinfy`);
      qc.invalidateQueries({ queryKey: ['rcs-templates'] });
    },
    onError: (e: any) => toast.error(`Sync failed: ${e.message}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {templates?.length ?? 0} approved template{templates?.length === 1 ? '' : 's'} mirrored from Telinfy.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
            {syncMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync from Telinfy
          </Button>
        )}
      </div>
      {isLoading ? <Skeleton className="h-40 w-full rounded-2xl" /> :
        templates && templates.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id} className="rounded-2xl shadow-md shadow-slate-200/50 border-0">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{t.template_name}</span>
                    <Badge className={t.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                      {t.status}
                    </Badge>
                  </div>
                  {t.body_preview && <p className="text-xs text-slate-600 line-clamp-3">{t.body_preview}</p>}
                  {t.variables?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.variables.map((v) => (
                        <Badge key={v} variant="outline" className="text-[10px] font-mono">{`{${v}}`}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="rounded-2xl border-dashed border-2 border-slate-200">
            <CardContent className="p-8 text-center text-sm text-slate-500">
              No templates synced yet. Click "Sync from Telinfy" to import approved templates.
            </CardContent>
          </Card>
        )}
    </div>
  );
}

/* ─────────────────────────────────────────── Test Send ────────────────── */
function TestSendPanel({ branchId, isAdmin, disabled = false }: { branchId: string | null; isAdmin: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('919887601200');
  const [templateName, setTemplateName] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [logId, setLogId] = useState<string | null>(null);

  const { data: templates } = useQuery({
    queryKey: ['rcs-templates-picker', branchId],
    queryFn: async () => {
      const { data } = await supabase.from('rcs_templates').select('template_name, variables').order('template_name');
      return (data as { template_name: string; variables: string[] }[]) ?? [];
    },
  });

  const selected = templates?.find((t) => t.template_name === templateName);

  const sendMut = useMutation({
    mutationFn: async () => {
      const cleanPhone = phone.replace(/\D/g, '');
      if (!cleanPhone) throw new Error('Phone required');
      if (!templateName) throw new Error('Pick a template');

      const { data, error } = await supabase.functions.invoke('dispatch-communication', {
        body: {
          channel: 'rcs',
          recipient: cleanPhone,
          branch_id: branchId,
          category: 'transactional',
          template_key: templateName,
          payload: {
            body: selected?.variables?.length ? '[RCS template send]' : 'Test',
            variables: vars,
          },
        },
      });
      if (error) throw new Error(error.message);
      return data as any;
    },
    onSuccess: (d: any) => {
      toast.success('RCS dispatched — watching delivery status');
      setLogId(d?.log_id ?? null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Live status poll
  const { data: status } = useQuery({
    enabled: !!logId,
    queryKey: ['rcs-test-status', logId],
    queryFn: async () => {
      const { data } = await supabase.from('communication_logs')
        .select('delivery_status, error_message, provider_record_id, sent_at, delivered_at, read_at')
        .eq('id', logId!).maybeSingle();
      return data;
    },
    refetchInterval: 3_000,
  });

  if (!isAdmin) return <div className="text-sm text-muted-foreground">Owner/admin only.</div>;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled} title={disabled ? 'Enable Telinfy integration to send' : undefined}><Send className="h-4 w-4 mr-2" />Open Test Console</Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Send RCS Test Message</SheetTitle>
            <SheetDescription>Routes through dispatch-communication → send-rcs → Telinfy.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="phone">Recipient (digits, with country code)</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919887601200" />
            </div>
            <div>
              <Label>Template</Label>
              <Select value={templateName} onValueChange={(v) => { setTemplateName(v); setVars({}); }}>
                <SelectTrigger><SelectValue placeholder="Pick a synced template" /></SelectTrigger>
                <SelectContent>
                  {templates?.map((t) => (
                    <SelectItem key={t.template_name} value={t.template_name}>{t.template_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selected?.variables?.map((v) => (
              <div key={v}>
                <Label htmlFor={v}>{v}</Label>
                <Input id={v} value={vars[v] ?? ''} onChange={(e) => setVars((p) => ({ ...p, [v]: e.target.value }))} />
              </div>
            ))}

            {logId && (
              <Card className="rounded-xl bg-slate-50 border-0">
                <CardContent className="p-3 space-y-1 text-xs font-mono">
                  <div>log_id: {logId}</div>
                  <div>status: <Badge>{status?.delivery_status ?? 'pending'}</Badge></div>
                  {status?.provider_record_id && <div>recordID: {status.provider_record_id}</div>}
                  {status?.sent_at && <div>sent: {new Date(status.sent_at).toLocaleTimeString()}</div>}
                  {status?.delivered_at && <div>delivered: {new Date(status.delivered_at).toLocaleTimeString()}</div>}
                  {status?.read_at && <div>read: {new Date(status.read_at).toLocaleTimeString()}</div>}
                  {status?.error_message && <div className="text-red-600">error: {status.error_message}</div>}
                </CardContent>
              </Card>
            )}
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={() => sendMut.mutate()} disabled={sendMut.isPending || !templateName || disabled}>
              {sendMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ─────────────────────────────────────────── Wallet ───────────────────── */
function WalletPanel({ branchId }: { branchId: string | null }) {
  const qc = useQueryClient();
  const { data: snaps, isLoading } = useQuery({
    queryKey: ['rcs-wallet-snaps', branchId],
    queryFn: async () => {
      const q = supabase.from('rcs_wallet_snapshots').select('*').order('fetched_at', { ascending: false }).limit(20);
      const { data } = branchId ? await q.eq('branch_id', branchId) : await q.is('branch_id', null);
      return (data as any[]) ?? [];
    },
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('rcs-wallet', { body: { branch_id: branchId } });
      if (error) throw new Error(error.message);
      if (!(data as any)?.ok) throw new Error((data as any)?.reason || 'wallet_failed');
      return data;
    },
    onSuccess: () => {
      toast.success('Wallet refreshed');
      qc.invalidateQueries({ queryKey: ['rcs-wallet-snaps'] });
      qc.invalidateQueries({ queryKey: ['rcs-wallet-latest'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
          {refreshMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh balance
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-32 w-full rounded-2xl" /> : (
        <div className="space-y-2">
          {snaps?.length ? snaps.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl bg-white shadow-sm px-4 py-2 text-sm">
              <span className="font-mono">{new Date(s.fetched_at).toLocaleString('en-IN')}</span>
              <span className="font-bold text-slate-900">{s.currency || 'INR'} {Number(s.balance ?? 0).toLocaleString('en-IN')}</span>
            </div>
          )) : <div className="text-sm text-slate-500">No snapshots yet.</div>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── Webhooks ─────────────────── */
function WebhooksPanel() {
  const copy = (s: string, label: string) => {
    navigator.clipboard.writeText(s);
    toast.success(`${label} URL copied`);
  };
  const rows: Array<[string, string, string]> = [
    ['Delivery (DLR)', WEBHOOK_URLS.delivery, 'Paste in Telinfy Hub → RCS → Webhooks → Delivery URL'],
    ['User Action', WEBHOOK_URLS.userAction, 'Receives button-click events from RCS rich cards'],
    ['User Message', WEBHOOK_URLS.userMessage, 'Inbound MO; honors STOP/opt-out; hands to AI brain'],
  ];
  return (
    <div className="space-y-3">
      {rows.map(([label, url, hint]) => (
        <Card key={label} className="rounded-2xl shadow-md shadow-slate-200/50 border-0">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-slate-900">{label}</span>
              <Button size="sm" variant="outline" onClick={() => copy(url, label)}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />Copy
              </Button>
            </div>
            <code className="block text-xs bg-slate-100 px-3 py-2 rounded font-mono break-all">{url}</code>
            <p className="text-xs text-slate-500">{hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
