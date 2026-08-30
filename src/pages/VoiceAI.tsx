import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  PhoneCall, PhoneIncoming, AlertTriangle, ShieldOff, Activity,
  Search, RefreshCw, Info, CheckCircle2, Clock,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import {
  useVoiceOpsSummary, useVoiceCalls, useVoiceAnalytics, type VoiceCallRow,
} from '@/hooks/useVoiceOps';
import {
  dispositionLook, statusLook, actionStateLook, formatDuration,
  DISPOSITION_OPTIONS, STATUS_OPTIONS, isLiveStatus,
} from '@/lib/voice/voiceOutcomes';
import { VoiceCallDetailSheet } from '@/components/voice/VoiceCallDetailSheet';
import { can } from '@/lib/auth/permissions';
import { format } from 'date-fns';

const PAGE_SIZE = 25;
const ALL = '__all__';

function fmt(value?: string | null, pattern = 'dd MMM, HH:mm') {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : format(d, pattern);
}

function Kpi({ label, value, sub, icon: Icon, tone = 'indigo' }: {
  label: string; value: React.ReactNode; sub?: string;
  icon: React.ComponentType<{ className?: string }>; tone?: 'indigo' | 'emerald' | 'amber' | 'red' | 'slate';
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <Card className="rounded-2xl shadow-sm transition-all duration-200 hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`rounded-full p-2 ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-12 text-center">
      <PhoneCall className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function CallsTable({
  rows, isLoading, onOpen, emptyTitle, emptyHint,
}: {
  rows: VoiceCallRow[]; isLoading: boolean; onOpen: (id: string) => void;
  emptyTitle: string; emptyHint: string;
}) {
  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>;
  }
  if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <div className="overflow-x-auto rounded-2xl border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Last visit</TableHead>
            <TableHead>Days absent</TableHead>
            <TableHead>Call time</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Disposition</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const status = statusLook(r.status);
            const disposition = dispositionLook(r.disposition);
            const action = actionStateLook(r.action_state);
            return (
              <TableRow
                key={r.id}
                className="cursor-pointer transition-colors duration-150 hover:bg-muted/50"
                onClick={() => onOpen(r.id)}
              >
                <TableCell>
                  <div className="font-medium text-foreground">{r.member_name ?? 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground">{r.member_code ?? r.masked_phone ?? '—'}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.branch_name ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmt(r.last_visit, 'dd MMM yyyy')}</TableCell>
                <TableCell className="text-sm">{r.days_absent_at_call ?? '—'}</TableCell>
                <TableCell className="text-sm">{fmt(r.call_started_at)}</TableCell>
                <TableCell className="text-sm">{formatDuration(r.duration_seconds)}</TableCell>
                <TableCell>
                  <Badge className={`rounded-full ${status.className}`}>
                    {isLiveStatus(r.status) && <Activity className="mr-1 h-3 w-3" aria-hidden />}
                    {status.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {disposition
                    ? <Badge className={`rounded-full ${disposition.className}`}>{disposition.label}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                  {r.reason_for_absence ?? '—'}
                </TableCell>
                <TableCell>
                  {action
                    ? <Badge className={`rounded-full ${action.className}`}>{action.label}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function VoiceAIPage() {
  const { roles } = useAuth();
  const { effectiveBranchId } = useBranchContext();
  const branchId = effectiveBranchId ?? null;

  const [tab, setTab] = useState('history');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState<string>(ALL);
  const [disposition, setDisposition] = useState<string>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  const canSeeAnalytics = can.viewFinancials(roles) || can.crossBranchView(roles);

  const summaryQ = useVoiceOpsSummary(branchId);
  const integration = summaryQ.data?.integration;
  const today = summaryQ.data?.today ?? {};
  const cap = integration?.daily_call_cap ?? 0;

  const baseFilters = useMemo(() => ({
    branchId,
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
    search: search || null,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [branchId, from, to, search, page]);

  const historyQ = useVoiceCalls({
    ...baseFilters,
    status: status === ALL ? null : status,
    disposition: disposition === ALL ? null : disposition,
  });
  const callbacksQ = useVoiceCalls({ ...baseFilters, offset: 0, disposition: 'callback_requested' });
  const complaintsQ = useVoiceCalls({ ...baseFilters, offset: 0, disposition: 'complaint' });
  const dndQ = useVoiceCalls({ ...baseFilters, offset: 0, disposition: 'wrong_person' });
  const analyticsQ = useVoiceAnalytics(branchId, analyticsDays);

  useRealtimeInvalidate({
    channel: 'voice-ops',
    tables: ['voice_call_attempts'],
    invalidateKeys: [['voice-calls'], ['voice-ops-summary'], ['voice-analytics'], ['voice-call-detail']],
  });

  const total = historyQ.data?.[0]?.total_count ?? 0;
  const readiness = integration?.is_active
    ? { label: 'READY', className: 'bg-emerald-100 text-emerald-700' }
    : integration?.agent_id
      ? { label: 'ACTION REQUIRED', className: 'bg-amber-100 text-amber-700' }
      : { label: 'BLOCKED', className: 'bg-red-100 text-red-700' };

  const a = analyticsQ.data ?? {};
  const pct = (num?: number, den?: number) =>
    !den || !num ? '0%' : `${Math.round((num / den) * 100)}%`;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Voice AI</h1>
            <p className="text-sm text-muted-foreground">Incline Member Care · retention calling operations</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`rounded-full ${readiness.className}`}>{readiness.label}</Badge>
            <Button
              variant="outline" size="sm" className="cursor-pointer"
              onClick={() => { summaryQ.refetch(); historyQ.refetch(); }}
              aria-label="Refresh Voice AI data"
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
            {summaryQ.isLoading ? (
              [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)
            ) : (
              <>
                <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Provider</p><p className="text-sm font-semibold">Sarvam</p></div>
                <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Agent</p><p className="truncate text-sm font-semibold">{integration?.agent_id ?? '—'} {integration?.agent_version ? `· v${integration.agent_version}` : ''}</p></div>
                <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Calling number</p><p className="text-sm font-semibold">{integration?.agent_phone_number ?? '—'}</p></div>
                <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Calling window</p><p className="text-sm font-semibold">{integration?.window_start ?? '—'}–{integration?.window_end ?? '—'} IST</p></div>
                <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Retention automation</p><p className="text-sm font-semibold">{integration?.retention_enabled ? 'Enabled' : 'Disabled'}</p></div>
              </>
            )}
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Kpi label="Today's calls" value={`${today.calls ?? 0} / ${cap}`} sub="Calls used vs daily cap" icon={PhoneCall} />
          <Kpi label="Connected" value={today.connected ?? 0} icon={PhoneIncoming} tone="emerald" />
          <Kpi label="Coming back" value={today.coming_back ?? 0} icon={CheckCircle2} tone="emerald" />
          <Kpi label="Callbacks" value={today.callbacks ?? 0} icon={Clock} tone="indigo" />
          <Kpi label="Complaints" value={today.complaints ?? 0} icon={AlertTriangle} tone="red" />
          <Kpi label="DND / wrong number" value={today.dnd_requests ?? 0} icon={ShieldOff} tone="slate" />
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="history" className="cursor-pointer">Call history</TabsTrigger>
            <TabsTrigger value="queue" className="cursor-pointer">Today's queue</TabsTrigger>
            <TabsTrigger value="callbacks" className="cursor-pointer">Callbacks</TabsTrigger>
            <TabsTrigger value="complaints" className="cursor-pointer">Complaints</TabsTrigger>
            <TabsTrigger value="dnd" className="cursor-pointer">DND</TabsTrigger>
            {canSeeAnalytics && <TabsTrigger value="analytics" className="cursor-pointer">Analytics</TabsTrigger>}
          </TabsList>

          {/* History */}
          <TabsContent value="history" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="grid gap-3 p-4 md:grid-cols-5">
                <div className="md:col-span-2">
                  <Label htmlFor="voice-search" className="text-xs">Search</Label>
                  <div className="flex gap-2">
                    <Input
                      id="voice-search"
                      placeholder="Member, member code or phone"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setPage(0); setSearch(searchInput.trim()); } }}
                    />
                    <Button
                      variant="secondary" className="cursor-pointer" aria-label="Search calls"
                      onClick={() => { setPage(0); setSearch(searchInput.trim()); }}
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="voice-status" className="text-xs">Status</Label>
                  <Select value={status} onValueChange={(v) => { setPage(0); setStatus(v); }}>
                    <SelectTrigger id="voice-status"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{statusLook(s).label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="voice-disposition" className="text-xs">Disposition</Label>
                  <Select value={disposition} onValueChange={(v) => { setPage(0); setDisposition(v); }}>
                    <SelectTrigger id="voice-disposition"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All outcomes</SelectItem>
                      {DISPOSITION_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d}>{dispositionLook(d)?.label ?? d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="voice-from" className="text-xs">From</Label>
                    <Input id="voice-from" type="date" value={from} onChange={(e) => { setPage(0); setFrom(e.target.value); }} />
                  </div>
                  <div>
                    <Label htmlFor="voice-to" className="text-xs">To</Label>
                    <Input id="voice-to" type="date" value={to} onChange={(e) => { setPage(0); setTo(e.target.value); }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <CallsTable
              rows={historyQ.data ?? []}
              isLoading={historyQ.isLoading}
              onOpen={setOpenCallId}
              emptyTitle="No Voice AI calls yet"
              emptyHint="Calls appear here once the retention agent starts dialling, or after a test call is placed from Settings → Integrations → Voice AI."
            />

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(historyQ.data?.length ?? 0) === 0 ? 0 : page * PAGE_SIZE + 1}
                –{page * PAGE_SIZE + (historyQ.data?.length ?? 0)} of {total} results
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="cursor-pointer"
                  disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
                <Button variant="outline" size="sm" className="cursor-pointer"
                  disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </TabsContent>

          {/* Queue */}
          <TabsContent value="queue" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Today's retention queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2 rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p>
                    Eligibility, DND, cooldown, calling window, daily cap and concurrency are decided by the
                    Voice AI backend — this screen never computes or overrides them, and there is no manual
                    dial action. Run the eligibility check from Settings → Integrations → Voice AI to see
                    today's breakdown; live calls appear in Call history the moment they start.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Kpi label="Calls in progress" value={today.in_progress ?? 0} icon={Activity} tone="indigo" />
                  <Kpi label="Used today" value={`${today.calls ?? 0} / ${cap}`} icon={PhoneCall} />
                  <Kpi label="Minimum absence" value={`${integration?.min_absent_days ?? 7} days`} sub={`Cooldown ${integration?.cooldown_days ?? 7} days`} icon={Clock} tone="slate" />
                </div>

                {queueQ.isError ? (
                  <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Could not load the queue. Refresh to try again.
                  </div>
                ) : queueQ.isLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
                  </div>
                ) : (queueQ.data ?? []).length === 0 ? (
                  <EmptyState
                    title="No members due for a retention call"
                    hint="Members appear here once the backend considers them eligible — absent long enough, contactable, and outside cooldown."
                  />
                ) : (
                  <div className="overflow-x-auto rounded-2xl border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Last visit</TableHead>
                          <TableHead>Days absent</TableHead>
                          <TableHead>Plan expiry</TableHead>
                          <TableHead>Trainer</TableHead>
                          <TableHead>Last outcome</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(queueQ.data ?? []).map((q) => {
                          const disp = dispositionLook(q.last_disposition);
                          const clickable = !!q.last_call_id;
                          return (
                            <TableRow
                              key={q.member_id}
                              className={clickable ? 'cursor-pointer transition-colors duration-150 hover:bg-muted/50' : ''}
                              onClick={() => q.last_call_id && setOpenCallId(q.last_call_id)}
                            >
                              <TableCell>
                                <div className="font-medium text-foreground">{q.member_name ?? 'Unknown'}</div>
                                <div className="text-xs text-muted-foreground">
                                  {q.member_code ?? '—'}
                                  {q.masked_phone ? ` · ${q.masked_phone}` : ''}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{fmt(q.last_visit, 'dd MMM yyyy')}</TableCell>
                              <TableCell className="text-sm">{q.days_absent ?? '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{fmt(q.plan_expiry, 'dd MMM yyyy')}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{q.trainer_name ?? '—'}</TableCell>
                              <TableCell>
                                {disp
                                  ? <Badge className={`rounded-full ${disp.className}`}>{disp.label}</Badge>
                                  : <span className="text-xs text-muted-foreground">Never called</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}


          <TabsContent value="callbacks">
            <CallsTable
              rows={callbacksQ.data ?? []} isLoading={callbacksQ.isLoading} onOpen={setOpenCallId}
              emptyTitle="No callbacks requested"
              emptyHint="When a member asks the agent to call back, the existing task system creates a follow-up and it shows here."
            />
          </TabsContent>

          <TabsContent value="complaints">
            <CallsTable
              rows={complaintsQ.data ?? []} isLoading={complaintsQ.isLoading} onOpen={setOpenCallId}
              emptyTitle="No complaints raised"
              emptyHint="Complaints raised on a Voice AI call create an urgent manager task and are listed here."
            />
          </TabsContent>

          <TabsContent value="dnd">
            <div className="mb-3 flex items-start gap-2 rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
              <ShieldOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>Do-not-contact is owned by the existing contact-preference system. This view is read-only and cannot be bypassed.</p>
            </div>
            <CallsTable
              rows={dndQ.data ?? []} isLoading={dndQ.isLoading} onOpen={setOpenCallId}
              emptyTitle="No DND requests from Voice AI"
              emptyHint="Calls that reached the wrong person automatically mark the number do-not-contact and appear here."
            />
          </TabsContent>

          {canSeeAnalytics && (
            <TabsContent value="analytics" className="space-y-4">
              <div className="flex gap-2">
                {[7, 30, 90].map((d) => (
                  <Button
                    key={d} size="sm" className="cursor-pointer"
                    variant={analyticsDays === d ? 'default' : 'outline'}
                    onClick={() => setAnalyticsDays(d)}
                  >
                    {d} days
                  </Button>
                ))}
              </div>
              {analyticsQ.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi label="Attempted" value={a.attempted ?? 0} icon={PhoneCall} />
                    <Kpi label="Connected" value={a.connected ?? 0} sub={pct(a.connected, a.attempted)} icon={PhoneIncoming} tone="emerald" />
                    <Kpi label="Completed" value={a.completed ?? 0} sub={pct(a.completed, a.attempted)} icon={CheckCircle2} tone="emerald" />
                    <Kpi label="No answer" value={a.no_answer ?? 0} sub={pct(a.no_answer, a.attempted)} icon={Clock} tone="slate" />
                    <Kpi label="Coming back (stated)" value={a.coming_back ?? 0} sub={pct(a.coming_back, a.attempted)} icon={CheckCircle2} tone="emerald" />
                    <Kpi label="Callbacks" value={a.callback_requested ?? 0} sub={pct(a.callback_requested, a.attempted)} icon={Clock} tone="indigo" />
                    <Kpi label="Complaints" value={a.complaint ?? 0} sub={pct(a.complaint, a.attempted)} icon={AlertTriangle} tone="red" />
                    <Kpi label="Wrong person / DND" value={a.wrong_person ?? 0} sub={pct(a.wrong_person, a.attempted)} icon={ShieldOff} tone="slate" />
                  </div>
                  <Card className="rounded-2xl shadow-sm">
                    <CardHeader><CardTitle className="text-base">Actual returns after a call</CardTitle></CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-3">
                      <Kpi label="Members contacted" value={a.contacted_members ?? 0} icon={PhoneIncoming} />
                      <Kpi label="Returned within 7 days" value={a.returned_within_7 ?? 0} sub={pct(a.returned_within_7, a.contacted_members)} icon={CheckCircle2} tone="emerald" />
                      <Kpi label="Returned within 14 days" value={a.returned_within_14 ?? 0} sub={pct(a.returned_within_14, a.contacted_members)} icon={CheckCircle2} tone="emerald" />
                    </CardContent>
                    <CardContent className="pt-0">
                      <p className="text-xs text-muted-foreground">
                        Returns are counted from real gym check-ins after the call. “Coming back” is only a stated intention.
                      </p>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      <VoiceCallDetailSheet
        callId={openCallId}
        open={!!openCallId}
        onOpenChange={(v) => { if (!v) setOpenCallId(null); }}
      />
    </AppLayout>
  );
}
