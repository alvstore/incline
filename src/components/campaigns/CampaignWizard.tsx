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
import { ChevronLeft, ChevronRight, MessageSquare, Mail, Send, Save, Loader2, Megaphone, Clock, Paperclip, ImageIcon, FileText, Film, X, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { supabase } from '@/integrations/supabase/client';
import { AudienceBuilder } from './AudienceBuilder';
import {
  type AudienceFilter,
  type CampaignChannel,
  type CampaignTriggerType,
  type RecurrencePreset,
  createCampaign,
  createRecurringCampaignRule,
  recurrencePresetToCron,
  sendCampaignNow,
} from '@/services/campaignService';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}

const VARIABLES = ['{{member_name}}', '{{member_code}}', '{{first_name}}', '{{branch_name}}'];

type CampaignType = 'promotion' | 'event' | 'announcement' | 'lead_reengagement';

const CAMPAIGN_TYPES: { id: CampaignType; label: string; desc: string; emoji: string; color: string }[] = [
  { id: 'promotion', label: 'Promotion', desc: 'Offers, discounts, deals', emoji: '🎁', color: 'violet' },
  { id: 'event', label: 'Event / Class', desc: 'Workshops, special classes', emoji: '📅', color: 'amber' },
  { id: 'announcement', label: 'Announcement', desc: 'Updates, news, notices', emoji: '📢', color: 'blue' },
  { id: 'lead_reengagement', label: 'Lead Re-engagement', desc: 'Win back cold leads', emoji: '🔁', color: 'emerald' },
];

export function CampaignWizard({ open, onOpenChange, branchId }: Props) {
  const qc = useQueryClient();
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

  // Auto-prefill from a saved segment (set by Contact Book → Segments → Send)
  useEffect(() => {
    const segId = sessionStorage.getItem('campaign_prefill_segment');
    const segName = sessionStorage.getItem('campaign_prefill_segment_name');
    if (segId) {
      setFilter({ audience_kind: 'segment', segment_id: segId });
      if (segName) setName(`Segment: ${segName}`);
      sessionStorage.removeItem('campaign_prefill_segment');
      sessionStorage.removeItem('campaign_prefill_segment_name');
    }
  }, []);
  const [resolvedMemberIds, setResolvedMemberIds] = useState<string[]>([]);
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

  const handleSubmitMetaTemplate = async () => {
    if (channel !== 'whatsapp') return;
    if (!message.trim()) { toast.error('Draft a message first'); return; }
    setSubmittingMeta(true);
    try {
      const safeName = (name || `campaign_${Date.now()}`).toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 48);
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: {
          action: 'create',
          branch_id: branchId,
          template_data: {
            name: safeName,
            category: campaignType === 'promotion' || campaignType === 'event' ? 'MARKETING' : 'UTILITY',
            language: 'en',
            body_text: message.trim(),
            header_type: attachment?.kind === 'image' ? 'image' : attachment?.kind === 'video' ? 'video' : 'none',
            header_sample_url: attachment?.kind && attachment.kind !== 'document' ? attachment.url : undefined,
          },
        },
      });
      if (error) throw error;
      const r = data as any;
      if (r?.success === false) {
        toast.error(r?.error || 'Meta rejected the template');
        return;
      }
      toast.success(`Submitted to Meta as "${r?.name}" — status: ${r?.status || 'PENDING'}`);
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

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Campaign name required'); return; }
    if (!message.trim()) { toast.error('Message required'); return; }
    const isMembersKind = !filter.audience_kind || filter.audience_kind === 'members';
    if (isMembersKind && resolvedMemberIds.length === 0) { toast.error('Audience is empty'); return; }
    if (isEvent && !eventName.trim()) { toast.error('Event name required'); return; }
    if (trigger === 'scheduled' && !scheduledAt) { toast.error('Pick a date and time'); return; }
    if (trigger === 'scheduled' && new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error('Scheduled time must be in the future'); return;
    }

    setSubmitting(true);
    try {
      const finalMessage = buildFinalMessage();
      const campaign = await createCampaign({
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
        status:
          trigger === 'send_now' ? 'sending' :
          trigger === 'scheduled' ? 'scheduled' : 'draft',
      });

      if (trigger === 'send_now') {
        const useResolver = filter.audience_kind && filter.audience_kind !== 'members';
        const audience = useResolver
          ? { recipients: await (await import('@/services/campaignService')).resolveCampaignAudience(branchId, filter) }
          : { memberIds: resolvedMemberIds };
        const result = await sendCampaignNow(campaign, audience);
        toast.success(`Campaign sent — ${result.sent} delivered, ${result.failed} failed`);
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
            <AudienceBuilder branchId={branchId} value={filter} onChange={setFilter} onResolved={setResolvedMemberIds} channel={channel} />
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
                <p className="text-xs text-muted-foreground">{message.length} chars · {resolvedMemberIds.length} recipients</p>
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
                <div><span className="text-muted-foreground">Recipients:</span> <span className="font-medium">{resolvedMemberIds.length}</span></div>
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
            <Button onClick={handleSubmit} disabled={submitting} className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white">
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
