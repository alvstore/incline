import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Search,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  Mail,
  MessageCircle,
  Bell,
  Users,
  FileText,
  CalendarDays,
  AlertTriangle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  searchMembersForAssignment,
  assignPlanToMembers,
  fetchScheduleOffsetLoad,
  loadMemberContacts,
  BulkAssignResult,
  NotificationChannel,
} from '@/services/fitnessService';
import {
  WEEKDAY_SHORT,
  describeOffset,
  normalizeOffset,
  rotationVariants,
  suggestOffsets,
} from '@/lib/fitness/planRotation';
import { sendPlanToMember } from '@/utils/sendPlanToMember';

import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  PLAN_DURATION_PRESETS,
  planEndDateISO,
  recommendedPresetDays,
  todayISO,
} from '@/lib/fitness/planDuration';

interface MemberLite {
  id: string;
  member_code: string;
  full_name: string;
}

interface AssignPlanDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: {
    name: string;
    type: 'workout' | 'diet';
    description?: string;
    content: any;
    /** Optional: template this plan was loaded from. */
    template_id?: string | null;
    /** Pre-selects the "Common Plan" toggle. */
    is_common?: boolean;
    /** PDF-template support */
    source_kind?: 'structured' | 'pdf';
    pdf_url?: string | null;
    pdf_filename?: string | null;
    pdf_size_bytes?: number | null;
  } | null;
  branchId?: string;
}

const CHANNEL_META: { value: NotificationChannel; label: string; Icon: typeof Mail }[] = [
  { value: 'email', label: 'Email', Icon: Mail },
  { value: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { value: 'in_app', label: 'In-app', Icon: Bell },
];

function getPlanDurationWeeks(plan: AssignPlanDrawerProps['plan']): number {
  if (!plan) return 4;
  const c: any = plan.content || {};
  if (typeof c.durationWeeks === 'number' && c.durationWeeks > 0) return c.durationWeeks;
  if (Array.isArray(c.weeks) && c.weeks.length > 0) return c.weeks.length;
  if (Array.isArray(c.schedule) && c.schedule.length > 0) return Math.max(1, Math.ceil(c.schedule.length / 7));
  return 4;
}

function safeFmt(iso: string, pattern = 'dd MMM yyyy'): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '—';
    return format(d, pattern);
  } catch {
    return iso || '—';
  }
}

