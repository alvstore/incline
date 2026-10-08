import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { MemberRenewalConcierge } from '@/components/renewal/MemberRenewalConcierge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  RenewalCaseRow,
  RenewalQueue,
  useRenewalAction,
  useRenewalCaseVoiceCalls,
  useRenewalEngineConfig,
  useRenewalFunnel,
  useRenewalQueue,
  useRenewalQueueCounts,
  useRenewalVoiceCall,
  useSetRenewalEngineConfig,
} from '@/hooks/useRenewalCenter';
import { useVoiceOpsSummary } from '@/hooks/useVoiceOps';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { dispositionLook, formatDuration, statusLook } from '@/lib/voice/voiceOutcomes';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Flame,
  Headphones,
  Loader2,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserRound,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const queues: Array<{ value: RenewalQueue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Expires today' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'lapsed', label: 'Lapsed' },
  { value: 'callback', label: 'Callbacks' },
  { value: 'voice', label: 'Voice AI' },
  { value: 'won', label: 'Renewed' },
  { value: 'lost', label: 'Lost' },
];

/**
 * Human wording for what staff actually record after speaking to a member.
 * Order matters: open outcomes first, closing outcomes last. `win_back` CLOSES
 * the case and counts as a renewal, so it must never be labelled as a promise —
 * a member who only promised to pay belongs on "Staff will follow up".
 */
const outcomes: Array<[string, string]> = [
  ['callback', 'Call back later'],
  ['staff_followup', 'Promised to renew — staff will follow up'],
  ['win_back', 'Won back — renewed after lapse (closes case)'],
  ['not_interested', 'Not interested'],
  ['frozen', 'Wants to freeze'],
  ['cancelled', 'Cancelled'],
  ['churned', 'Left the gym'],
];


