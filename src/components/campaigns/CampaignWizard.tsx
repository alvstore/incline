import { useState, useEffect } from 'react';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
} from '@/components/ui/ResponsiveSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, MessageSquare, Mail, Send, Save, Loader2, Megaphone, Clock, Paperclip, ImageIcon, FileText, Film, X, Sparkles, Wand2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { supabase } from '@/integrations/supabase/client';
import { AudienceBuilder } from './AudienceBuilder';
import {
  type AudienceFilter,
  type AudienceBreakdown,
  type CampaignChannel,
  type CampaignTriggerType,
  type RecurrencePreset,
  type Campaign,
  createCampaign,
  updateCampaign,
  createRecurringCampaignRule,
  recurrencePresetToCron,
  sendCampaignNow,
} from '@/services/campaignService';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ShieldCheck } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  editingCampaign?: Campaign | null;
}

const VARIABLES = ['{{member_name}}', '{{member_code}}', '{{first_name}}', '{{branch_name}}'];

type CampaignType = 'promotion' | 'event' | 'announcement' | 'lead_reengagement';

const CAMPAIGN_TYPES: { id: CampaignType; label: string; desc: string; emoji: string; color: string }[] = [
  { id: 'promotion', label: 'Promotion', desc: 'Offers, discounts, deals', emoji: '🎁', color: 'violet' },
  { id: 'event', label: 'Event / Class', desc: 'Workshops, special classes', emoji: '📅', color: 'amber' },
  { id: 'announcement', label: 'Announcement', desc: 'Updates, news, notices', emoji: '📢', color: 'blue' },
  { id: 'lead_reengagement', label: 'Lead Re-engagement', desc: 'Win back cold leads', emoji: '🔁', color: 'emerald' },
];