export function AssignPlanDrawer({ open, onOpenChange, plan, branchId }: AssignPlanDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<MemberLite[]>([]);
  const planWeeks = getPlanDurationWeeks(plan);
  const recommendedDays = recommendedPresetDays(planWeeks);
  const [startDate, setStartDate] = useState(todayISO());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [durationDays, setDurationDays] = useState<number | 'custom'>(recommendedDays);
  const [customValidUntil, setCustomValidUntil] = useState(planEndDateISO(todayISO(), recommendedDays));
  // Deliver everywhere by default — members should get the plan instantly on
  // in-app, WhatsApp and Email (with the PDF attached).
  const [channels, setChannels] = useState<NotificationChannel[]>(['in_app', 'whatsapp', 'email']);
  const [sendPdf, setSendPdf] = useState(true);
  const [isCommon, setIsCommon] = useState(false);
  // Floor load balancing (workout plans only): stagger each member's week so the
  // same plan doesn't send everyone to the same machine on the same day.
  const [autoStagger, setAutoStagger] = useState(true);
  const [manualOffset, setManualOffset] = useState(0);
  const [rotationInterval, setRotationInterval] = useState(0);
  const [results, setResults] = useState<BulkAssignResult[] | null>(null);
  const queryClient = useQueryClient();

  const isWorkout = plan?.type === 'workout';

  const { data: offsetLoad = {} } = useQuery({
    queryKey: ['workout-offset-load', branchId],
    queryFn: () => fetchScheduleOffsetLoad(branchId),
    enabled: open && isWorkout,
    staleTime: 60_000,
  });

  const hasVariants = rotationVariants(plan?.content).length > 0;

  /** member_id → weekday shift for this assignment. */
  const scheduleOffsets = useMemo(() => {
    if (!isWorkout) return {};
    const ids = selected.map((m) => m.id);
    const picks = autoStagger
      ? suggestOffsets(offsetLoad as Record<number, number>, ids.length)
      : ids.map(() => normalizeOffset(manualOffset));
    return Object.fromEntries(ids.map((id, i) => [id, picks[i] ?? 0]));
  }, [isWorkout, selected, autoStagger, manualOffset, offsetLoad]);


  const validUntil =
    durationDays === 'custom' ? customValidUntil : planEndDateISO(startDate, durationDays);

  const selectedDays = useMemo(() => {
    if (durationDays !== 'custom') return durationDays;
    const start = new Date(startDate).getTime();
    const end = new Date(customValidUntil).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return 0;
    return Math.max(0, Math.round((end - start) / 86400000) + 1);
  }, [durationDays, startDate, customValidUntil]);

  const contentDays = planWeeks * 7;
  const isShortWindow = selectedDays > 0 && selectedDays < contentDays;

  // Reset every time the drawer is reopened. Pre-fill the Common toggle from
  // the incoming template (so common templates default to common assignments).
  // Auto-recompute validity from the plan's own duration unless the user
  // has explicitly overridden it.
  useEffect(() => {
    if (open) {
      setResults(null);
      setSearchQuery('');
      setIsCommon(!!plan?.is_common);
      setStartDate(todayISO());
      setShowStartPicker(false);
      setDurationDays(recommendedDays);
      setCustomValidUntil(planEndDateISO(todayISO(), recommendedDays));
    }
     
  }, [open, plan?.is_common, recommendedDays]);

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['member-search-multi', searchQuery, branchId],
    queryFn: () => searchMembersForAssignment(searchQuery, branchId),
    enabled: searchQuery.length >= 2,
  });

  // Merge selected + search results so selected members survive a re-search
  const visible: MemberLite[] = useMemo(() => {
    if (searchQuery.length < 2) return selected;
    const ids = new Set(selected.map((m) => m.id));
    return [
      ...selected,
      ...searchResults.filter((m) => !ids.has(m.id)),
    ];
  }, [searchResults, selected, searchQuery]);

  const isSelected = (id: string) => selected.some((m) => m.id === id);

  const toggleMember = (m: MemberLite) => {
    setSelected((prev) =>
      prev.some((p) => p.id === m.id) ? prev.filter((p) => p.id !== m.id) : [...prev, m],
    );
  };

  const selectAll = () => {
    const ids = new Set(selected.map((m) => m.id));
    setSelected([...selected, ...searchResults.filter((m) => !ids.has(m.id))]);
  };

  const clearAll = () => setSelected([]);

  const toggleChannel = (c: NotificationChannel) => {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      const data = await assignPlanToMembers({
        member_ids: selected.map((m) => m.id),
        plan_name: plan!.name,
        plan_type: plan!.type,
        description: plan!.description,
        plan_data: plan!.content,
        is_custom: true,
        valid_from: startDate,
        valid_until: validUntil,
        branch_id: branchId,
        channels,
        template_id: plan?.template_id ?? null,
        is_common: isCommon,
        source_kind: plan?.source_kind ?? 'structured',
        pdf_url: plan?.pdf_url ?? null,
        pdf_filename: plan?.pdf_filename ?? null,
        pdf_size_bytes: plan?.pdf_size_bytes ?? null,
      });

      // If "Send PDF on assign" is enabled, dispatch PDFs to whichever
      // channels (whatsapp / email) are also selected. Best-effort: errors
      // are surfaced via toast but don't block the assignment success path.
      const pdfChannels: ('whatsapp' | 'email')[] = [];
      if (sendPdf && channels.includes('whatsapp')) pdfChannels.push('whatsapp');
      if (sendPdf && channels.includes('email')) pdfChannels.push('email');

      if (sendPdf && pdfChannels.length > 0) {
        const memberIds = data.filter((r) => r.success).map((r) => r.member_id);
        if (memberIds.length > 0) {
          // Contact details live on `profiles`, not on `members`.
          const contacts = await loadMemberContacts(memberIds);
          let pdfFailures = 0;
          for (const r of data) {
            if (!r.success) continue;
            const m = contacts.get(r.member_id);
            if (!m) continue;
            try {
              const res = await sendPlanToMember({
                member: { id: m.id, full_name: m.full_name, phone: m.phone, email: m.email },
                plan: {
                  name: plan!.name,
                  type: plan!.type,
                  description: plan!.description,
                  data: plan!.content,
                  valid_from: startDate,
                  valid_until: validUntil,
                },
                branchId: branchId || m.branch_id || undefined,
                channels: pdfChannels,
              });
              if (pdfChannels.some((c) => res.channels[c]?.sent === false)) pdfFailures++;
            } catch (e) {
              pdfFailures++;
            }
          }
          if (pdfFailures > 0) {
            toast.warning(`PDF delivery failed for ${pdfFailures} member${pdfFailures === 1 ? '' : 's'}`);
          }
        }
      }

      return data;
    },
    onSuccess: (data) => {
      const ok = data.filter((r) => r.success).length;
      toast.success(`Assigned plan to ${ok} of ${data.length} members`);
      queryClient.invalidateQueries({ queryKey: ['member-fitness-plans'] });
      queryClient.invalidateQueries({ queryKey: ['fitness-member-assignments'] });
      setResults(data);
      setSelected([]);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to assign plan'),
  });

  const closeAndReset = () => {
    onOpenChange(false);
    setTimeout(() => {
      setResults(null);
      setSelected([]);
      setSearchQuery('');
    }, 200);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        <SheetHeader className="px-5 py-4 border-b text-left">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {results ? 'Assignment Confirmation' : 'Assign Plan to Members'}
          </SheetTitle>
          {plan && !results && (
            <SheetDescription>
              <span className="font-medium text-foreground">{plan.name}</span> — {plan.type} plan
              {!results && (
                <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                  {selectedDays > 0 ? `${selectedDays} days` : `${planWeeks} ${planWeeks === 1 ? 'week' : 'weeks'}`}
                </span>
              )}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {results ? (
            <ConfirmationView results={results} channels={channels} />
          ) : (
            <div className="space-y-4">
              {/* Member Search */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Members</Label>
                  <span className="text-xs text-muted-foreground">
                    {selected.length} selected
                  </span>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, email, or code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {searchQuery.length >= 2 && (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={selectAll} disabled={searchResults.length === 0}>
                      Select all
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={clearAll} disabled={selected.length === 0}>
                      Clear all
                    </Button>
                  </div>
                )}

                <ScrollArea className="border rounded-md max-h-56">
                  {isSearching ? (
                    <div className="p-3 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    </div>
                  ) : visible.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      {searchQuery.length < 2
                        ? 'Type at least 2 characters to search.'
                        : 'No members found.'}
                    </div>
                  ) : (
                    visible.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleMember(member)}
                        className={`w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 border-b last:border-b-0 ${
                          isSelected(member.id) ? 'bg-accent/10' : ''
                        }`}
                      >
                        <Checkbox checked={isSelected(member.id)} onCheckedChange={() => toggleMember(member)} />
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 text-sm">{member.full_name}</span>
                        <Badge variant="outline" className="text-[10px]">{member.member_code}</Badge>
                      </button>
                    ))
                  )}
                </ScrollArea>
              </div>

              <Separator />

              {/* Duration presets — staff pick a length, we compute the dates */}
              <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Plan Duration
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Recommended · {recommendedDays} days
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {PLAN_DURATION_PRESETS.map((p) => {
                    const active = durationDays === p.days;
                    return (
                      <button
                        key={p.days}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setDurationDays(p.days)}
                        className={`min-h-[44px] cursor-pointer rounded-full border px-3.5 py-1.5 text-left transition focus:outline-none focus:ring-2 focus:ring-primary ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:bg-muted'
                        }`}
                      >
                        <span className="block text-sm font-semibold leading-tight">{p.days} days</span>
                        <span className={`block text-[10px] leading-tight ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
                          {p.label}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={durationDays === 'custom'}
                    onClick={() => {
                      setCustomValidUntil(validUntil);
                      setDurationDays('custom');
                    }}
                    className={`min-h-[44px] cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-primary ${
                      durationDays === 'custom'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border hover:bg-muted'
                    }`}
                  >
                    Custom date
                  </button>
                </div>

                {durationDays === 'custom' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="custom-valid-until">Valid until</Label>
                    <Input
                      id="custom-valid-until"
                      type="date"
                      min={startDate}
                      value={customValidUntil}
                      onChange={(e) => setCustomValidUntil(e.target.value)}
                    />
                  </div>
                )}

                <div className="rounded-xl bg-muted/40 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>
                      Starts{' '}
                      <span className="font-medium text-foreground">
                        {startDate === todayISO() ? 'today' : safeFmt(startDate)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowStartPicker((v) => !v)}
                      className="ml-auto cursor-pointer text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
                    >
                      {showStartPicker ? 'Done' : 'Change'}
                    </button>
                  </div>

                  {showStartPicker && (
                    <div className="space-y-1.5 pt-1">
                      <Label htmlFor="plan-start-date">Start date</Label>
                      <Input
                        id="plan-start-date"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="text-sm">
                    <span className="text-muted-foreground">Ends </span>
                    <span className="font-bold text-foreground">{safeFmt(validUntil, 'EEE, dd MMM yyyy')}</span>
                    {selectedDays > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({selectedDays} days)</span>
                    )}
                  </div>
                </div>

                {isShortWindow && (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-2.5">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
                    <p className="text-xs text-foreground/80">
                      This plan contains {planWeeks} {planWeeks === 1 ? 'week' : 'weeks'} of content — members
                      will lose access before finishing it.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Notify on
                </Label>
                <div className="flex flex-wrap gap-2">
                  {CHANNEL_META.map(({ value, label, Icon }) => {
                    const active = channels.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleChannel(value)}
                        className={`flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-primary ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:bg-muted'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border bg-success/5 border-success/25 p-3 flex items-start gap-3">
                <Users className="h-4 w-4 mt-0.5 text-success" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="is-common-toggle" className="text-sm font-medium cursor-pointer">
                      Mark as Common Plan (no PT required)
                    </Label>
                    <Switch id="is-common-toggle" checked={isCommon} onCheckedChange={setIsCommon} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Common plans are shared across walk-in members who aren't on personal training.
                  </p>
                </div>
              </div>

              {(channels.includes('whatsapp') || channels.includes('email')) && (
                <div className="rounded-xl border bg-muted/30 p-3 flex items-start gap-3">
                  <FileText className="h-4 w-4 mt-0.5 text-primary" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="send-pdf-toggle" className="text-sm font-medium cursor-pointer">
                        Send PDF on assign
                      </Label>
                      <Switch id="send-pdf-toggle" checked={sendPdf} onCheckedChange={setSendPdf} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Generates a styled PDF of this plan and delivers it via the selected
                      WhatsApp / Email channels alongside the notification.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3 flex flex-row gap-2 bg-background">
          {results ? (
            <Button onClick={closeAndReset} className="w-full">Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => assignMutation.mutate()}
                disabled={selected.length === 0 || !plan || assignMutation.isPending}
                className="flex-1"
              >
                {assignMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  `Assign to ${selected.length} member${selected.length === 1 ? '' : 's'}`
                )}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConfirmationView({
  results,
  channels,
}: {
  results: BulkAssignResult[];
  channels: NotificationChannel[];
}) {
  const successCount = results.filter((r) => r.success).length;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Plan assigned to <span className="font-medium text-foreground">{successCount}</span> of {results.length} members.
      </div>
      <ScrollArea className="max-h-[55vh] pr-3">
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.member_id} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {r.success ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-medium">{r.member_name}</span>
                </div>
                {!r.success && r.error && (
                  <span className="text-[11px] text-destructive">{r.error}</span>
                )}
              </div>
              {channels.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {channels.map((c) => {
                    const meta = CHANNEL_META.find((m) => m.value === c)!;
                    const Icon = meta.Icon;
                    const ch = r.channels[c];
                    const ok = ch?.sent;
                    return (
                      <div
                        key={c}
                        className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${
                          ok
                            ? 'bg-success/10 text-success border-success/30'
                            : 'bg-destructive/10 text-destructive border-destructive/30'
                        }`}
                        title={ch?.error || (ok ? 'Sent' : 'Not sent')}
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label}: {ok ? 'sent' : ch?.error || 'failed'}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
