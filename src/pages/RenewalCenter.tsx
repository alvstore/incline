import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
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
import { RenewalCaseRow, RenewalQueue, useRenewalAction, useRenewalCaseVoiceCalls, useRenewalFunnel, useRenewalQueue, useRenewalVoiceCall } from '@/hooks/useRenewalCenter';
import { useVoiceOpsSummary } from '@/hooks/useVoiceOps';
import { dispositionLook, formatDuration, statusLook } from '@/lib/voice/voiceOutcomes';
import { AlertTriangle, CalendarClock, CheckCircle2, Headphones, Loader2, PhoneCall, Search, ShieldCheck, UserCheck, Users, XCircle, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const queues: Array<{ value: RenewalQueue; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'due_soon', label: 'Due soon' }, { value: 'today', label: 'Expires today' },
  { value: 'lapsed', label: 'Lapsed' }, { value: 'callback', label: 'Callbacks' }, { value: 'voice', label: 'Voice AI' },
  { value: 'won', label: 'Renewed' }, { value: 'lost', label: 'Lost' },
];

const outcomes = [
  ['callback', 'Callback'], ['staff_followup', 'Staff follow-up'], ['not_interested', 'Not interested'],
  ['frozen', 'Freeze'], ['cancelled', 'Cancelled'], ['churned', 'Churned'], ['win_back', 'Win-back'],
];

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';
}