export function CampaignWizard({ open, onOpenChange, branchId, editingCampaign }: Props) {
  const qc = useQueryClient();
  const isEditing = !!editingCampaign;
  const [step, setStep] = useState(1);
  const [campaignType, setCampaignType] = useState<CampaignType>('announcement');
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<CampaignChannel>('whatsapp');
  const [filter, setFilter] = useState<AudienceFilter>({ status: 'active' });
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventVenue, setEventVenue] = useState('');
  const [eventRsvpUrl, setEventRsvpUrl] = useState('');
  const [resolvedMemberIds, setResolvedMemberIds] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState<AudienceBreakdown | null>(null);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [trigger, setTrigger] = useState<CampaignTriggerType>('send_now');
  const [scheduledAt, setScheduledAt] = useState<string>(''); // datetime-local value
  const [submitting, setSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; filename: string; kind: 'image' | 'document' | 'video' } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [submittingMeta, setSubmittingMeta] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrencePreset>('weekly_mon');
  const [customCron, setCustomCron] = useState('0 10 * * 1');

  // Approved Meta WhatsApp template (cold-audience-compliant path)
  const [useApprovedTemplate, setUseApprovedTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [syncingTemplates, setSyncingTemplates] = useState(false);

  // Source of truth = `whatsapp_templates` (Meta cache) so anything Meta has approved
  // is selectable, even if there's no local CRM `templates` row yet.
  // We left-join `templates.id` by meta_template_name so the send pipeline still
  // receives a valid `template_id` UUID.
  const { data: approvedTemplates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['approved-whatsapp-templates', branchId],
    queryFn: async () => {
      let q = supabase
        .from('whatsapp_templates')
        .select('id, name, language, category, components, branch_id, status')
        .eq('status', 'APPROVED');
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data: meta, error } = await q.order('name');
      if (error) throw error;

      const names = (meta || []).map((m: any) => m.name);
      const { data: locals } = names.length
        ? await supabase
            .from('templates')
            .select('id, meta_template_name, header_type, header_media_url')
            .in('meta_template_name', names)
        : { data: [] as any[] };

      const byName = new Map<string, any>();
      for (const l of (locals || [])) byName.set(l.meta_template_name, l);

      return (meta || []).map((m: any) => {
        const local = byName.get(m.name);
        const bodyText = (m.components || []).find((c: any) => c?.type === 'BODY')?.text || '';
        const headerComp = (m.components || []).find((c: any) => c?.type === 'HEADER');
        const headerFmt = (headerComp?.format || 'NONE').toLowerCase();
        return {
          id: local?.id || null, // local templates.id (UUID) for the send pipeline
          name: m.name,
          language: m.language || 'en',
          category: m.category,
          header_type: local?.header_type || headerFmt,
          content: bodyText,
          meta_template_status: 'APPROVED' as const,
          meta_template_name: m.name,
        };
      });
    },
    enabled: open && channel === 'whatsapp',
  });

  // Realtime: any change in whatsapp_templates / templates re-fetches the picker.
  useEffect(() => {
    if (!open || channel !== 'whatsapp') return;
    const ch = supabase
      .channel('campaign-wizard-templates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_templates' }, () => refetchTemplates())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'templates' }, () => refetchTemplates())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, channel, refetchTemplates]);

  // ─── Evergreen template library ────────────────────────────────────────────
  // Pull the active evergreen `templates` rows that match the current campaign
  // type + channel. These are reusable, generic bodies (seeded globally) that
  // the wizard auto-picks so the marketer doesn't need fresh Meta approval per
  // campaign. When the linked `meta_template_name` is APPROVED in
  // `whatsapp_templates`, we auto-toggle the "send via approved template" mode
  // and pre-select the local templates.id.
  const { data: evergreenTemplates = [] } = useQuery({
    queryKey: ['evergreen-templates', channel, campaignType, branchId],
    queryFn: async () => {
      let q = supabase
        .from('templates')
        .select('id, name, content, subject, header_type, meta_template_name, meta_template_status, evergreen_kind, branch_id, variables')
        .eq('is_evergreen', true)
        .eq('is_active', true)
        .eq('type', channel)
        .eq('evergreen_kind', campaignType);
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data, error } = await q.order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: open && (channel === 'whatsapp' || channel === 'email' || channel === 'sms'),
  });

  const [evergreenAppliedFor, setEvergreenAppliedFor] = useState<string | null>(null);
  const [evergreenPickedName, setEvergreenPickedName] = useState<string | null>(null);

  // Auto-apply evergreen on campaign-type / channel switch (only when not editing
  // and user hasn't typed a custom message yet, or when the prior body came from
  // a different evergreen).
  useEffect(() => {
    if (!open || isEditing) return;
    const key = `${channel}:${campaignType}`;
    if (evergreenAppliedFor === key) return;
    const ever = (evergreenTemplates as any[])[0];
    if (!ever) {
      // No evergreen for this combo — keep whatever the user has.
      setEvergreenAppliedFor(key);
      return;
    }
    // Don't blow away user's custom edits — only apply if message is empty or
    // still matches the previously-applied evergreen body.
    const messageIsCustom = message.trim().length > 0 &&
      !(evergreenPickedName && message.trim() === (evergreenTemplates as any[])
        .find((t: any) => t.name === evergreenPickedName)?.content?.trim());
    if (!messageIsCustom) {
      setMessage(ever.content || '');
      if (channel === 'email' && ever.subject) setSubject(ever.subject);
      setEvergreenPickedName(ever.name);
      // If the linked Meta template is APPROVED, auto-route through the
      // approved-template path so cold recipients don't get blocked.
      if (channel === 'whatsapp' && ever.id && ever.meta_template_status === 'approved') {
        setUseApprovedTemplate(true);
        setSelectedTemplateId(ever.id);
      }
    }
    setEvergreenAppliedFor(key);
  }, [open, isEditing, channel, campaignType, evergreenTemplates, evergreenAppliedFor, evergreenPickedName, message]);


  const handleSyncFromMeta = async () => {
    if (!branchId) { toast.error('No branch available'); return; }
    setSyncingTemplates(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: { action: 'list', branch_id: branchId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Synced ${data?.templates?.length || 0} templates from Meta`);
      await refetchTemplates();
    } catch (e: any) {
      toast.error(e?.message || 'Sync failed');
    } finally {
      setSyncingTemplates(false);
    }
  };

  // Auto-prefill from a saved segment (set by Contact Book → Segments → Send) — skip when editing.
  useEffect(() => {
    if (isEditing) return;
    const segId = sessionStorage.getItem('campaign_prefill_segment');
    const segName = sessionStorage.getItem('campaign_prefill_segment_name');
    if (segId) {
      setFilter({ audience_kind: 'segment', segment_id: segId });
      if (segName) setName(`Segment: ${segName}`);
      sessionStorage.removeItem('campaign_prefill_segment');
      sessionStorage.removeItem('campaign_prefill_segment_name');
    }
  }, [isEditing]);

  // Pre-fill all fields when editing an existing campaign.
  useEffect(() => {
    if (!open || !editingCampaign) return;
    const c = editingCampaign;
    setCampaignType((c.campaign_type as CampaignType) || 'announcement');
    setName(c.name);
    setChannel(c.channel);
    setFilter(c.audience_filter || { status: 'active' });
    setMessage(c.message || '');
    setSubject(c.subject || '');
    setTrigger(c.trigger_type || 'send_now');
    setScheduledAt(c.scheduled_at ? c.scheduled_at.slice(0, 16) : '');
    if (c.attachment_url && c.attachment_kind) {
      setAttachment({
        url: c.attachment_url,
        filename: c.attachment_filename || 'attachment',
        kind: c.attachment_kind,
      });
    } else {
      setAttachment(null);
    }
    const ev: any = c.event_meta || {};
    setEventName(ev.name || '');
    setEventDate(ev.date || '');
    setEventTime(ev.time || '');
    setEventVenue(ev.venue || '');
    setEventRsvpUrl(ev.rsvp_url || '');
    if (c.template_id) {
      setUseApprovedTemplate(true);
      setSelectedTemplateId(c.template_id);
    } else {
      setUseApprovedTemplate(false);
      setSelectedTemplateId(null);
    }
  }, [open, editingCampaign?.id]);



  const handleSubmitMetaTemplate = async () => {
    if (channel !== 'whatsapp') return;
    if (!message.trim()) { toast.error('Draft a message first'); return; }

    // Category by campaign type — Meta rejects mis-categorized templates.
    const category =
      campaignType === 'promotion' || campaignType === 'event' || campaignType === 'lead_reengagement'
        ? 'MARKETING'
        : 'UTILITY';

    setSubmittingMeta(true);
    try {
      const safeName = (name || `campaign_${Date.now()}`).toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 48);

      // Create a local CRM row first so the Meta sync + send pipeline can resolve it.
      const { data: localRow, error: localErr } = await supabase
        .from('templates')
        .insert({
          branch_id: branchId,
          type: 'whatsapp',
          name: safeName,
          content: message.trim(),
          is_active: true,
          header_type: attachment?.kind || 'none',
          header_media_url: attachment?.url || null,
        })
        .select('id')
        .single();
      if (localErr) throw localErr;

      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: {
          action: 'create',
          branch_id: branchId,
          template_data: {
            name: safeName,
            category,
            language: 'en',
            body_text: message.trim(),
            local_template_id: localRow!.id,
            header_type: attachment?.kind === 'image' ? 'image'
              : attachment?.kind === 'video' ? 'video'
              : attachment?.kind === 'document' ? 'document'
              : 'none',
            header_sample_url: attachment?.url || undefined,
          },
        },
      });
      if (error) throw error;
      const r = data as any;
      if (r?.success === false) {
        const detail = r?.meta_error?.user_msg || r?.meta_error?.message || r?.error || 'Meta rejected the template';
        toast.error(`Meta rejected: ${detail}`, { duration: 9000 });
        return;
      }
      toast.success(`Submitted to Meta as "${r?.name}" — status: ${r?.status || 'PENDING'}`);
      qc.invalidateQueries({ queryKey: ['approved-whatsapp-templates'] });
      qc.invalidateQueries({ queryKey: ['communication-templates'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to submit to Meta');
    } finally { setSubmittingMeta(false); }
  };

  const handleAiDraft = async () => {
    if (!aiPrompt.trim()) { toast.error('Describe the campaign first'); return; }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-draft-campaign-message', {
        body: {
          channel,
          campaign_type: campaignType,
          prompt: aiPrompt.trim(),
          event_meta: campaignType === 'event' ? {
            name: eventName, date: eventDate, time: eventTime, venue: eventVenue, rsvp_url: eventRsvpUrl,
          } : undefined,
        },
      });
      if (error) throw error;
      const p = (data as any)?.proposal;
      if (!p) throw new Error('No draft returned');
      setMessage(p.body || '');
      if (channel === 'email') {
        if (p.subject) setSubject(p.subject);
      }
      toast.success('AI draft inserted — review and edit before sending');
      setAiOpen(false);
    } catch (e: any) {
      toast.error(e?.message || 'AI draft failed');
    } finally { setAiLoading(false); }
  };

  // When campaign type changes, default the audience for lead_reengagement
  useEffect(() => {
    if (campaignType === 'lead_reengagement') {
      setFilter({ audience_kind: 'leads' } as any);
    }
  }, [campaignType]);

  const reset = () => {
    setStep(1); setName(''); setChannel('whatsapp'); setCampaignType('announcement');
    setFilter({ status: 'active' }); setResolvedMemberIds([]);
    setMessage(''); setSubject(''); setTrigger('send_now'); setScheduledAt('');
    setAttachment(null);
    setEventName(''); setEventDate(''); setEventTime(''); setEventVenue(''); setEventRsvpUrl('');
    setUseApprovedTemplate(false); setSelectedTemplateId(null);
    setEvergreenAppliedFor(null); setEvergreenPickedName(null);
  };

  const close = () => { reset(); onOpenChange(false); };

  const insertVar = (v: string) => setMessage((m) => `${m}${v}`);

  const buildFinalMessage = () => {
    let body = message.trim();
    if (isEvent && (eventName || eventDate || eventVenue)) {
      const parts = [
        eventName ? `📅 ${eventName}` : '',
        eventDate ? `🗓️  ${eventDate}${eventTime ? ` at ${eventTime}` : ''}` : '',
        eventVenue ? `📍 ${eventVenue}` : '',
        eventRsvpUrl ? `RSVP: ${eventRsvpUrl}` : '',
      ].filter(Boolean).join('\n');
      body = `${body}\n\n${parts}`.trim();
    }
    return body;
  };

  // Cold-audience template enforcement (only meaningful for WhatsApp)
  const coldCount = breakdown?.cold ?? 0;
  const totalCount = breakdown?.total ?? resolvedMemberIds.length;
  const isCsv = filter.audience_kind === 'csv_import';
  const requiresTemplate = channel === 'whatsapp' && (coldCount > 0 || isCsv);
  const templatePicked = useApprovedTemplate && !!selectedTemplateId && !selectedTemplateId.startsWith('__meta__:');
  const blockedByTemplate = requiresTemplate && !templatePicked;

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Campaign name required'); return; }
    if (!message.trim()) { toast.error('Message required'); return; }
    if (totalCount === 0) { toast.error('Audience is empty'); return; }
    if (blockedByTemplate) {
      toast.error(`${coldCount} recipient(s) are outside the 24h WhatsApp window — pick an APPROVED Meta template before sending.`);
      return;
    }
    if (isEvent && !eventName.trim()) { toast.error('Event name required'); return; }
    if (trigger === 'scheduled' && !scheduledAt) { toast.error('Pick a date and time'); return; }
    if (trigger === 'scheduled' && new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error('Scheduled time must be in the future'); return;
    }

    setSubmitting(true);
    try {
      const finalMessage = buildFinalMessage();
      const payload = {
        branch_id: branchId,
        name: name.trim(),
        channel,
        audience_filter: filter,
        message: finalMessage,
        subject: channel === 'email' ? subject.trim() || null : null,
        trigger_type: trigger,
        scheduled_at: trigger === 'scheduled' ? new Date(scheduledAt).toISOString() : null,
        attachment_url: attachment?.url ?? null,
        attachment_kind: attachment?.kind ?? null,
        attachment_filename: attachment?.filename ?? null,
        campaign_type: campaignType,
        event_meta: isEvent ? {
          name: eventName.trim(),
          date: eventDate || null,
          time: eventTime || null,
          venue: eventVenue.trim() || null,
          rsvp_url: eventRsvpUrl.trim() || null,
        } : {},
        template_id: channel === 'whatsapp' && useApprovedTemplate && selectedTemplateId && !selectedTemplateId.startsWith('__meta__:') ? selectedTemplateId : null,
        status: (
          trigger === 'send_now' ? 'sending' :
          trigger === 'scheduled' ? 'scheduled' : 'draft'
        ) as any,
      };
      const campaign = isEditing && editingCampaign
        ? await updateCampaign(editingCampaign.id, payload as any).then((c) => c)
        : await createCampaign(payload as any);

      if (trigger === 'send_now') {
        const useResolver = filter.audience_kind && filter.audience_kind !== 'members';
        const audience = useResolver
          ? { recipients: await (await import('@/services/campaignService')).resolveCampaignAudience(branchId, filter) }
          : { memberIds: resolvedMemberIds };
        const result = await sendCampaignNow(campaign, audience);
        if (result.failed > 0 && result.sent === 0) {
          toast.error(`Campaign failed — 0 delivered, ${result.failed} failed${(result as any).first_error ? `: ${(result as any).first_error}` : ''}`);
        } else if (result.failed > 0) {
          toast.warning(`Campaign sent with errors — ${result.sent} delivered, ${result.failed} failed`);
        } else {
          toast.success(`Campaign sent — ${result.sent} delivered`);
        }
      } else if (trigger === 'scheduled') {
        toast.success(`Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}`);
      } else {
        // automated → wire to automation_rules so automation-brain runs it on schedule
        const cron = recurrencePresetToCron(recurrence, customCron);
        await createRecurringCampaignRule({
          branch_id: branchId,
          campaign_id: campaign.id,
          name: name.trim(),
          cron_expression: cron,
        });
        toast.success(`Recurring rule created (${cron}) — runs via Automation Brain`);
      }
      qc.invalidateQueries({ queryKey: ['campaigns', branchId] });
      qc.invalidateQueries({ queryKey: ['automation_rules'] });
      close();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  const isEvent = campaignType === 'event';
  const stepLabels = isEvent ? ['Type', 'Audience', 'Message', 'Event', 'Trigger'] : ['Type', 'Audience', 'Message', 'Trigger'];
  const totalSteps = stepLabels.length;
  const eventStepIndex = isEvent ? 4 : -1;
  const triggerStepIndex = totalSteps;
  const messageStepIndex = 3;
  const audienceStepIndex = 2;
  const typeStepIndex = 1;

  return (
    <ResponsiveSheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-violet-600" /> Create Marketing Campaign
        </ResponsiveSheetTitle>
        <ResponsiveSheetDescription>Reach the right members with the right message</ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <div className="px-1 pb-2">
        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex-1 flex items-center">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                step > i + 1 ? 'bg-emerald-500 text-white' : step === i + 1 ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground'
              }`}>{i + 1}</div>
              <span className={`ml-2 text-sm ${step === i + 1 ? 'font-semibold' : 'text-muted-foreground'}`}>{label}</span>
              {i < stepLabels.length - 1 && <div className="flex-1 h-px bg-border mx-3" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === typeStepIndex && (
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">What kind of campaign?</Label>
            <div className="grid grid-cols-2 gap-3">
              {CAMPAIGN_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCampaignType(t.id)}
                  className={`text-left rounded-2xl p-4 border-2 transition-all ${
                    campaignType === t.id
                      ? `border-${t.color}-500 bg-${t.color}-50 dark:bg-${t.color}-500/10 shadow-md`
                      : 'border-border bg-card hover:border-muted-foreground/40'
                  }`}
                >
                  <div className="text-2xl mb-1">{t.emoji}</div>
                  <p className="font-semibold text-sm text-foreground">{t.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === audienceStepIndex && (
          <div className="space-y-5">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Campaign name</Label>
              <Input className="rounded-xl" placeholder="e.g. New Year membership push" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <AudienceBuilder branchId={branchId} value={filter} onChange={setFilter} onResolved={setResolvedMemberIds} onBreakdown={setBreakdown} channel={channel} />
          </div>
        )}

        {step === messageStepIndex && (
          <div className="space-y-5">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Channel</Label>
              <div className="flex gap-2">
                {([
                  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'emerald' },
                  { id: 'email', label: 'Email', icon: Mail, color: 'blue' },
                  { id: 'sms', label: 'SMS', icon: MessageSquare, color: 'amber' },
                ] as const).map((c) => (
                  <button key={c.id} type="button" onClick={() => setChannel(c.id as CampaignChannel)}
                    className={`flex-1 rounded-xl p-3 border-2 transition-all ${
                      channel === c.id ? `border-${c.color}-500 bg-${c.color}-50 dark:bg-${c.color}-500/10` : 'border-border bg-card'
                    }`}>
                    <c.icon className={`h-5 w-5 mx-auto ${channel === c.id ? `text-${c.color}-600` : 'text-muted-foreground'}`} />
                    <p className={`text-xs mt-1 font-medium ${channel === c.id ? 'text-foreground' : 'text-muted-foreground'}`}>{c.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {channel === 'email' && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Subject</Label>
                <Input className="rounded-xl" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
              </div>
            )}

            {channel === 'whatsapp' && requiresTemplate && !templatePicked && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-3 flex gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900 dark:text-amber-100">
                  <p className="font-semibold mb-0.5">{coldCount} of {totalCount} recipient(s) are outside the 24h WhatsApp window.</p>
                  <p className="text-[12px]">WhatsApp will reject freeform messages to them (Meta error 131047). <b>Pick an APPROVED Meta template below</b>, or narrow the audience.</p>
                </div>
              </div>
            )}
            {channel === 'whatsapp' && requiresTemplate && templatePicked && (
              <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 p-3 flex gap-2.5">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-900 dark:text-emerald-100">
                  <p className="font-semibold mb-0.5">Approved template will be used for {coldCount} cold recipient(s).</p>
                  <p className="text-[12px]">In-window recipients ({Math.max(0, totalCount - coldCount)}) get your freeform message; cold recipients get the approved template.</p>
                </div>
              </div>
            )}

            {channel === 'whatsapp' && (
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 dark:bg-emerald-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <Label className="text-xs font-semibold text-emerald-900 block">Send via approved Meta template</Label>
                      <p className="text-[11px] text-emerald-700">Required for cold leads / contacts outside the 24h messaging window.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSyncFromMeta}
                      disabled={syncingTemplates}
                      className="h-7 px-2 text-[11px]"
                      title="Refresh approved template list from Meta"
                    >
                      {syncingTemplates ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sync from Meta'}
                    </Button>
                    <Switch
                      checked={useApprovedTemplate}
                      onCheckedChange={(v) => {
                        setUseApprovedTemplate(v);
                        if (!v) setSelectedTemplateId(null);
                      }}
                    />
                  </div>
                </div>
                {useApprovedTemplate && (
                  <div className="space-y-2">
                    {approvedTemplates.length === 0 ? (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
                        <p className="font-semibold">No approved Meta templates yet.</p>
                        <p>Generate one in <strong>Settings → Communication Templates → AI Studio</strong>, or click <strong>Sync from Meta</strong> above to pull the latest approval list.</p>
                      </div>
                    ) : (
                      <Select
                        value={selectedTemplateId || ''}
                        onValueChange={(id) => {
                          setSelectedTemplateId(id);
                          const t: any = approvedTemplates.find((x: any) => x.id === id);
                          if (t?.content) setMessage(t.content);
                          if (t?.header_type && t.header_type !== 'none' && attachment?.kind !== t.header_type) {
                            toast.info(`This template needs a ${t.header_type} header — upload one below.`);
                          }
                        }}
                      >
                        <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Pick an approved template…" /></SelectTrigger>
                        <SelectContent>
                          {approvedTemplates.map((t: any) => (
                            <SelectItem key={t.meta_template_name} value={t.id || `__meta__:${t.meta_template_name}`}>
                              {t.name}
                              {t.category ? ` · ${t.category.toLowerCase()}` : ''}
                              {t.header_type && t.header_type !== 'none' ? ` · ${t.header_type}` : ''}
                              {t.language && t.language !== 'en' ? ` · ${t.language}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {selectedTemplateId && selectedTemplateId.startsWith('__meta__:') && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        This Meta template has no local CRM row yet. Click <strong>Sync from Meta</strong> once to materialize it before sending.
                      </p>
                    )}
                    {selectedTemplateId && !selectedTemplateId.startsWith('__meta__:') && (
                      <p className="text-[11px] text-emerald-800">
                        Body is locked to the approved template content. You can still personalize variables and attach the required header media below.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Message</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAiOpen((o) => !o)}
                  className="rounded-full h-7 px-3 text-xs gap-1.5 border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700"
                >
                  <Sparkles className="h-3 w-3" /> Draft with AI
                </Button>
              </div>

              {aiOpen && (
                <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/50 p-3 mb-3 space-y-2">
                  <Label className="text-[11px] uppercase tracking-wider text-violet-800 font-semibold">Describe what you want to say</Label>
                  <Textarea
                    className="rounded-xl bg-white min-h-[80px]"
                    placeholder={channel === 'email'
                      ? 'e.g. Announce 30% off annual memberships, ends Sunday, free shaker on signup'
                      : 'e.g. Reminder about Sunday HIIT bootcamp at 7am, bring a friend free'}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAiOpen(false)} className="rounded-full">Cancel</Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAiDraft}
                      disabled={aiLoading}
                      className="rounded-full bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
                    >
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      Generate
                    </Button>
                  </div>
                  <p className="text-[10px] text-violet-700">
                    AI uses your campaign type{campaignType === 'event' ? ', event details' : ''} and channel rules{channel === 'email' ? ' (subject + responsive HTML)' : ''}. Always review before sending.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 mb-2">
                {VARIABLES.map((v) => (
                  <button key={v} type="button" onClick={() => insertVar(v)}>
                    <Badge variant="outline" className="cursor-pointer hover:bg-accent rounded-full font-mono text-[10px]">{v}</Badge>
                  </button>
                ))}
              </div>
              <Textarea
                className="rounded-xl min-h-[160px]"
                placeholder={`Hi {{first_name}}, your gym at {{branch_name}} has a special offer for you…`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="flex items-center justify-between mt-1.5 gap-2">
                <p className="text-xs text-muted-foreground">{message.length} chars · {totalCount} recipients{coldCount > 0 ? ` · ${coldCount} cold` : ''}</p>
                {channel === 'whatsapp' && message.trim().length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSubmitMetaTemplate}
                    disabled={submittingMeta}
                    className="rounded-full h-7 px-3 text-xs gap-1.5 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                    title="Submit this body to Meta as a reusable WhatsApp template (PENDING approval)"
                  >
                    {submittingMeta ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Submit to Meta
                  </Button>
                )}
              </div>
            </div>

            {(channel === 'whatsapp' || channel === 'email') && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> Flyer / Poster / Video (optional)
                </Label>
                {attachment ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2.5 rounded-xl border bg-muted/30">
                      {attachment.kind === 'image' ? <ImageIcon className="h-4 w-4 text-emerald-500" /> :
                       attachment.kind === 'video' ? <Film className="h-4 w-4 text-violet-500" /> :
                       <FileText className="h-4 w-4 text-amber-500" />}
                      <span className="text-sm flex-1 truncate">{attachment.filename}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment(null)} aria-label="Remove">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {attachment.kind === 'video' && (
                      <video src={attachment.url} controls playsInline className="rounded-xl border w-full max-h-56 bg-black" />
                    )}
                    {attachment.kind === 'image' && (
                      <img src={attachment.url} alt={attachment.filename} className="rounded-xl border w-full max-h-56 object-cover" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      className="rounded-xl"
                      accept="image/*,application/pdf,video/mp4"
                      disabled={isUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 16 * 1024 * 1024) { toast.error('Max 16MB (WhatsApp limit)'); return; }
                        // WhatsApp Cloud API only reliably accepts MP4 (H.264/AAC).
                        // Reject .mov / .webm / .mkv etc. before upload.
                        if (file.type.startsWith('video/') && file.type !== 'video/mp4') {
                          toast.error('WhatsApp accepts MP4 only — please convert to .mp4 (H.264 / AAC)');
                          e.target.value = '';
                          return;
                        }
                        setIsUploading(true);
                        try {
                          const kind: 'image' | 'document' | 'video' = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
                          const { url } = await uploadAttachment(file, { folder: 'campaigns', filename: file.name, contentType: file.type });
                          setAttachment({ url, filename: file.name, kind });
                          toast.success('Uploaded');
                        } catch (err: any) {
                          toast.error(err.message || 'Upload failed');
                        } finally { setIsUploading(false); }
                      }}
                    />
                    {isUploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Image (JPG/PNG), PDF or MP4 video (H.264 / AAC, ≤16MB). WhatsApp limit: 16MB.
                </p>
                {channel === 'whatsapp' && attachment?.kind === 'video' && (filter.audience_kind === 'leads' || filter.audience_kind === 'mixed' || filter.audience_kind === 'contacts') && (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                    <strong>Heads up:</strong> WhatsApp blocks freeform marketing video to leads/contacts who haven&apos;t messaged you in the last 24 hours (Meta error 131047). For cold outreach, use an approved Meta video-header template instead.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isEvent && step === eventStepIndex && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Event details are appended to your message automatically and saved with the campaign.</p>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Event name *</Label>
              <Input className="rounded-xl" placeholder="e.g. Sunday HIIT Bootcamp" value={eventName} onChange={(e) => setEventName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Date</Label>
                <Input type="date" className="rounded-xl" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Time</Label>
                <Input type="time" className="rounded-xl" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Venue</Label>
              <Input className="rounded-xl" placeholder="e.g. Main floor, Branch HQ" value={eventVenue} onChange={(e) => setEventVenue(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">RSVP / Booking link</Label>
              <Input className="rounded-xl" placeholder="https://…" value={eventRsvpUrl} onChange={(e) => setEventRsvpUrl(e.target.value)} />
            </div>
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
              <p className="text-[11px] uppercase tracking-wider text-amber-800 font-semibold mb-1">Preview append</p>
              <pre className="text-xs whitespace-pre-wrap text-amber-900">{buildFinalMessage().slice(message.length).trim() || '— fill the fields above —'}</pre>
            </div>
          </div>
        )}

        {step === triggerStepIndex && (
          <div className="space-y-4">
            {([
              { id: 'send_now', label: 'Send Now', desc: 'Dispatch the message to all matched members immediately.', icon: Send, color: 'violet' },
              { id: 'scheduled', label: 'Schedule for Later', desc: 'Pick a date and time. Sent automatically by our background worker.', icon: Clock, color: 'amber' },
              { id: 'automated', label: 'Save as Automated Rule', desc: 'Save the campaign so it runs on a schedule or trigger later.', icon: Save, color: 'blue' },
            ] as const).map((t) => (
              <button key={t.id} type="button" onClick={() => setTrigger(t.id as CampaignTriggerType)}
                className={`w-full text-left rounded-2xl p-4 border-2 transition-all ${
                  trigger === t.id ? `border-${t.color}-500 bg-${t.color}-50 dark:bg-${t.color}-500/10 shadow-md shadow-${t.color}-200/40` : 'border-border bg-card'
                }`}>
                <div className="flex items-start gap-3">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${trigger === t.id ? `bg-${t.color}-600 text-white` : 'bg-muted text-muted-foreground'}`}>
                    <t.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">{t.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
                  </div>
                </div>
              </button>
            ))}

            {trigger === 'scheduled' && (
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-4 space-y-2">
                <Label className="text-xs uppercase tracking-wider text-amber-800 font-semibold">Send at (Asia/Kolkata)</Label>
                <Input
                  type="datetime-local"
                  className="rounded-xl bg-white"
                  value={scheduledAt}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <p className="text-[11px] text-amber-700">A background worker checks every minute and sends the campaign at the chosen time.</p>
              </div>
            )}

            {trigger === 'automated' && (
              <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3">
                <Label className="text-xs uppercase tracking-wider text-blue-800 font-semibold">Repeat schedule</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: 'daily',        label: 'Daily 10am' },
                    { id: 'weekly_mon',   label: 'Every Monday' },
                    { id: 'weekly_fri',   label: 'Every Friday' },
                    { id: 'monthly_1st',  label: '1st of month' },
                    { id: 'custom',       label: 'Custom cron' },
                  ] as const).map((p) => (
                    <button key={p.id} type="button" onClick={() => setRecurrence(p.id as RecurrencePreset)}
                      className={`text-left rounded-xl px-3 py-2 text-sm border-2 transition-all ${
                        recurrence === p.id ? 'border-blue-500 bg-white text-blue-900 font-medium' : 'border-transparent bg-white/60 text-blue-800 hover:border-blue-300'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {recurrence === 'custom' && (
                  <div>
                    <Input
                      className="rounded-xl bg-white font-mono text-sm"
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                      placeholder="0 10 * * 1"
                    />
                    <p className="text-[11px] text-blue-700 mt-1">5-field UTC cron · m h dom mon dow</p>
                  </div>
                )}
                <p className="text-[11px] text-blue-700">
                  Audience is re-resolved on every run, so new members/leads matching the filter get included automatically. Manage in Settings → Automation Brain.
                </p>
              </div>
            )}

            <div className="rounded-2xl bg-muted/40 p-4 mt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Summary</p>
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Type:</span> <span className="font-medium capitalize">{campaignType.replace('_', ' ')}</span></div>
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{name || '—'}</span></div>
                <div><span className="text-muted-foreground">Channel:</span> <span className="font-medium">{channel.toUpperCase()}</span></div>
                <div><span className="text-muted-foreground">Recipients:</span> <span className="font-medium">{totalCount}{coldCount > 0 ? ` · ${coldCount} cold` : ''}</span></div>
                {requiresTemplate && (
                  <div><span className="text-muted-foreground">Template:</span> <span className={`font-medium ${templatePicked ? 'text-emerald-700' : 'text-amber-700'}`}>{templatePicked ? 'Approved Meta template selected' : 'Required — not selected'}</span></div>
                )}
                {isEvent && eventName && <div><span className="text-muted-foreground">Event:</span> <span className="font-medium">{eventName}{eventDate ? ` · ${eventDate}` : ''}</span></div>}
              </div>
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
          ) : <div />}
          {step < totalSteps ? (
            <Button onClick={() => setStep(step + 1)} className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting || blockedByTemplate} title={blockedByTemplate ? 'Pick an approved Meta template — cold recipients require it' : undefined} className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> :
                trigger === 'send_now' ? <><Send className="h-4 w-4" /> Send Campaign</> :
                trigger === 'scheduled' ? <><Clock className="h-4 w-4" /> Schedule Campaign</> :
                <><Save className="h-4 w-4" /> Save Rule</>}
            </Button>
          )}
        </div>
      </div>
    </ResponsiveSheet>
  );
}
