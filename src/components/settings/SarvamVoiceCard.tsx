import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PhoneCall, CheckCircle2, XCircle, Loader2, Settings, ExternalLink,
  ShieldAlert, Clock, PhoneOutgoing, AlertTriangle,
} from 'lucide-react';

interface SarvamConfig {
  org_id?: string;
  workspace_id?: string;
  app_id?: string;
  app_version?: number | null;
  connection_id?: string;
  agent_phone_number?: string;
  telephony_provider?: string;
  timezone?: string;
  window_start?: string;
  window_end?: string;
  max_concurrent_calls?: number;
  daily_call_cap?: number;
  test_phone?: string;
}

interface RetentionAutomation {
  enabled?: boolean;
  min_absent_days?: number;
  window_start?: string;
  window_end?: string;
  max_calls_per_day?: number;
  cooldown_days?: number;
}

interface SarvamDeployment {
  deployment_id?: string;
  name?: string | null;
  app_id?: string;
  app_version?: number;
  status?: string | null;
  channel_direction?: string | null;
  phone_numbers?: string[];
}

interface SarvamReadiness {
  connected: boolean;
  api_key_configured: boolean;
  agent_configured: boolean;
  agent_version: string | null;
  agent_committed: boolean;
  deployment_configured: boolean;
  outbound_enabled: boolean;
  phone_number_configured: boolean;
  phone_number_active: boolean;
  deployment_active?: boolean;
  phone_number_assigned: boolean;
  test_call_available: boolean;
  successful_test_call: boolean;
  integration_enabled: boolean;
  production_ready: boolean;
  probe_error: string | null;
  blockers: string[];
}

interface EligibilitySummary {
  considered: number;
  eligible: number;
  missing_phone: number;
  dnd: number;
  paused_handoff: number;
  not_absent_enough: number;
  already_contacted_today: number;
  cooldown: number;
  in_calling_window: boolean;
  calling_window: string;
  daily_cap: number;
  used_today: number;
  remaining_today: number;
  checked_at_ist: string;
}

interface SarvamState {
  ok: boolean;
  configured: boolean;
  integration: {
    id: string;
    is_active: boolean;
    api_key_masked: string;
    has_api_key: boolean;
    api_key_set_at: string | null;
    last_check_at: string | null;
    last_check_status: string | null;
    last_check_error: string | null;
    retention_automation: RetentionAutomation | null;
  } | null;
  config: SarvamConfig;
  readiness?: SarvamReadiness;
  test?: { ok: boolean; error?: string; deployment?: SarvamDeployment | null; deployments?: SarvamDeployment[]; agent_found?: boolean | null };
  error?: string;
}

const SARVAM_CONSOLE_URL = 'https://dashboard.sarvam.ai/';

async function invokeSarvam(payload: Record<string, unknown>): Promise<SarvamState> {
  const { data, error } = await supabase.functions.invoke('sarvam-voice', { body: payload });
  if (error) throw new Error(error.message);
  const res = data as SarvamState;
  if (!res?.ok && res?.error) throw new Error(res.error);
  return res;
}