const STAGE_LOOK: Record<string, { label: string; className: string }> = {
  eligible: { label: 'Not contacted', className: 'bg-muted text-muted-foreground' },
  reminding: { label: 'Reminders sent', className: 'bg-primary/10 text-primary' },
  voice_escalation: { label: 'Voice AI queue', className: 'bg-violet-100 text-violet-700' },
  staff_followup: { label: 'Staff follow-up', className: 'bg-amber-100 text-amber-700' },
  callback: { label: 'Callback booked', className: 'bg-blue-100 text-blue-700' },
  lapsed: { label: 'Lapsed', className: 'bg-red-100 text-red-700' },
  win_back: { label: 'Win-back', className: 'bg-emerald-100 text-emerald-700' },
  renewed: { label: 'Renewed', className: 'bg-emerald-100 text-emerald-700' },
  not_interested: { label: 'Not interested', className: 'bg-muted text-muted-foreground' },
  frozen: { label: 'Frozen', className: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
  churned: { label: 'Churned', className: 'bg-red-100 text-red-700' },
  suppressed: { label: 'Paused', className: 'bg-muted text-muted-foreground' },
};

function stageLook(stage: string) {
  return STAGE_LOOK[stage] ?? { label: stage.split('_').join(' '), className: 'bg-muted text-muted-foreground' };
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not scheduled';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? 'Not scheduled'
    : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** "2 days ago" style wording for the last gym visit — the strongest renewal signal. */
function sinceVisit(value: string | null | undefined) {
  if (!value) return { text: 'Never checked in', tone: 'text-red-600' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { text: 'Never checked in', tone: 'text-red-600' };
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return { text: 'Visited today', tone: 'text-emerald-600' };
  if (days === 1) return { text: 'Visited yesterday', tone: 'text-emerald-600' };
  if (days <= 7) return { text: `Visited ${days} days ago`, tone: 'text-emerald-600' };
  if (days <= 21) return { text: `Away ${days} days`, tone: 'text-amber-600' };
  return { text: `Away ${days} days`, tone: 'text-red-600' };
}

/** Expiry urgency drives the colour of the card's headline pill. */
function expiryLook(days: number) {
  if (days < 0) return { label: `${Math.abs(days)} days lapsed`, className: 'bg-red-100 text-red-700' };
  if (days === 0) return { label: 'Expires today', className: 'bg-red-100 text-red-700' };
  if (days <= 7) return { label: `${days} days left`, className: 'bg-amber-100 text-amber-700' };
  return { label: `${days} days left`, className: 'bg-emerald-100 text-emerald-700' };
}

export default function RenewalCenter() {
  const { branchFilter } = useBranchContext();
  const { hasAnyRole } = useAuth();
  const [queue, setQueue] = useState<RenewalQueue>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RenewalCaseRow | null>(null);
  const [outcome, setOutcome] = useState('callback');
  const [followUp, setFollowUp] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  // Members see their own concierge; staff and management see the retention queue.
  const isMemberView = hasAnyRole(['member']) && !hasAnyRole(['owner', 'admin', 'manager', 'staff']);

  const cases = useRenewalQueue(branchFilter, queue, search);
  const funnel = useRenewalFunnel(branchFilter);
  const counts = useRenewalQueueCounts(branchFilter);
  const action = useRenewalAction();
  const voiceCall = useRenewalVoiceCall();
  const voiceOps = useVoiceOpsSummary(branchFilter);
  const caseCalls = useRenewalCaseVoiceCalls(selected?.case_id);
  const engineConfig = useRenewalEngineConfig(branchFilter);
  const engineSave = useSetRenewalEngineConfig();

  const stats = useMemo(() => funnel.data ?? {}, [funnel.data]);
  const rows = cases.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const tabCounts = counts.data ?? {};
  const engineOff = engineConfig.data ? engineConfig.data.enabled !== true : true;
  const autoVoiceOn = engineConfig.data?.voice_auto_call_enabled === true && !engineOff;
  const canManageEngine = hasAnyRole(['owner', 'admin']);

  async function saveEngine(patch: { enabled?: boolean; voice_auto_call_enabled?: boolean }, message: string) {
    const id = engineConfig.data?.id;
    if (!id) return;
    try {
      await engineSave.mutateAsync({ id, ...patch });
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update renewal automation');
    }
  }

  const integration = voiceOps.data?.integration;
  const voiceLive = integration?.is_active === true && Boolean(integration?.agent_phone_number);
  const callingWindow = integration ? `${integration.window_start ?? '10:00'}–${integration.window_end ?? '19:00'} IST` : null;

  const conversion = useMemo(() => {
    const base = Number(stats.total ?? 0);
    return base ? Math.round((Number(stats.renewed ?? 0) / base) * 100) : 0;
  }, [stats]);

  const urgentToday = Number(tabCounts.today ?? 0);
  const lapsed = Number(tabCounts.lapsed ?? 0);

  const statCards: Array<{ label: string; value: string | number; icon: LucideIcon; tint: string }> = [
    { label: 'Open cases', value: Number(stats.open ?? 0), icon: Users, tint: 'bg-indigo-50 text-indigo-600' },
    { label: 'Contacted', value: Number(stats.contacted ?? 0), icon: Headphones, tint: 'bg-blue-50 text-blue-600' },
    { label: 'Renewed', value: Number(stats.renewed ?? 0), icon: CheckCircle2, tint: 'bg-emerald-50 text-emerald-600' },
    { label: 'Voice AI queue', value: Number(stats.voice ?? 0), icon: PhoneCall, tint: 'bg-violet-50 text-violet-600' },
    { label: 'Conversion', value: `${conversion}%`, icon: UserCheck, tint: 'bg-amber-50 text-amber-600' },
  ];

  async function run(input: Parameters<typeof action.mutateAsync>[0], message: string) {
    try {
      await action.mutateAsync(input);
      toast.success(message);
      setSelected(null);
      setNote(''); setReason(''); setFollowUp('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update renewal case');
    }
  }

  async function callNow(row: RenewalCaseRow) {
    try {
      await voiceCall.mutateAsync({ caseId: row.case_id, memberId: row.member_id });
      toast.success(`Ananya is calling ${row.member_name} now`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Voice AI could not start this call');
    }
  }

  if (isMemberView) {
    return (
      <AppLayout>
        <MemberRenewalConcierge />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Hero — what needs attention right now, in one glance. */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-white shadow-lg shadow-indigo-500/20">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-100">
                <ShieldCheck className="h-4 w-4" />Retention operations
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Renewal Center</h1>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-indigo-100">
                {urgentToday > 0
                  ? `${urgentToday} membership${urgentToday === 1 ? '' : 's'} expire today. Start there.`
                  : lapsed > 0
                    ? `${lapsed} membership${lapsed === 1 ? '' : 's'} already lapsed and can still be won back.`
                    : 'No expiries today. Work the due-soon queue to stay ahead.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur">
                  <Clock3 className="h-3.5 w-3.5" />Expiring today: {urgentToday}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur">
                  <Flame className="h-3.5 w-3.5" />Lapsed: {lapsed}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur">
                  <span className={`h-2 w-2 rounded-full ${voiceLive ? 'bg-emerald-300' : 'bg-white/60'}`} />
                  {voiceLive ? `Voice AI live · ${callingWindow}` : 'Voice AI not configured'}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="cursor-pointer gap-2 rounded-full bg-white/15 text-white hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/70"
                onClick={() => { cases.refetch(); counts.refetch(); funnel.refetch(); }}
                aria-label="Refresh renewal queue"
              >
                <RefreshCw className={`h-4 w-4 ${cases.isFetching ? 'animate-spin' : ''}`} />Refresh
              </Button>
              <Button asChild size="sm" className="cursor-pointer rounded-full bg-background text-primary hover:bg-background/90">
                <Link to="/voice-ai">Voice AI console</Link>
              </Button>
            </div>
          </div>
        </section>

        <div
          className={`flex flex-col gap-4 rounded-2xl p-4 text-sm shadow-lg lg:flex-row lg:items-center lg:justify-between ${
            engineOff ? 'bg-amber-50 shadow-amber-200/40' : 'bg-emerald-50 shadow-emerald-200/40'
          }`}
        >
          <div className="flex gap-3">
            <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${engineOff ? 'text-amber-600' : 'text-emerald-600'}`} />
            <div>
              <p className="font-semibold text-foreground">
                {engineOff ? 'Staff-led mode' : 'Automatic renewal follow-up is on'}
              </p>
              <p className="leading-relaxed text-muted-foreground">
                {engineOff
                  ? `Nothing is sent to members automatically from here. Existing expiry reminders continue unchanged. Voice AI renewal calls happen only when a staff member presses Call now, inside the calling window${callingWindow ? ` (${callingWindow})` : ''}; the outcome comes straight back into this queue.`
                  : `Members due for renewal are contacted automatically each day${autoVoiceOn ? `, and Ananya calls them inside the calling window${callingWindow ? ` (${callingWindow})` : ''}` : ''}. Every outcome lands back in this queue.`}
              </p>
            </div>
          </div>
          {canManageEngine && engineConfig.data && (
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Switch
                  id="renewal-engine-enabled"
                  checked={!engineOff}
                  disabled={engineSave.isPending}
                  onCheckedChange={(v) => saveEngine({ enabled: v }, v ? 'Automatic renewal follow-up is on' : 'Back to staff-led mode')}
                  className="cursor-pointer"
                />
                <Label htmlFor="renewal-engine-enabled" className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Auto follow-up
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="renewal-engine-voice"
                  checked={autoVoiceOn}
                  disabled={engineSave.isPending || engineOff}
                  onCheckedChange={(v) => saveEngine({ voice_auto_call_enabled: v }, v ? 'Ananya will call renewals automatically' : 'Automatic renewal calls turned off')}
                  className="cursor-pointer"
                />
                <Label htmlFor="renewal-engine-voice" className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Auto voice calls
                </Label>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {statCards.map((card) => (
            <Card
              key={card.label}
              className="rounded-2xl border-0 shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`rounded-full p-2 ${card.tint}`}><card.icon className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold text-foreground">{card.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={queue} onValueChange={(value) => setQueue(value as RenewalQueue)} className="overflow-x-auto">
            <TabsList className="rounded-xl">
              {queues.map((item) => {
                const count = Number(tabCounts[item.value] ?? 0);
                return (
                  <TabsTrigger key={item.value} value={item.value} className="cursor-pointer gap-2 rounded-lg">
                    {item.label}
                    {counts.isSuccess && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                        queue === item.value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      }`}>
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search renewals by member name or code"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Member name or code"
              className="rounded-xl pl-9 focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {cases.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        ) : cases.isError ? (
          <Card className="rounded-2xl border-0 shadow-lg shadow-muted/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="rounded-full bg-red-50 p-3 text-red-600"><XCircle className="h-6 w-6" /></div>
              <p className="font-semibold text-foreground">Could not load renewal cases</p>
              <p className="max-w-sm text-sm text-muted-foreground">Check your connection, then try again.</p>
              <Button variant="outline" className="cursor-pointer rounded-xl" onClick={() => cases.refetch()}>Try again</Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="rounded-2xl border-0 shadow-lg shadow-muted/30">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="rounded-full bg-emerald-50 p-3 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></div>
              <p className="font-semibold text-foreground">This queue is clear</p>
              <p className="max-w-sm text-sm text-muted-foreground">No renewal cases match these filters right now.</p>
              {queue !== 'all' && (
                <Button variant="outline" className="cursor-pointer rounded-xl" onClick={() => setQueue('all')}>View all cases</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const expiry = expiryLook(row.days_to_expiry);
              const stage = stageLook(row.stage);
              const visit = sinceVisit(row.last_visit);
              return (
                <Card
                  key={row.case_id}
                  className="rounded-2xl border-0 shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
                >
                  <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 gap-3">
                      <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 sm:flex">
                        <UserRound className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-base font-bold text-foreground">{row.member_name}</p>
                          <Badge variant="secondary" className="rounded-full text-xs">{row.member_code}</Badge>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stage.className}`}>{stage.label}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{row.plan_name ?? 'Membership'} · {row.masked_phone ?? 'No phone'}</p>
                        <p className={`mt-1 text-xs font-medium ${visit.tone}`}>{visit.text}</p>
                      </div>
                    </div>

                    <div className="space-y-1 text-sm">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${expiry.className}`}>{expiry.label}</span>
                      <p className="text-muted-foreground">Next action: {dateTime(row.next_action_at)}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.claimed_name ? `Owned by ${row.claimed_name}` : 'Unassigned'} · {row.attempts_count} contact{row.attempts_count === 1 ? '' : 's'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        className="cursor-pointer gap-2 rounded-xl focus:ring-2 focus:ring-indigo-500"
                        disabled={!voiceLive || voiceCall.isPending}
                        title={voiceLive ? 'Place a Voice AI renewal call now' : 'Voice AI is not configured yet'}
                        onClick={() => callNow(row)}
                      >
                        {voiceCall.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}Call now
                      </Button>
                      <Button asChild variant="outline" className="cursor-pointer gap-2 rounded-xl">
                        <Link to={`/members?member=${row.member_id}&renew=1`} aria-label={`Renew membership for ${row.member_name}`}>
                          <Sparkles className="h-4 w-4" />Renew
                        </Link>
                      </Button>
                      <Button
                        className="cursor-pointer rounded-xl focus:ring-2 focus:ring-indigo-500"
                        onClick={() => setSelected(row)}
                      >
                        Manage
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <p className="text-center text-xs text-muted-foreground">Showing {rows.length} of {total} cases</p>
          </div>
        )}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-xl">
          <SheetHeader className="border-b bg-card p-6">
            <SheetTitle className="text-xl font-bold text-foreground">{selected?.member_name}</SheetTitle>
            <SheetDescription>
              {selected?.member_code} · {selected?.plan_name ?? 'Membership'} · expires {selected?.expiry_date}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {/* Member signals */}
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last visit</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{sinceVisit(selected?.last_visit).text}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last contact</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{dateTime(selected?.last_contact_at)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contacts</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{selected?.attempts_count ?? 0}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Voice attempts</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{selected?.voice_attempts_count ?? 0}</p>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="cursor-pointer rounded-xl"
                disabled={action.isPending || Boolean(selected?.claimed_by)}
                onClick={() => selected && run({ caseId: selected.case_id, action: 'claim' }, 'Case claimed')}
              >
                <UserCheck className="mr-2 h-4 w-4" />{selected?.claimed_name ? `Owned by ${selected.claimed_name}` : 'Claim'}
              </Button>
              <Button
                variant="outline"
                className="cursor-pointer rounded-xl"
                disabled={action.isPending || !selected?.claimed_by}
                onClick={() => selected && run({ caseId: selected.case_id, action: 'unclaim' }, 'Case released')}
              >
                Release
              </Button>
            </section>

            <section className="space-y-4 rounded-xl bg-card p-4 shadow-lg shadow-muted/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Record what happened</p>
              <div className="space-y-2">
                <Label htmlFor="renewal-outcome">Outcome</Label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger id="renewal-outcome" className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{outcomes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {(outcome === 'callback' || outcome === 'staff_followup') && (
                <div className="space-y-2">
                  <Label htmlFor="renewal-followup">Next follow-up</Label>
                  <Input id="renewal-followup" type="datetime-local" className="rounded-xl" value={followUp} onChange={(event) => setFollowUp(event.target.value)} />
                </div>
              )}
              {['not_interested', 'cancelled', 'churned'].includes(outcome) && (
                <div className="space-y-2">
                  <Label htmlFor="renewal-reason">Reason</Label>
                  <Input id="renewal-reason" className="rounded-xl" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Capture the member's reason" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="renewal-note">Staff notes</Label>
                <Textarea id="renewal-note" className="rounded-xl" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What happened and what should happen next?" />
              </div>
            </section>

            <section className="space-y-3 rounded-xl bg-card p-4 shadow-lg shadow-muted/30">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="rounded-full bg-indigo-50 p-1.5 text-indigo-600"><PhoneCall className="h-4 w-4" /></span>Voice AI calls
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="cursor-pointer gap-2 rounded-xl"
                  disabled={!voiceLive || voiceCall.isPending}
                  onClick={() => selected && callNow(selected)}
                >
                  {voiceCall.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}Call now
                </Button>
              </div>
              {!voiceLive && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  Voice calling is not active yet. Finish the Sarvam setup in the Voice AI console to enable it.
                </p>
              )}
              {caseCalls.isLoading ? (
                <Skeleton className="h-14 rounded-xl" />
              ) : caseCalls.isError ? (
                <p className="text-xs text-red-600">Could not load the call history for this member.</p>
              ) : (caseCalls.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No Voice AI call has been placed for this renewal yet.</p>
              ) : (
                <ul className="space-y-2">
                  {(caseCalls.data ?? []).map((call) => {
                    const status = statusLook(call.status);
                    const outcomeLook = dispositionLook(call.disposition);
                    return (
                      <li key={call.call_id} className="rounded-xl bg-muted/50 p-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 font-medium ${status.className}`}>{status.label}</span>
                          {outcomeLook && <span className={`rounded-full px-2.5 py-0.5 font-medium ${outcomeLook.className}`}>{outcomeLook.label}</span>}
                          <span className="text-muted-foreground">{dateTime(call.started_at)} · {formatDuration(call.duration_seconds)}</span>
                        </div>
                        {call.call_summary && <p className="mt-2 text-muted-foreground">{call.call_summary}</p>}
                        {call.next_step_agreed && <p className="mt-1 text-muted-foreground">Next step: {call.next_step_agreed}</p>}
                        {call.callback_datetime && <p className="mt-1 text-muted-foreground">Callback asked for: {call.callback_datetime}</p>}
                        {call.error_message && <p className="mt-1 text-red-600">Call did not connect: {call.error_message}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {selected && (
              <Button asChild variant="outline" className="w-full cursor-pointer gap-2 rounded-xl">
                <Link to={`/members?member=${selected.member_id}&renew=1`}>
                  <Sparkles className="h-4 w-4" />Renew membership / record payment
                </Link>
              </Button>
            )}
          </div>

          <SheetFooter className="grid gap-2 border-t bg-card p-4 sm:grid-cols-2">
            <Button
              variant="outline"
              className="cursor-pointer rounded-xl"
              disabled={action.isPending}
              onClick={() => selected && run({ caseId: selected.case_id, action: 'voice_escalate', note }, 'Added to Voice AI review queue')}
            >
              <PhoneCall className="mr-2 h-4 w-4" />Voice AI queue
            </Button>
            <Button
              className="cursor-pointer rounded-xl"
              disabled={action.isPending || (outcome === 'callback' && !followUp)}
              onClick={() => selected && run({
                caseId: selected.case_id,
                action: 'outcome',
                outcome,
                churnReason: reason || null,
                snoozedUntil: followUp ? new Date(followUp).toISOString() : null,
                note,
              }, 'Renewal outcome saved')}
            >
              {action.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}Save outcome
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