export default function RenewalCenter() {
  const { branchFilter } = useBranchContext();
  const [queue, setQueue] = useState<RenewalQueue>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RenewalCaseRow | null>(null);
  const [outcome, setOutcome] = useState('callback');
  const [followUp, setFollowUp] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const cases = useRenewalQueue(branchFilter, queue, search);
  const funnel = useRenewalFunnel(branchFilter);
  const action = useRenewalAction();
  const voiceCall = useRenewalVoiceCall();
  const voiceOps = useVoiceOpsSummary(branchFilter);
  const caseCalls = useRenewalCaseVoiceCalls(selected?.case_id);
  const stats = funnel.data ?? {};
  const rows = cases.data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const engineOff = true;
  const integration = voiceOps.data?.integration;
  const voiceLive = integration?.is_active === true && Boolean(integration?.agent_phone_number);
  const callingWindow = integration ? `${integration.window_start ?? '10:00'}–${integration.window_end ?? '19:00'} IST` : null;
  const conversion = useMemo(() => {
    const base = Number(stats.total ?? 0);
    return base ? Math.round((Number(stats.renewed ?? 0) / base) * 100) : 0;
  }, [stats]);
  const statCards: Array<[string, string | number, LucideIcon]> = [
    ['Open', Number(stats.open ?? 0), Users],
    ['Contacted', Number(stats.contacted ?? 0), Headphones],
    ['Renewed', Number(stats.renewed ?? 0), CheckCircle2],
    ['Voice queue', Number(stats.voice ?? 0), PhoneCall],
    ['Conversion', `${conversion}%`, UserCheck],
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

  return (
    <AppLayout>
      <div className="space-y-5">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" />Retention operations</div>
            <h1 className="text-3xl font-bold tracking-tight">Renewal Center</h1>
            <p className="mt-1 text-sm text-muted-foreground">One queue for upcoming expiries, callbacks, staff ownership and outcomes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="w-fit gap-2 rounded-full px-3 py-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Auto-sequences paused</Badge>
            <Badge variant="secondary" className={`w-fit gap-2 rounded-full px-3 py-1.5 ${voiceLive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              <PhoneCall className="h-3.5 w-3.5" />{voiceLive ? `Voice AI live · ${callingWindow}` : 'Voice AI not configured'}
            </Badge>
            <Button asChild variant="outline" size="sm" className="rounded-full"><Link to="/voice-ai">Voice AI console</Link></Button>
          </div>
        </header>

        {engineOff && (
          <div className="flex gap-3 rounded-xl bg-warning/10 p-4 text-sm text-foreground ring-1 ring-warning/20">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="font-semibold">Staff-led mode</p>
              <p className="text-muted-foreground">
                Nothing is sent to members automatically from here. Existing expiry reminders continue unchanged.
                Voice AI renewal calls happen only when a staff member presses Call now, inside the calling window
                {callingWindow ? ` (${callingWindow})` : ''}; the outcome comes straight back into this queue.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {statCards.map(([label, value, Icon]) => (
            <Card key={String(label)} className="rounded-2xl shadow-lg shadow-primary/5"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">{String(label)}</p><p className="text-2xl font-bold">{String(value ?? 0)}</p></div></CardContent></Card>
          ))}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={queue} onValueChange={(value) => setQueue(value as RenewalQueue)} className="overflow-x-auto"><TabsList>{queues.map((item) => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList></Tabs>
          <div className="relative w-full lg:w-72"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search renewals" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Member name or code" className="pl-9" /></div>
        </div>

        {cases.isLoading ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          : cases.isError ? <Card className="rounded-2xl"><CardContent className="flex items-center gap-3 p-6 text-destructive"><XCircle className="h-5 w-5" />Could not load renewal cases.</CardContent></Card>
          : rows.length === 0 ? <Card className="rounded-2xl"><CardContent className="py-14 text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-success" /><p className="mt-3 font-semibold">This queue is clear</p><p className="text-sm text-muted-foreground">No renewal cases match these filters.</p></CardContent></Card>
          : <div className="space-y-3">{rows.map((row) => (
            <Card key={row.case_id} className="rounded-2xl shadow-lg shadow-primary/5 transition-all hover:shadow-xl hover:shadow-primary/10"><CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-bold">{row.member_name}</p><Badge variant="secondary">{row.member_code}</Badge><Badge variant={row.stage === 'renewed' ? 'default' : row.days_to_expiry < 0 ? 'destructive' : 'outline'}>{row.stage.split('_').join(' ')}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{row.plan_name ?? 'Membership'} · {row.masked_phone ?? 'No phone'}</p></div>
              <div className="text-sm"><p className="font-semibold">{row.days_to_expiry < 0 ? `${Math.abs(row.days_to_expiry)} days lapsed` : row.days_to_expiry === 0 ? 'Expires today' : `${row.days_to_expiry} days remaining`}</p><p className="text-muted-foreground">Next: {dateTime(row.next_action_at)}</p><p className="text-xs text-muted-foreground">{row.claimed_name ? `Owned by ${row.claimed_name}` : 'Unassigned'} · {row.attempts_count} contacts</p></div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="gap-2"
                  disabled={!voiceLive || voiceCall.isPending}
                  title={voiceLive ? 'Place a Voice AI renewal call now' : 'Voice AI is not configured yet'}
                  onClick={() => callNow(row)}
                >
                  {voiceCall.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}Call now
                </Button>
                <Button variant="outline" onClick={() => setSelected(row)}>Manage</Button>
              </div>
            </CardContent></Card>
          ))}<p className="text-center text-xs text-muted-foreground">Showing {rows.length} of {total} cases</p></div>}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-lg">
          <SheetHeader className="border-b p-6"><SheetTitle>{selected?.member_name}</SheetTitle><SheetDescription>{selected?.member_code} · {selected?.plan_name ?? 'Membership'} · expires {selected?.expiry_date}</SheetDescription></SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-3"><Button variant="outline" disabled={action.isPending || Boolean(selected?.claimed_by)} onClick={() => selected && run({ caseId: selected.case_id, action: 'claim' }, 'Case claimed')}><UserCheck className="mr-2 h-4 w-4" />Claim</Button><Button variant="outline" disabled={action.isPending || !selected?.claimed_by} onClick={() => selected && run({ caseId: selected.case_id, action: 'unclaim' }, 'Case released')}>Release</Button></div>
            <div className="space-y-2"><Label htmlFor="renewal-outcome">Outcome</Label><Select value={outcome} onValueChange={setOutcome}><SelectTrigger id="renewal-outcome"><SelectValue /></SelectTrigger><SelectContent>{outcomes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            {(outcome === 'callback' || outcome === 'staff_followup') && <div className="space-y-2"><Label htmlFor="renewal-followup">Next follow-up</Label><Input id="renewal-followup" type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /></div>}
            {['not_interested', 'cancelled', 'churned'].includes(outcome) && <div className="space-y-2"><Label htmlFor="renewal-reason">Reason</Label><Input id="renewal-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Capture the member's reason" /></div>}
            <div className="space-y-2"><Label htmlFor="renewal-note">Staff notes</Label><Textarea id="renewal-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What happened and what should happen next?" /></div>
            <div className="rounded-xl bg-muted/50 p-4 text-sm"><p className="font-semibold">Journey status</p><p className="mt-1 text-muted-foreground">Last contact: {dateTime(selected?.last_contact_at ?? null)}</p><p className="text-muted-foreground">Last visit: {dateTime(selected?.last_visit ?? null)}</p><p className="text-muted-foreground">Voice attempts: {selected?.voice_attempts_count ?? 0}</p></div>

            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold"><PhoneCall className="h-4 w-4 text-primary" />Voice AI calls</p>
                <Button size="sm" variant="secondary" className="gap-2" disabled={!voiceLive || voiceCall.isPending} onClick={() => selected && callNow(selected)}>
                  {voiceCall.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}Call now
                </Button>
              </div>
              {!voiceLive && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />Voice calling is not active yet. Finish the Sarvam setup in the Voice AI console to enable it.</p>
              )}
              {caseCalls.isLoading ? <Skeleton className="h-12 rounded-lg" />
                : (caseCalls.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No Voice AI call has been placed for this renewal yet.</p>
                : <ul className="space-y-2">
                    {(caseCalls.data ?? []).map((call) => {
                      const status = statusLook(call.status);
                      const outcomeLook = dispositionLook(call.disposition);
                      return (
                        <li key={call.call_id} className="rounded-lg bg-muted/40 p-3 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-0.5 font-medium ${status.className}`}>{status.label}</span>
                            {outcomeLook && <span className={`rounded-full px-2.5 py-0.5 font-medium ${outcomeLook.className}`}>{outcomeLook.label}</span>}
                            <span className="text-muted-foreground">{dateTime(call.started_at)} · {formatDuration(call.duration_seconds)}</span>
                          </div>
                          {call.call_summary && <p className="mt-2 text-muted-foreground">{call.call_summary}</p>}
                          {call.next_step_agreed && <p className="mt-1 text-muted-foreground">Next step: {call.next_step_agreed}</p>}
                          {call.callback_datetime && <p className="mt-1 text-muted-foreground">Callback asked for: {call.callback_datetime}</p>}
                        </li>
                      );
                    })}
                  </ul>}
            </div>
          </div>
          <SheetFooter className="grid gap-2 border-t p-4 sm:grid-cols-2">
            <Button variant="outline" disabled={action.isPending} onClick={() => selected && run({ caseId: selected.case_id, action: 'voice_escalate', note }, 'Added to Voice AI review queue')}><PhoneCall className="mr-2 h-4 w-4" />Voice AI queue</Button>
            <Button disabled={action.isPending || (outcome === 'callback' && !followUp)} onClick={() => selected && run({ caseId: selected.case_id, action: 'outcome', outcome, churnReason: reason || null, snoozedUntil: followUp ? new Date(followUp).toISOString() : null, note }, 'Renewal outcome saved')}><CalendarClock className="mr-2 h-4 w-4" />Save outcome</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}