export default function SarvamVoiceCard() {
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [form, setForm] = useState<SarvamConfig>({});
  const [testPhone, setTestPhone] = useState('');
  const [outboundUnsupported, setOutboundUnsupported] = useState(false);
  const [lastCheck, setLastCheck] = useState<SarvamState['test'] | null>(null);
  const [blockersOpen, setBlockersOpen] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilitySummary | null>(null);

  const stateQuery = useQuery({
    queryKey: ['sarvam-voice', 'state'],
    queryFn: () => invokeSarvam({ action: 'get_state' }),
  });

  const readinessQuery = useQuery({
    queryKey: ['sarvam-voice', 'readiness'],
    queryFn: () => invokeSarvam({ action: 'get_readiness' }),
    staleTime: 60_000,
  });

  const attemptsQuery = useQuery({
    queryKey: ['sarvam-voice', 'attempts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voice_call_attempts')
        .select('id, phone, status, disposition, source, duration_seconds, started_at, ended_at, error_message')
        .eq('provider', 'sarvam')
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const state = stateQuery.data;
  const cfg = state?.config ?? {};
  const integration = state?.integration ?? null;
  const automation = integration?.retention_automation ?? {};
  const readiness = readinessQuery.data?.readiness ?? null;
  const canTestCall = !!readiness?.test_call_available;
  const canEnableRetention =
    !!readiness?.production_ready && !!readiness?.test_call_available && !!readiness?.successful_test_call;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sarvam-voice'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => invokeSarvam({ action: 'save_config', config: form, api_key: apiKey || undefined }),
    onSuccess: () => {
      toast.success('Sarvam configuration saved');
      setApiKey('');
      setSheetOpen(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeMutation = useMutation({
    mutationFn: (is_active: boolean) => invokeSarvam({ action: 'set_active', is_active }),
    onSuccess: (_d, is_active) => {
      toast.success(is_active ? 'Sarvam Voice AI enabled' : 'Sarvam Voice AI disabled');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testConnectionMutation = useMutation({
    mutationFn: () => invokeSarvam({ action: 'test_connection' }),
    onSuccess: (res) => {
      setLastCheck(res.test ?? null);
      if (res.test?.ok) toast.success('Connected to Sarvam');
      else toast.error(res.test?.error || 'Connection failed');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testCallMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sarvam-voice', {
        body: { action: 'test_call', to: testPhone, confirmed: true },
      });
      if (error) throw new Error(error.message);
      const res = data as { ok: boolean; error?: string; code?: string };
      if (!res.ok) {
        // Sarvam does not expose Instant Outbound for this workspace/agent —
        // fall back to a manual test in the Sarvam dashboard.
        setOutboundUnsupported(res.code === 'sarvam_not_found');
        throw new Error(res.error || 'Test call failed');
      }
      setOutboundUnsupported(false);
      return res;
    },
    onSuccess: () => {
      toast.success('Test call placed — the agent is dialling now');
      setConfirmOpen(false);
      refresh();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmOpen(false);
      refresh();
    },
  });

  const automationMutation = useMutation({
    mutationFn: (next: RetentionAutomation) => invokeSarvam({ action: 'save_automation', retention_automation: next }),
    onSuccess: () => {
      toast.success('Retention call settings saved');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eligibilityMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sarvam-voice', {
        body: { action: 'run_eligibility_check' },
      });
      if (error) throw new Error(error.message);
      const res = data as { ok: boolean; error?: string; eligibility?: EligibilitySummary };
      if (!res.ok) throw new Error(res.error || 'Eligibility check failed');
      return res.eligibility as EligibilitySummary;
    },
    onSuccess: (d) => setEligibility(d),
    onError: (e: Error) => toast.error(e.message),
  });

  const openSheet = () => {
    setForm({ ...cfg });
    setApiKey('');
    setSheetOpen(true);
  };

  const set = <K extends keyof SarvamConfig>(key: K, value: SarvamConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const deployment = lastCheck?.deployment ?? null;
  const checkStatus = integration?.last_check_status;

  if (stateQuery.isLoading) {
    return (
      <Card className="rounded-2xl">
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (stateQuery.isError) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-8 text-center space-y-3">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {(stateQuery.error as Error).message || 'Unable to load the Sarvam integration.'}
          </p>
          <Button variant="outline" onClick={() => stateQuery.refetch()} className="cursor-pointer">Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="bg-primary/10 text-primary p-2 rounded-full" aria-hidden="true">
                <PhoneCall className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Sarvam Voice AI
                  {integration?.is_active
                    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>
                    : <Badge variant="secondary">Inactive</Badge>}
                  {readinessQuery.isLoading
                    ? <Badge variant="outline">Checking…</Badge>
                    : readiness?.production_ready
                      ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Ready</Badge>
                      : readiness?.connected
                        ? <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Action required</Badge>
                        : <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Blocked</Badge>}
                </CardTitle>
                <CardDescription>
                  Outbound AI voice agent for member follow-ups. API key is stored server-side only.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!integration?.is_active}
                disabled={!state?.configured || activeMutation.isPending}
                onCheckedChange={(v) => activeMutation.mutate(v)}
                aria-label="Enable Sarvam Voice AI"
              />
              <Button variant="outline" size="sm" onClick={openSheet} className="gap-1.5 cursor-pointer">
                <Settings className="h-3.5 w-3.5" /> Configure
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Status row */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">API key</p>
              <p className="text-sm font-medium mt-1">
                {integration?.has_api_key ? integration.api_key_masked : 'Not set'}
              </p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent phone</p>
              <p className="text-sm font-medium mt-1">{cfg.agent_phone_number || '—'}</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Calling window (IST)</p>
              <p className="text-sm font-medium mt-1">
                {automation.window_start || cfg.window_start || '10:00'}–{automation.window_end || cfg.window_end || '19:00'}
                {' '}· cap {automation.max_calls_per_day ?? 25}/day
              </p>
            </div>

          </div>

          {/* Connection test */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => testConnectionMutation.mutate()}
              disabled={!integration?.has_api_key || testConnectionMutation.isPending}
              className="gap-1.5 cursor-pointer"
            >
              {testConnectionMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="h-3.5 w-3.5" />}
              Test connection
            </Button>
            {checkStatus === 'connected' && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Connected
                {integration?.last_check_at && ` · ${new Date(integration.last_check_at).toLocaleString('en-IN')}`}
              </span>
            )}
            {checkStatus === 'error' && (
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <XCircle className="h-4 w-4" /> {integration?.last_check_error}
              </span>
            )}
            <a
              href={SARVAM_CONSOLE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-sm text-primary inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              Open Sarvam Voice Agents <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          {deployment && (
            <div className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
              <p className="font-medium">
                Deployment: {deployment.name || deployment.deployment_id} · v{deployment.app_version}
              </p>
              <p className="text-muted-foreground">
                Status {deployment.status || 'unknown'} · {deployment.channel_direction || 'direction unknown'} ·
                {' '}Numbers: {deployment.phone_numbers?.length ? deployment.phone_numbers.join(', ') : 'none reported'}
              </p>
            </div>
          )}
          {lastCheck?.ok && lastCheck.agent_found === false && (
            <p className="flex items-center gap-1.5 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4" /> Credentials are valid but no deployment matches this Agent ID.
            </p>
          )}

          <Separator />

          {/* Test call */}
          <div className="space-y-2">
            <Label htmlFor="sarvam-test-phone">Single test call</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="sarvam-test-phone"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder={cfg.test_phone || '+91XXXXXXXXXX'}
                className="max-w-xs"
              />
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={
                  !canTestCall || outboundUnsupported ||
                  testPhone.trim().length < 10 || testCallMutation.isPending
                }
                className="gap-1.5 cursor-pointer"
              >
                {testCallMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PhoneOutgoing className="h-3.5 w-3.5" />}
                Place test call
              </Button>
            </div>
            {outboundUnsupported ? (
              <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
                <p>
                  Sarvam's Instant Outbound API is not available for this workspace/agent, so a call cannot be placed
                  from Incline. Run the test from the Sarvam dashboard instead.
                </p>
                <a
                  href="https://dashboard.sarvam.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline cursor-pointer"
                >
                  Manual test in Sarvam Voice Agents <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Places one real outbound call through Sarvam's Instant Outbound API. Blocked outside the calling
                  window, for do-not-contact numbers, past the daily cap, or while another call is live.
                </p>
                {!canTestCall && !readinessQuery.isLoading && (
                  <p className="text-xs text-amber-700">
                    Test calls are locked until Sarvam reports a working outbound deployment.{' '}
                    <button type="button" onClick={() => setBlockersOpen(true)} className="underline cursor-pointer">
                      Why is this disabled?
                    </button>
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Retention automation (disabled by default) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">Member Retention Calls — 7+ days absent</p>
                  {automation.enabled
                    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>
                    : canEnableRetention
                      ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Ready</Badge>
                      : <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">Blocked</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Foundation only. Nothing is dialled automatically while this is off.
                </p>
              </div>
              <Switch
                checked={!!automation.enabled}
                disabled={(!automation.enabled && !canEnableRetention) || automationMutation.isPending}
                onCheckedChange={(v) => automationMutation.mutate({ ...automation, enabled: v })}
                aria-label="Enable retention calls"
              />
            </div>

            {!canEnableRetention && (
              <div className="rounded-xl bg-muted/50 p-3 space-y-2">
                <p className="text-sm font-medium">Complete Voice AI setup before enabling retention calls.</p>
                <ul className="space-y-1 text-xs">
                  {([
                    ['Sarvam connected', !!readiness?.connected],
                    ['Agent configured', !!readiness?.agent_configured && !!readiness?.agent_version],
                    ['Outbound deployment', !!readiness?.deployment_configured && !!readiness?.outbound_enabled],
                    ['Deployment active & number assigned', !!readiness?.phone_number_active && !!readiness?.phone_number_assigned],
                    ['Integration switched on', !!readiness?.integration_enabled],
                    ['Successful test call', !!readiness?.successful_test_call],
                  ] as Array<[string, boolean]>).map(([label, done]) => (
                    <li key={label} className="flex items-center gap-2">
                      {done
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        : <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                      <span className={done ? 'text-emerald-700' : 'text-muted-foreground'}>{label}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs cursor-pointer"
                  onClick={() => setBlockersOpen(true)}
                >
                  Why is this disabled?
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => eligibilityMutation.mutate()}
                disabled={eligibilityMutation.isPending}
                className="gap-1.5 cursor-pointer"
              >
                {eligibilityMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Clock className="h-3.5 w-3.5" />}
                Run eligibility check
              </Button>
              <span className="text-xs text-muted-foreground">Read-only — places no calls.</span>
            </div>

            {eligibility && (
              <div className="grid gap-2 sm:grid-cols-3 rounded-xl border p-3 text-sm">
                {([
                  ['Eligible today', eligibility.eligible],
                  ['Already contacted today', eligibility.already_contacted_today],
                  ['DND / opted out', eligibility.dnd],
                  ['Cooldown', eligibility.cooldown],
                  ['Missing phone', eligibility.missing_phone],
                  ['Paused / handoff', eligibility.paused_handoff],
                  ['Absent < minimum', eligibility.not_absent_enough],
                  ['Remaining daily cap', eligibility.remaining_today],
                ] as Array<[string, number]>).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-semibold">{value}</p>
                  </div>
                ))}
                <div className="sm:col-span-3 text-xs text-muted-foreground">
                  {eligibility.in_calling_window
                    ? `Inside the calling window (${eligibility.calling_window})`
                    : `Outside the calling window (${eligibility.calling_window}) — nothing would be dialled now`}
                  {` · checked ${eligibility.checked_at_ist} IST`}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-absent-days">Minimum days absent</Label>
                <Input
                  id="sarvam-absent-days"
                  type="number"
                  min={1}
                  defaultValue={automation.min_absent_days ?? 7}
                  onBlur={(e) => automationMutation.mutate({ ...automation, min_absent_days: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-auto-cap">Max calls per day</Label>
                <Input
                  id="sarvam-auto-cap"
                  type="number"
                  min={1}
                  defaultValue={automation.max_calls_per_day ?? 25}
                  onBlur={(e) => automationMutation.mutate({ ...automation, max_calls_per_day: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-cooldown">Cooldown (days)</Label>
                <Input
                  id="sarvam-cooldown"
                  type="number"
                  min={0}
                  defaultValue={automation.cooldown_days ?? 7}
                  onBlur={(e) => automationMutation.mutate({ ...automation, cooldown_days: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Recent attempts */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent call attempts</p>
            {attemptsQuery.isLoading && <Skeleton className="h-16 w-full" />}
            {attemptsQuery.isError && (
              <p className="text-sm text-destructive">Unable to load call attempts.</p>
            )}
            {attemptsQuery.data?.length === 0 && (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <Clock className="h-5 w-5 mx-auto text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground mt-2">No calls placed yet.</p>
              </div>
            )}
            {!!attemptsQuery.data?.length && (
              <div className="divide-y rounded-xl border">
                {attemptsQuery.data.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div>
                      <p className="font-medium">{a.phone}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.source} · {a.started_at ? new Date(a.started_at).toLocaleString('en-IN') : '—'}
                        {a.duration_seconds ? ` · ${a.duration_seconds}s` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.error_message && (
                        <span className="text-xs text-destructive max-w-[16rem] truncate">{a.error_message}</span>
                      )}
                      <Badge variant={a.status === 'connected' ? 'default' : a.status === 'failed' ? 'destructive' : 'secondary'}>
                        {a.disposition || a.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Configuration drawer */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="p-6 pb-4 border-b">
            <SheetTitle>Sarvam Voice AI configuration</SheetTitle>
            <SheetDescription>
              Copy these values from your Sarvam Voice Agents dashboard. The API key is written to a server-only store
              and never returned to the browser.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sarvam-key">API key {integration?.has_api_key && <span className="text-muted-foreground">(leave blank to keep {integration.api_key_masked})</span>}</Label>
              <Input id="sarvam-key" type="password" autoComplete="off" value={apiKey}
                onChange={(e) => setApiKey(e.target.value)} placeholder="sk_..." />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-org">Organization ID</Label>
                <Input id="sarvam-org" value={form.org_id ?? ''} onChange={(e) => set('org_id', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-ws">Workspace ID</Label>
                <Input id="sarvam-ws" value={form.workspace_id ?? ''} onChange={(e) => set('workspace_id', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-app">Agent ID (app_id)</Label>
                <Input id="sarvam-app" value={form.app_id ?? ''} onChange={(e) => set('app_id', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-ver">Agent version</Label>
                <Input id="sarvam-ver" type="number" min={1} value={form.app_version ?? ''}
                  onChange={(e) => set('app_version', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-conn">Telephony connection ID</Label>
                <Input id="sarvam-conn" value={form.connection_id ?? ''} onChange={(e) => set('connection_id', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-from">Agent phone number</Label>
                <Input id="sarvam-from" value={form.agent_phone_number ?? ''} placeholder="+918065383003"
                  onChange={(e) => set('agent_phone_number', e.target.value)} />
              </div>
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-start">Window start (IST)</Label>
                <Input id="sarvam-start" type="time" value={form.window_start ?? '10:00'} onChange={(e) => set('window_start', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-end">Window end (IST)</Label>
                <Input id="sarvam-end" type="time" value={form.window_end ?? '19:00'} onChange={(e) => set('window_end', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-cap">Daily call cap</Label>
                <Input id="sarvam-cap" type="number" min={1} value={form.daily_call_cap ?? 50}
                  onChange={(e) => set('daily_call_cap', Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sarvam-conc">Max concurrent calls</Label>
                <Input id="sarvam-conc" type="number" min={1} max={10} value={form.max_concurrent_calls ?? 1}
                  onChange={(e) => set('max_concurrent_calls', Number(e.target.value))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sarvam-testnum">Default test number</Label>
                <Input id="sarvam-testnum" value={form.test_phone ?? ''} placeholder="+91XXXXXXXXXX"
                  onChange={(e) => set('test_phone', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t p-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} className="cursor-pointer">Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-1.5 cursor-pointer">
              {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save configuration
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={blockersOpen} onOpenChange={setBlockersOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voice AI readiness</AlertDialogTitle>
            <AlertDialogDescription>
              These checks run against Sarvam on every load. Calling stays locked until all of them pass.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {readiness?.blockers?.length
            ? (
              <ul className="space-y-2 text-sm">
                {readiness.blockers.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" aria-hidden="true" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )
            : <p className="text-sm text-muted-foreground">No blockers reported.</p>}
          {readiness?.probe_error && (
            <p className="text-xs text-red-600">Provider check failed: {readiness.probe_error}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); readinessQuery.refetch(); }}
              className="cursor-pointer"
            >
              Re-check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Place a real call to {testPhone}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sarvam will immediately dial this number with the configured agent. This is a live call and it is billed
              by Sarvam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); testCallMutation.mutate(); }}
              disabled={testCallMutation.isPending}
              className="cursor-pointer"
            >
              {testCallMutation.isPending ? 'Dialling…' : 'Call now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
