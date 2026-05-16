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
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  searchMembersForAssignment,
  assignPlanToMembers,
  BulkAssignResult,
  NotificationChannel,
} from '@/services/fitnessService';
import { sendPlanToMember } from '@/utils/sendPlanToMember';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, addWeeks } from 'date-fns';

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

export function AssignPlanDrawer({ open, onOpenChange, plan, branchId }: AssignPlanDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<MemberLite[]>([]);
  const planWeeks = getPlanDurationWeeks(plan);
  const [validUntil, setValidUntil] = useState(format(addWeeks(new Date(), planWeeks), 'yyyy-MM-dd'));
  const [validityOverridden, setValidityOverridden] = useState(false);
  const [channels, setChannels] = useState<NotificationChannel[]>(['in_app']);
  const [sendPdf, setSendPdf] = useState(false);
  const [isCommon, setIsCommon] = useState(false);
  const [results, setResults] = useState<BulkAssignResult[] | null>(null);
  const queryClient = useQueryClient();

  // Reset every time the drawer is reopened. Pre-fill the Common toggle from
  // the incoming template (so common templates default to common assignments).
  // Auto-recompute validity from the plan's own duration unless the user
  // has explicitly overridden it.
  useEffect(() => {
    if (open) {
      setResults(null);
      setSearchQuery('');
      setIsCommon(!!plan?.is_common);
      setValidityOverridden(false);
      setValidUntil(format(addWeeks(new Date(), planWeeks), 'yyyy-MM-dd'));
    }
     
  }, [open, plan?.is_common, planWeeks]);

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
          const { data: members } = await supabase
            .from('members')
            .select('id, full_name, phone, email')
            .in('id', memberIds);
          const memberMap = new Map((members || []).map((m: any) => [m.id, m]));
          let pdfFailures = 0;
          for (const r of data) {
            if (!r.success) continue;
            const m = memberMap.get(r.member_id);
            if (!m) continue;
            try {
              await sendPlanToMember({
                member: { id: m.id, full_name: m.full_name, phone: m.phone, email: m.email },
                plan: {
                  name: plan!.name,
                  type: plan!.type,
                  description: plan!.description,
                  data: plan!.content,
                  valid_until: validUntil,
                },
                branchId,
                channels: pdfChannels,
              });
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
                  {planWeeks} {planWeeks === 1 ? 'week' : 'weeks'}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    <span>Valid Until</span>
                    {!validityOverridden && (
                      <span className="text-[10px] font-normal text-muted-foreground">Auto · {planWeeks}w</span>
                    )}
                  </Label>
                  <Input
                    type="date"
                    value={validUntil}
                    onChange={(e) => { setValidUntil(e.target.value); setValidityOverridden(true); }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notify on</Label>
                  <div className="flex flex-wrap gap-2">
                    {CHANNEL_META.map(({ value, label, Icon }) => {
                      const active = channels.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleChannel(value)}
                          className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition ${
                            active
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-border hover:bg-muted'
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-emerald-500/5 border-emerald-200/50 p-3 flex items-start gap-3">
                <Users className="h-4 w-4 mt-0.5 text-emerald-600" />
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
