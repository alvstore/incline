import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { ChevronLeft, ChevronRight, MessageSquare, Mail, Send, Save, Loader2, Megaphone, Clock, Paperclip, ImageIcon, FileText, Film, X, Sparkles, Wand2, AlertTriangle, Radio, Check, CalendarDays } from 'lucide-react';
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
  upsertDraftCampaignForTemplate,
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
const EVENT_VARIABLES = ['{{class_name}}', '{{class_when}}', '{{class_trainer}}', '{{class_venue}}'];

/** Per-channel editing state so each selected channel keeps its own content. */
interface ChannelDraft {
  message: string;
  subject: string;
  varOverrides: Record<string, string>;
  templateId: string | null;
  useApprovedTemplate: boolean;
  evergreenName: string | null;
}

// ─── Variable resolution (kept in lock-step with dispatch-communication + send-broadcast) ───
// Positional Meta vars ({{1}}, {{2}}, ...) map to these keys in order.
// Named vars ({{first_name}}, ...) map to themselves.
const POSITIONAL_VAR_MEANINGS: Record<string, { label: string; sample: string }> = {
  '1': { label: 'Recipient first name', sample: 'Rahul' },
  '2': { label: 'Recipient full name', sample: 'Rahul Sharma' },
  '3': { label: 'Branch name', sample: 'Incline HQ' },
};
const NAMED_VAR_MEANINGS: Record<string, { label: string; sample: string }> = {
  first_name: { label: 'Recipient first name', sample: 'Rahul' },
  member_name: { label: 'Recipient full name', sample: 'Rahul Sharma' },
  full_name: { label: 'Recipient full name', sample: 'Rahul Sharma' },
  name: { label: 'Recipient first name', sample: 'Rahul' },
  member_code: { label: 'Member code', sample: 'INC-000123' },
  branch_name: { label: 'Branch name', sample: 'Incline HQ' },
  class_name: { label: 'Class / event name', sample: 'Sunday HIIT Bootcamp' },
  class_when: { label: 'Class date & time', sample: 'Sun 24 Aug · 7:00 AM' },
  class_trainer: { label: 'Class trainer', sample: 'Ritesh Sharma' },
  class_venue: { label: 'Class venue', sample: 'Main floor' },
  poster_url: { label: 'Poster / flyer image', sample: '' },
};

interface TplVar { token: string; key: string; positional: boolean; label: string; sample: string; }
function extractTemplateVars(body: string): TplVar[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const seen = new Set<string>();
  const out: TplVar[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const positional = /^\d+$/.test(key);
    const meta = positional
      ? (POSITIONAL_VAR_MEANINGS[key] ?? { label: `Positional variable #${key}`, sample: 'Sample' })
      : (NAMED_VAR_MEANINGS[key.toLowerCase()] ?? { label: key.replace(/_/g, ' '), sample: 'Sample' });
    out.push({ token: `{{${key}}}`, key, positional, label: meta.label, sample: meta.sample });
  }
  return out;
}
function renderPreview(body: string, sampleOverrides: Record<string, string> = {}): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (sampleOverrides[key]) return sampleOverrides[key];
    if (/^\d+$/.test(key)) return POSITIONAL_VAR_MEANINGS[key]?.sample ?? 'Sample';
    return NAMED_VAR_MEANINGS[key.toLowerCase()]?.sample ?? 'Sample';
  });
}

/** Slots resolved automatically per recipient (never manually filled). */
const AUTO_VAR_KEYS = new Set(['1', 'first_name', 'name', 'member_name', 'full_name', 'member_code']);
function isAutoVar(v: TplVar): boolean {
  return AUTO_VAR_KEYS.has(v.positional ? v.key : v.key.toLowerCase());
}

/** "Sun 24 Aug · 7:00 AM" in IST. */
function formatClassWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${day} · ${time}`;
}

/** Very small markdown-ish → HTML for the email preview (escaped first). */
function emailPreviewHtml(body: string): string {
  if (/<[a-z][\s\S]*>/i.test(body)) return body; // already HTML
  const esc = body
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#4f46e5">$1</a>')
    .split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br/>')}</p>`).join('');
}

function phoneLast10(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length <= 10) return digits;
  return digits.slice(-10);
}


function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}

function describeProviderPayload(payload: unknown): string {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object') return String(payload);
  const data = payload as Record<string, any>;
  const nestedError = data.error;
  const message = data.error_message
    || data.reason
    || data.meta_error
    || data.details
    || data.detail
    || (typeof nestedError === 'string' ? nestedError : nestedError?.message)
    || data.message;
  const parts: string[] = [];
  const metaCode = data.meta_code ?? nestedError?.code;
  const metaSubcode = data.meta_subcode ?? nestedError?.error_subcode;
  if (metaCode) parts.push(`Meta ${metaCode}${metaSubcode ? `/${metaSubcode}` : ''}`);
  if (message) parts.push(String(message));
  if (data.provider_route) parts.push(`route=${data.provider_route}`);
  if (data.fbtrace_id) parts.push(`fbtrace=${data.fbtrace_id}`);
  return parts.length ? parts.join(' · ') : JSON.stringify(data);
}

async function describeInvokeError(error: any): Promise<string> {
  const base = error?.message || error?.error_description || String(error || 'Test send failed');
  const ctx = error?.context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const text = await ctx.clone().text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          return describeProviderPayload(parsed) || text;
        } catch {
          return text;
        }
      }
    } catch {
      // Fall through to base message.
    }
  }
  return base;
}

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
  // `channel` = the channel currently being edited/previewed.
  // `selectedChannels` = every channel this campaign will go out on. Each one
  // keeps its own body/subject/template so an Email campaign never inherits a
  // WhatsApp positional-slot body.
  const [channel, setChannel] = useState<CampaignChannel>('whatsapp');
  const [selectedChannels, setSelectedChannels] = useState<CampaignChannel[]>(['whatsapp']);
  const [channelDrafts, setChannelDrafts] = useState<Record<string, ChannelDraft>>({});
  // Multiple classes can go out in one announcement (e.g. morning + evening
  // Yoga). The first picked class drives the event fields; every picked class
  // is listed in the {{class_when}} / {{class_details}} slots.
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
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
  // Auto-fallback to RCS/SMS when Meta paces this recipient (131049/130472).
  // Applies only to promotion/lead_reengagement WhatsApp sends.
  const [fallbackOnPacing, setFallbackOnPacing] = useState(true);


  // Approved Meta WhatsApp template (cold-audience-compliant path)
  const [useApprovedTemplate, setUseApprovedTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // Draft campaign row created when the user submits a template to Meta from
  // this wizard. Lets subsequent Save/Schedule/Send actions update that same
  // row instead of orphaning the template submission (issue #1).
  const [draftCampaignId, setDraftCampaignId] = useState<string | null>(null);
  const [showAllTemplates, setShowAllTemplates] = useState(false);

  const [syncingTemplates, setSyncingTemplates] = useState(false);

  // Test send (Preview & Test panel)
  const [testRecipient, setTestRecipient] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // Fixed values for template slots that are NOT the recipient's name
  // (e.g. {{2}} class name, {{3}} timing, {{4}} details). Meta rejects a send
  // with empty params (template_param_empty:3,4), so these must be filled.
  const [varOverrides, setVarOverrides] = useState<Record<string, string>>({});

  /** Non-empty manual slot values, keyed by the token key and its positional
   *  aliases so both `{{2}}` bodies and Meta positional params resolve. */
  const filledVariables = useCallback((overrides?: Record<string, string>): Record<string, string> => {
    const src = overrides ?? varOverrides;
    const out: Record<string, string> = {};
    Object.entries(src).forEach(([key, raw]) => {
      const value = String(raw ?? '').trim();
      if (!value) return;
      out[key] = value;
      if (/^\d+$/.test(key)) {
        out[`v${key}`] = value;
        out[`param${key}`] = value;
      }
    });
    return out;
  }, [varOverrides]);

  /** Slots the user must type a value for (positional / unknown tokens). */
  const missingSlotTokens = useMemo(() => {
    if (!message.trim()) return [] as string[];
    return extractTemplateVars(message)
      .filter((v) => !isAutoVar(v))
      .filter((v) => !(varOverrides[v.key] || '').trim())
      .map((v) => v.token);
  }, [message, varOverrides]);



  // ── RCS (Telinfy) template selection + per-variable mapping ──
  const [rcsTemplateId, setRcsTemplateId] = useState<string | null>(null);
  const [rcsVarMap, setRcsVarMap] = useState<Record<string, string>>({});

  const { data: rcsTemplates = [] } = useQuery({
    queryKey: ['rcs-templates', branchId],
    queryFn: async () => {
      let q = supabase.from('rcs_templates').select('id, template_name, body_preview, variables, kind, status');
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data, error } = await q.order('template_name');
      if (error) throw error;
      return data || [];
    },
    enabled: open && channel === 'rcs',
  });

  const selectedRcsTemplate = (rcsTemplates as any[]).find((t) => t.id === rcsTemplateId) || null;
  const rcsVarKeys: string[] = (() => {
    if (!selectedRcsTemplate) return [];
    const declared = Array.isArray(selectedRcsTemplate.variables) ? selectedRcsTemplate.variables : [];
    const fromBody = Array.from(
      new Set(
        String(selectedRcsTemplate.body_preview || '')
          .match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)
          ?.map((m: string) => m.replace(/[{}\s]/g, '')) || [],
      ),
    );
    // Prefer declared variables (Telinfy panel), fall back to body-scan.
    return declared.length ? declared.map(String) : (fromBody as string[]);
  })();

  // Seed default mapping when template changes (first key → first_name, others → blank).
  useEffect(() => {
    if (!selectedRcsTemplate) return;
    setRcsVarMap((prev) => {
      const next = { ...prev };
      rcsVarKeys.forEach((k, i) => {
        if (next[k] !== undefined) return;
        if (i === 0 || /name|first/i.test(k)) next[k] = '{{first_name}}';
        else next[k] = '';
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcsTemplateId]);

  /** Resolve the RCS variable map for a single recipient at send-time. */
  const resolveRcsVarsForRecipient = (r: { full_name?: string | null; email?: string | null }): Record<string, string> => {
    const first = (r.full_name || '').trim().split(/\s+/)[0] || 'there';
    const full = r.full_name || 'there';
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rcsVarMap)) {
      out[k] = String(v || '')
        .replace(/\{\{\s*first_name\s*\}\}/gi, first)
        .replace(/\{\{\s*full_name\s*\}\}/gi, full)
        .replace(/\{\{\s*member_name\s*\}\}/gi, full)
        .replace(/\{\{\s*email\s*\}\}/gi, r.email || '');
    }
    return out;
  };

  // Source of truth = `whatsapp_templates` (Meta cache) so anything Meta has approved
  // is selectable, even if there's no local CRM `templates` row yet.
  // We left-join `templates.id` by meta_template_name so the send pipeline still
  // receives a valid `template_id` UUID.
  const { data: approvedTemplates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['approved-whatsapp-templates', branchId, trigger],
    queryFn: async () => {
      // For scheduled/automated triggers we ALSO surface PENDING templates so
      // the user can queue a campaign that will fire the moment Meta approves.
      // send_now still enforces APPROVED-only (Meta rejects PENDING at runtime).
      const allowedStatuses = trigger === 'send_now'
        ? ['APPROVED']
        : ['APPROVED', 'PENDING'];
      let q = supabase
        .from('whatsapp_templates')
        .select('id, name, language, category, components, branch_id, status')
        .in('status', allowedStatuses);
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data: meta, error } = await q.order('name');
      if (error) throw error;

      const names = (meta || []).map((m: any) => m.name);
      const { data: locals } = names.length
        ? await supabase
            .from('templates')
            .select('id, meta_template_name, header_type, header_media_url, evergreen_kind')
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
          meta_template_status: (m.status || 'APPROVED') as 'APPROVED' | 'PENDING',
          meta_template_name: m.name,
          evergreen_kind: local?.evergreen_kind || null,
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
  const {
    data: evergreenTemplates = [],
    isSuccess: evergreenLoaded,
    isFetching: evergreenFetching,
  } = useQuery({
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
  //
  // IMPORTANT: we only decide once the query for THIS channel has actually
  // resolved. Deciding while the new channel's evergreen list is still loading
  // used to mark the combo as "applied" with zero rows, leaving the previous
  // channel's body (e.g. the WhatsApp positional template) on an Email campaign.
  useEffect(() => {
    if (!open || isEditing) return;
    if (channel === 'rcs') return; // RCS is template-only, no evergreen body
    if (!evergreenLoaded || evergreenFetching) return;
    const key = `${channel}:${campaignType}`;
    if (evergreenAppliedFor === key) return;
    const ever = (evergreenTemplates as any[])[0];
    if (!ever) {
      // No evergreen for this channel/type — clear any body inherited from
      // another channel rather than shipping the wrong format.
      setEvergreenAppliedFor(key);
      if (evergreenPickedName) {
        setEvergreenPickedName(null);
        setMessage('');
        setSubject('');
        setVarOverrides({});
      }
      return;
    }
    // Don't blow away user's custom edits — only apply if message is empty or
    // still came from an evergreen base (any channel's).
    const messageIsCustom = message.trim().length > 0 && !evergreenPickedName;
    if (!messageIsCustom) {
      setMessage(ever.content || '');
      setSubject(channel === 'email' ? (ever.subject || '') : '');
      setVarOverrides({});
      setEvergreenPickedName(ever.name);
      // If the linked Meta template is APPROVED, auto-route through the
      // approved-template path so cold recipients don't get blocked.
      if (channel === 'whatsapp' && ever.id && String(ever.meta_template_status || '').toLowerCase() === 'approved') {
        setUseApprovedTemplate(true);
        setSelectedTemplateId(ever.id);
      } else if (channel !== 'whatsapp') {
        setUseApprovedTemplate(false);
        setSelectedTemplateId(null);
      }
    }
    setEvergreenAppliedFor(key);
  }, [open, isEditing, channel, campaignType, evergreenTemplates, evergreenLoaded, evergreenFetching, evergreenAppliedFor, evergreenPickedName, message]);

  // ─── Upcoming classes (Event / Class campaigns) ────────────────────────────
  const { data: upcomingClasses = [] } = useQuery({
    queryKey: ['campaign-upcoming-classes', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, class_type, scheduled_at, duration_minutes, capacity, trainer_id, is_active')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .gte('scheduled_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order('scheduled_at')
        .limit(50);
      if (error) throw error;
      const rows = data || [];
      const trainerIds = Array.from(new Set(rows.map((r: any) => r.trainer_id).filter(Boolean)));
      let trainerNames = new Map<string, string>();
      if (trainerIds.length) {
        // trainers.full_name doesn't exist — the display name lives on profiles.
        const { data: trainers } = await supabase
          .from('trainers')
          .select('id, user_id')
          .in('id', trainerIds as string[]);
        const userIds = (trainers || []).map((t: any) => t.user_id).filter(Boolean);
        const { data: profs } = userIds.length
          ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
          : { data: [] as any[] };
        const byUser = new Map((profs || []).map((p: any) => [p.id, p.full_name]));
        trainerNames = new Map(
          (trainers || []).map((t: any) => [t.id, byUser.get(t.user_id) || '']),
        );
      }
      return rows.map((r: any) => ({
        ...r,
        trainer_name: r.trainer_id ? trainerNames.get(r.trainer_id) || null : null,
      }));
    },
    enabled: open && campaignType === 'event' && !!branchId,
  });



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
    setSelectedChannels([c.channel as CampaignChannel]);
    setChannelDrafts({});
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
    // Track the editing row so any "Submit to Meta" resubmission updates it
    // instead of creating a duplicate draft (issue #1).
    setVarOverrides(
      (c as any).template_variables && typeof (c as any).template_variables === 'object'
        ? Object.fromEntries(
            Object.entries((c as any).template_variables as Record<string, unknown>)
              .filter(([k]) => !/^(v|param)\d+$/.test(k))
              .map(([k, v]) => [k, String(v ?? '')]),
          )
        : {},
    );
    setDraftCampaignId(c.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Derive positional variable mapping from the message body so the
      // sender knows {{1}} → first_name (and downstream slots keep a stable
      // key). Without this, dispatcher gets keys=['1'] with no aliases and
      // ships an empty "Hi ," to Meta.
      const positionalCount = (message.match(/\{\{\s*\d+\s*\}\}/g) || [])
        .map((m) => parseInt(m.replace(/[^\d]/g, ''), 10))
        .reduce((max, n) => Math.max(max, n), 0);
      const positionalVars = positionalCount > 0
        ? ['first_name', ...Array.from({ length: positionalCount - 1 }, (_, i) => `var${i + 2}`)]
        : [];

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
          variables: positionalVars,
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

      // Persist a draft campaign row so this work shows up in the Campaigns
      // list and can be scheduled/sent once Meta approves the template.
      try {
        const draft = await upsertDraftCampaignForTemplate(draftCampaignId, {
          branch_id: branchId,
          name: (name || safeName).trim(),
          channel: 'whatsapp',
          audience_filter: filter,
          message: message.trim(),
          subject: null,
          trigger_type: trigger,
          scheduled_at: trigger === 'scheduled' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          attachment_url: attachment?.url ?? null,
          attachment_kind: attachment?.kind ?? null,
          attachment_filename: attachment?.filename ?? null,
          campaign_type: campaignType,
          fallback_policy: { on_pacing: fallbackOnPacing } as any,

          event_meta: isEvent ? {
            name: eventName.trim(), date: eventDate || null, time: eventTime || null,
            venue: eventVenue.trim() || null, rsvp_url: eventRsvpUrl.trim() || null,
          } : {},
          template_id: localRow!.id,
          status: 'pending_template_approval',
        });
        setDraftCampaignId(draft.id);
        // Auto-pre-select the just-submitted template so realtime picks it up
        // as soon as Meta approves.
        setUseApprovedTemplate(true);
        setSelectedTemplateId(localRow!.id);
      } catch (persistErr: any) {
        console.error('Failed to persist draft campaign', persistErr);
      }

      toast.success(`Template submitted to Meta · draft campaign saved. It will send once Meta approves "${r?.name}".`, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ['approved-whatsapp-templates'] });
      qc.invalidateQueries({ queryKey: ['communication-templates'] });
      qc.invalidateQueries({ queryKey: ['campaigns', branchId] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to submit to Meta');
    } finally { setSubmittingMeta(false); }
  };

  const handleSendTest = async () => {
    const target = testRecipient.trim();
    if (!target) { toast.error(channel === 'email' ? 'Enter a test email' : 'Enter a test phone (+91…)'); return; }
    if (!message.trim()) { toast.error('Draft a message first'); return; }
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) { toast.error('Invalid email'); return; }
    if (channel !== 'email' && !/^\+?\d{7,15}$/.test(target.replace(/\s+/g, ''))) { toast.error('Invalid phone (use +91XXXXXXXXXX)'); return; }

    setSendingTest(true);
    try {
      const templateId =
        channel === 'whatsapp' && useApprovedTemplate && selectedTemplateId && !selectedTemplateId.startsWith('__meta__:')
          ? selectedTemplateId
          : null;
      const targetLast10 = phoneLast10(target);
      let testName = 'Test User';
      let nameSource = 'manual test fallback';
      if (channel !== 'email' && targetLast10.length >= 7) {
        const last4 = targetLast10.slice(-4);
        const pickMatch = (rows: Array<{ full_name?: string | null; phone?: string | null }> | null | undefined) =>
          (rows || []).find((row) => phoneLast10(row.phone || '') === targetLast10 && String(row.full_name || '').trim());

        const [leadRes, contactRes, profileRes, chatRes] = await Promise.all([
          supabase.from('leads').select('full_name, phone').eq('branch_id', branchId).ilike('phone', `%${last4}%`).limit(25),
          supabase.from('contacts').select('full_name, phone').eq('branch_id', branchId).ilike('phone', `%${last4}%`).limit(25),
          supabase.from('profiles').select('full_name, phone').ilike('phone', `%${last4}%`).limit(25),
          supabase.from('whatsapp_chat_settings').select('contact_name, phone_number').eq('branch_id', branchId).ilike('phone_number', `%${last4}%`).limit(25),
        ]);
        const leadMatch = pickMatch(leadRes.data as any[]);
        const contactMatch = pickMatch(contactRes.data as any[]);
        const profileMatch = pickMatch(profileRes.data as any[]);
        const chatMatch = (chatRes.data || [])
          .map((row: any) => ({ full_name: String(row.contact_name || '').replace(/^@+/, '').trim(), phone: row.phone_number }))
          .find((row: any) => phoneLast10(row.phone || '') === targetLast10 && row.full_name);
        const matched = leadMatch || contactMatch || profileMatch || chatMatch;
        if (matched?.full_name?.trim()) {
          testName = matched.full_name.trim();
          nameSource = leadMatch ? 'lead record' : contactMatch ? 'contact record' : profileMatch ? 'profile record' : 'WhatsApp contact';
        }
      }
      const firstName = testName.split(/\s+/)[0];
      const recipientAddress = channel === 'email'
        ? target
        : (target.startsWith('+') ? target : `+${target}`);

      // Build per-recipient variables (mirrors send-broadcast perVars so
      // Meta template positional params resolve identically). Manually filled
      // slots ({{2}}, {{3}}, …) override the auto mapping.
      const perVars: Record<string, string> = {
        member_name: testName, full_name: testName, first_name: firstName, name: firstName,
        '1': firstName, v1: firstName, param1: firstName,
        ...filledVariables(),
      };

      // For RCS, template_name is packed into variables (Telinfy lcustomParam).
      const rcsVars = channel === 'rcs' && selectedRcsTemplate
        ? { template_name: selectedRcsTemplate.template_name, ...resolveRcsVarsForRecipient({
            source_type: 'test', source_ref_id: 'test', full_name: testName, first_name: firstName,
            phone: recipientAddress, email: null,
          } as any) }
        : null;

      // Call dispatcher DIRECTLY so we get a real per-send result. Going
      // through send-broadcast returns an async 202 ACK (v4.0.0 background
      // mode) with no `sent` count — the wizard used to interpret that as
      // "Test failed: unknown" even when the message actually went out.
      const dedupe = `wizard_test:${channel}:${recipientAddress}:${Date.now()}`;
      const { data, error } = await supabase.functions.invoke('dispatch-communication', {
        body: {
          branch_id: branchId,
          channel,
          recipient: recipientAddress,
          category: 'marketing',
          payload: {
            subject: channel === 'email' ? (subject.trim() || 'Test message') : undefined,
            body: buildFinalMessage(),
            variables: rcsVars ?? perVars,
          },
          template_id: templateId,
          dedupe_key: dedupe,
          force: true,
          ...(attachment ? { attachment: { url: attachment.url, kind: attachment.kind, filename: attachment.filename } } : {}),
        },
      });
      if (error) throw error;
      const r = (data ?? {}) as any;
      const status = String(r?.status ?? '').toLowerCase();
      if (['sent', 'queued', 'deduped'].includes(status)) {
        toast.success(`Test ${status} to ${target} as ${firstName} (${nameSource})${r?.provider_message_id ? ` · id: ${r.provider_message_id}` : ''}`);
      } else {
        const detail = describeProviderPayload(r) || 'No provider detail returned';
        toast.error(`Test ${status || 'failed'}: ${detail}`, { duration: 12000 });
      }
    } catch (e: any) {
      toast.error(`Test send failed: ${await describeInvokeError(e)}`, { duration: 12000 });
    } finally { setSendingTest(false); }
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
    setSelectedChannels(['whatsapp']); setChannelDrafts({}); setSelectedClassIds([]);
    setFilter({ status: 'active' }); setResolvedMemberIds([]);
    setMessage(''); setSubject(''); setTrigger('send_now'); setScheduledAt('');
    setAttachment(null);
    setEventName(''); setEventDate(''); setEventTime(''); setEventVenue(''); setEventRsvpUrl('');
    setUseApprovedTemplate(false); setSelectedTemplateId(null);
    setDraftCampaignId(null); setShowAllTemplates(false);
    setEvergreenAppliedFor(null); setEvergreenPickedName(null);
    setVarOverrides({});
  };

  const close = () => { reset(); onOpenChange(false); };

  const insertVar = (v: string) => setMessage((m) => `${m}${v}`);

  const buildFinalMessage = (body0?: string) => {
    let body = (body0 ?? message).trim();
    const alreadyHasEvent =
      (!!eventName && body.includes(eventName)) || /\{\{\s*class_(name|when)\s*\}\}/.test(body);
    if (isEvent && !alreadyHasEvent && (eventName || eventDate || eventVenue)) {
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

  /** Auto-fill event fields + message slots from one or more scheduled classes. */
  const applyClassSelections = (ids: string[]) => {
    setSelectedClassIds(ids);
    const picked = (upcomingClasses as any[]).filter((c: any) => ids.includes(c.id));
    if (picked.length === 0) return;
    const primary = picked[0];
    const whenList = picked.map((c: any) => formatClassWhen(c.scheduled_at)).filter(Boolean);
    const when = whenList.join(' · ');
    const d = new Date(primary.scheduled_at);
    const names = Array.from(new Set(picked.map((c: any) => c.name).filter(Boolean)));
    setEventName(names.join(' + '));
    setEventDate(Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10));
    setEventTime(
      Number.isNaN(d.getTime())
        ? ''
        : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
    );
    const detail = picked
      .map((c: any) => [
        c.name,
        formatClassWhen(c.scheduled_at),
        c.trainer_name ? `with ${c.trainer_name}` : '',
        c.duration_minutes ? `${c.duration_minutes} min` : '',
      ].filter(Boolean).join(' · '))
      .join('\n');

    // Fill named class_* tokens and, for Meta positional templates, the
    // remaining non-auto slots in order (class name → when → details).
    const queue = [names.join(' + '), when, detail || eventVenue || 'Limited spots — book now'];
    const next: Record<string, string> = { ...varOverrides };
    let qi = 0;
    extractTemplateVars(message).forEach((v) => {
      if (isAutoVar(v)) return;
      if (v.key === 'class_name') { next[v.key] = names.join(' + '); return; }
      if (v.key === 'class_when') { next[v.key] = when; return; }
      if (v.key === 'class_details') { next[v.key] = detail; return; }
      if (v.key === 'class_trainer') {
        next[v.key] = Array.from(new Set(picked.map((c: any) => c.trainer_name).filter(Boolean))).join(', ');
        return;
      }
      if (v.key === 'class_venue') { next[v.key] = eventVenue || ''; return; }
      if (v.key === 'poster_url' && attachment?.url) { next[v.key] = attachment.url; return; }
      next[v.key] = queue[Math.min(qi, queue.length - 1)] || '';
      qi += 1;
    });
    setVarOverrides(next);
  };

  const toggleClass = (classId: string) => {
    const ids = selectedClassIds.includes(classId)
      ? selectedClassIds.filter((id) => id !== classId)
      : [...selectedClassIds, classId];
    if (ids.length === 0) { setSelectedClassIds([]); return; }
    applyClassSelections(ids);
  };


  // Cold-audience template enforcement (only meaningful for WhatsApp)
  const coldCount = breakdown?.cold ?? 0;
  const totalCount = breakdown?.total ?? resolvedMemberIds.length;
  const isCsv = filter.audience_kind === 'csv_import';
  const requiresTemplate = channel === 'whatsapp' && (coldCount > 0 || isCsv);
  const templatePicked = useApprovedTemplate && !!selectedTemplateId && !selectedTemplateId.startsWith('__meta__:');
  // Selected template's live Meta status (may be PENDING when scheduling ahead of approval).
  const selectedTemplateMeta = (approvedTemplates as any[]).find((t) => t.id && t.id === selectedTemplateId);
  const selectedTemplatePending = selectedTemplateMeta?.meta_template_status === 'PENDING';
  // For send_now, PENDING templates are useless — Meta will reject. For
  // scheduled / automated triggers, PENDING is allowed: the worker re-checks
  // template status at fire time (issue #2).
  const templateReadyForTrigger = templatePicked && (trigger !== 'send_now' || !selectedTemplatePending);
  const blockedByTemplate = requiresTemplate && !templateReadyForTrigger;

  // ─── Per-channel drafts ────────────────────────────────────────────────────
  const captureDraft = (): ChannelDraft => ({
    message,
    subject,
    varOverrides,
    templateId: selectedTemplateId,
    useApprovedTemplate,
    evergreenName: evergreenPickedName,
  });

  const applyDraft = (next: CampaignChannel, draft?: ChannelDraft) => {
    if (draft) {
      setMessage(draft.message);
      setSubject(draft.subject);
      setVarOverrides(draft.varOverrides);
      setSelectedTemplateId(draft.templateId);
      setUseApprovedTemplate(draft.useApprovedTemplate);
      setEvergreenPickedName(draft.evergreenName);
      setEvergreenAppliedFor(`${next}:${campaignType}`);
    } else {
      // Fresh channel — clear everything so the evergreen effect can seed the
      // right body/subject for THIS channel (no cross-channel bleed).
      setMessage('');
      setSubject('');
      setVarOverrides({});
      setSelectedTemplateId(null);
      setUseApprovedTemplate(false);
      setEvergreenPickedName(null);
      setEvergreenAppliedFor(null);
    }
  };

  const switchChannel = (next: CampaignChannel) => {
    if (next === channel) return;
    const current = channel;
    const snapshot = captureDraft();
    setChannelDrafts((d) => ({ ...d, [current]: snapshot }));
    applyDraft(next, channelDrafts[next]);
    setChannel(next);
  };

  const toggleChannel = (id: CampaignChannel) => {
    const isOn = selectedChannels.includes(id);
    if (isOn) {
      if (selectedChannels.length === 1) { switchChannel(id); return; }
      const remaining = selectedChannels.filter((c) => c !== id);
      setSelectedChannels(remaining);
      setChannelDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
      if (channel === id) switchChannel(remaining[0]);
      return;
    }
    setSelectedChannels([...selectedChannels, id]);
    switchChannel(id);
  };

  /** Drafts for every selected channel, with the live editor state folded in. */
  const allChannelDrafts = (): Array<{ channel: CampaignChannel; draft: ChannelDraft }> =>
    selectedChannels.map((c) => ({
      channel: c,
      draft: c === channel ? captureDraft() : (channelDrafts[c] || { message: '', subject: '', varOverrides: {}, templateId: null, useApprovedTemplate: false, evergreenName: null }),
    }));

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Campaign name required'); return; }
    if (selectedChannels.length === 0) { toast.error('Pick at least one channel'); return; }
    if (totalCount === 0) { toast.error('Audience is empty'); return; }
    if (isEvent && !eventName.trim()) { toast.error('Event name required'); return; }
    if (trigger === 'scheduled' && !scheduledAt) { toast.error('Pick a date and time'); return; }
    if (trigger === 'scheduled' && new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error('Scheduled time must be in the future'); return;
    }

    const drafts = allChannelDrafts();
    for (const { channel: ch, draft } of drafts) {
      if (ch !== 'rcs' && !draft.message.trim()) {
        toast.error(`${ch.toUpperCase()}: message is empty`); return;
      }
      if (ch === 'email' && !draft.subject.trim()) {
        toast.error('Email: subject is required'); return;
      }
      if (ch === 'rcs' && !rcsTemplateId) {
        toast.error('Pick an RCS template — Telinfy RCS is template-only'); return;
      }
      if (ch === 'whatsapp' && blockedByTemplate) {
        const detail = templatePicked && selectedTemplatePending && trigger === 'send_now'
          ? 'This template is still awaiting Meta approval — schedule for later, or pick an APPROVED template.'
          : `${coldCount} recipient(s) are outside the 24h WhatsApp window — pick an APPROVED Meta template before sending.`;
        toast.error(detail); return;
      }
      const missing = extractTemplateVars(draft.message)
        .filter((v) => !isAutoVar(v))
        .filter((v) => !(draft.varOverrides[v.key] || '').trim())
        .map((v) => v.token);
      if (missing.length) {
        toast.error(`${ch.toUpperCase()}: fill template slots ${missing.join(', ')}`); return;
      }
    }

    setSubmitting(true);
    try {
      const groupId = drafts.length > 1 ? crypto.randomUUID() : null;
      let lastError: any = null;
      let created = 0;

      for (const { channel: ch, draft } of drafts) {
        const finalMessage = buildFinalMessage(draft.message);
        const payload = {
          branch_id: branchId,
          name: drafts.length > 1 ? `${name.trim()} · ${ch.toUpperCase()}` : name.trim(),
          channel: ch,
          audience_filter: filter,
          message: finalMessage,
          subject: ch === 'email' ? draft.subject.trim() || null : null,
          trigger_type: trigger,
          scheduled_at: trigger === 'scheduled' ? new Date(scheduledAt).toISOString() : null,
          attachment_url: attachment?.url ?? null,
          attachment_kind: attachment?.kind ?? null,
          attachment_filename: attachment?.filename ?? null,
          campaign_type: campaignType,
          fallback_policy: { on_pacing: fallbackOnPacing, ...(groupId ? { group_id: groupId } : {}) },

          event_meta: isEvent ? {
            name: eventName.trim(),
            date: eventDate || null,
            time: eventTime || null,
            venue: eventVenue.trim() || null,
            rsvp_url: eventRsvpUrl.trim() || null,
            class_id: selectedClassIds[0] ?? null,
            class_ids: selectedClassIds,
          } : {},
          template_id: ch === 'whatsapp' && draft.useApprovedTemplate && draft.templateId && !draft.templateId.startsWith('__meta__:') ? draft.templateId : null,
          template_variables: filledVariables(draft.varOverrides),
          status: (
            trigger === 'send_now' ? 'sending' :
            trigger === 'scheduled' ? 'scheduled' : 'draft'
          ) as any,
        };

        try {
          // Reuse the draft/editing row only for the first (primary) channel.
          const targetId = created === 0 ? (editingCampaign?.id || draftCampaignId) : null;
          const campaign = targetId
            ? await updateCampaign(targetId, payload as any).then((c) => c)
            : await createCampaign(payload as any);

          if (trigger === 'send_now') {
            const useResolver = filter.audience_kind && filter.audience_kind !== 'members';
            const audience = useResolver
              ? { recipients: await (await import('@/services/campaignService')).resolveCampaignAudience(branchId, filter) }
              : { memberIds: resolvedMemberIds };
            const audienceSize = useResolver
              ? (audience as any).recipients?.length ?? 0
              : (audience as any).memberIds?.length ?? 0;
            if (audienceSize === 0) {
              try { await updateCampaign(campaign.id, { status: 'draft' as any }); } catch {}
              toast.error('Audience is empty — pick contacts or members before sending.');
              setSubmitting(false);
              return;
            }
            const rcsVariables = ch === 'rcs' && selectedRcsTemplate
              ? { template_name: selectedRcsTemplate.template_name, ...rcsVarMap }
              : undefined;
            const fixedVars = filledVariables(draft.varOverrides);
            const sendVariables = rcsVariables
              ? { ...fixedVars, ...rcsVariables }
              : (Object.keys(fixedVars).length ? fixedVars : undefined);
            const result = await sendCampaignNow(campaign, { ...audience, variables: sendVariables });
            toast.success(`${ch.toUpperCase()} — queued for ${result.total} recipients.`);
          } else if (trigger === 'automated') {
            const cron = recurrencePresetToCron(recurrence, customCron);
            await createRecurringCampaignRule({
              branch_id: branchId,
              campaign_id: campaign.id,
              name: payload.name,
              cron_expression: cron,
            });
            toast.success(`${ch.toUpperCase()} — recurring rule created (${cron})`);
          }
          created += 1;
        } catch (err: any) {
          lastError = err;
          toast.error(`${ch.toUpperCase()}: ${err?.message || 'failed'}`);
        }
      }

      if (trigger === 'scheduled' && created > 0) {
        toast.success(`Scheduled for ${new Date(scheduledAt).toLocaleString()} on ${created} channel(s)`);
      }
      qc.invalidateQueries({ queryKey: ['campaigns', branchId] });
      qc.invalidateQueries({ queryKey: ['automation_rules'] });
      if (created > 0) close();
      else if (lastError) throw lastError;
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
          <Megaphone className="h-5 w-5 text-primary" /> Create Marketing Campaign
        </ResponsiveSheetTitle>
        <ResponsiveSheetDescription>Reach the right members with the right message</ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <div className="px-1 pb-2">
        {/* Stepper */}
        <div className="flex items-center justify-between mb-6">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex-1 flex items-center">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                step > i + 1 ? 'bg-success text-primary-foreground' : step === i + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
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

            {(campaignType === 'promotion' || campaignType === 'lead_reengagement') && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="text-lg leading-none mt-0.5">⚠️</span>
                  <div className="text-[12px] text-amber-900 dark:text-amber-200 leading-relaxed">
                    <p className="font-semibold mb-1">About WhatsApp Marketing pacing (error 131049)</p>
                    <p>
                      Meta throttles MARKETING templates per recipient based on their engagement history — this happens on <b>every</b> WhatsApp API (Cloud, On-Prem, Marketing Messages Lite). Swapping APIs does not bypass it.
                      To actually reach paced users, enable the automatic fallback below.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={fallbackOnPacing}
                    onChange={(e) => setFallbackOnPacing(e.target.checked)}
                    className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-amber-900 dark:text-amber-200">
                    Auto-fallback to <b>RCS / SMS</b> when Meta paces a recipient (131049 / 130472)
                  </span>
                </label>
              </div>
            )}
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
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Channels</Label>
                <span className="text-[11px] text-muted-foreground">Tap to add · tap the × to remove</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'emerald' },
                  { id: 'rcs', label: 'RCS', icon: Radio, color: 'violet' },
                  { id: 'email', label: 'Email', icon: Mail, color: 'blue' },
                  { id: 'sms', label: 'SMS', icon: MessageSquare, color: 'amber' },
                ] as const).map((c) => {
                  const selected = selectedChannels.includes(c.id as CampaignChannel);
                  const active = channel === c.id;
                  const canRemove = selected && selectedChannels.length > 1;
                  return (
                    <div key={c.id} className="relative">
                      <button
                        type="button"
                        aria-label={`${c.label} channel`}
                        aria-pressed={selected}
                        onClick={() => (selected ? switchChannel(c.id as CampaignChannel) : toggleChannel(c.id as CampaignChannel))}
                        className={`w-full relative cursor-pointer rounded-xl p-3 border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                          active ? 'border-primary bg-primary/10 shadow-md'
                          : selected ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-card hover:border-primary/30'
                        }`}
                      >
                        {selected && !canRemove && (
                          <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                        <c.icon className={`h-5 w-5 mx-auto ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                        <p className={`text-xs mt-1 font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>{c.label}</p>
                      </button>
                      {canRemove && (
                        <button
                          type="button"
                          aria-label={`Remove ${c.label} channel`}
                          title={`Remove ${c.label}`}
                          onClick={(e) => { e.stopPropagation(); toggleChannel(c.id as CampaignChannel); }}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow cursor-pointer hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {selectedChannels.length > 1 && (
                <div className="mt-2 rounded-xl bg-primary/5 border border-primary/20 p-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{selectedChannels.length} channels selected.</span>{' '}
                    Each channel keeps its own message and template — you're editing{' '}
                    <span className="font-semibold text-primary">{channel.toUpperCase()}</span> now. One campaign row is created per channel.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedChannels.map((c) => {
                      const draft = c === channel ? { message, subject } : (channelDrafts[c] || { message: '', subject: '' });
                      const ready = c === 'rcs' ? !!rcsTemplateId : !!draft.message.trim() && (c !== 'email' || !!draft.subject.trim());
                      return (
                        <button key={c} type="button" onClick={() => switchChannel(c)}
                          className={`cursor-pointer text-[11px] px-2 py-1 rounded-full border ${
                            c === channel ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground'
                          }`}>
                          {c.toUpperCase()} · {ready ? 'ready' : 'draft'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Class picker (Event / Class campaigns) — multi-select ── */}
            {isEvent && (
              <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" /> Pick scheduled class(es)
                  </Label>
                  {selectedClassIds.length > 0 && (
                    <button type="button" onClick={() => setSelectedClassIds([])}
                      className="cursor-pointer text-[11px] text-muted-foreground hover:text-destructive">
                      Clear ({selectedClassIds.length})
                    </button>
                  )}
                </div>
                {upcomingClasses.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No upcoming classes for this branch — fill the event details manually on the Event step.</p>
                ) : (
                  <div className="max-h-52 overflow-y-auto rounded-xl border bg-card divide-y">
                    {(upcomingClasses as any[]).map((c: any) => {
                      const on = selectedClassIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleClass(c.id)}
                          className={`w-full cursor-pointer flex items-center gap-2.5 px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${on ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                        >
                          <span className={`h-4 w-4 shrink-0 rounded-[5px] border flex items-center justify-center ${on ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-foreground truncate">{c.name}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">
                              {formatClassWhen(c.scheduled_at)}{c.trainer_name ? ` · ${c.trainer_name}` : ''}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Pick one or more sessions (e.g. morning + evening). Every <code>{'{{class_*}}'}</code> / positional slot is filled with the combined list.
                </p>
              </div>
            )}


            {/* ── RCS (Telinfy) template selection + variable mapping ── */}
            {channel === 'rcs' && (
              <div className="rounded-2xl border-2 border-violet-500/25 bg-violet-500/5 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-violet-600" />
                  <Label className="text-xs font-semibold text-violet-700 dark:text-violet-300">RCS (Telinfy) — template required</Label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Telinfy RCS is template-only. Pick an approved template and map each variable to a CRM field or a static value.
                  Recipients on non-RCS devices automatically fall back to SMS.
                </p>
                {rcsTemplates.length === 0 ? (
                  <div className="text-xs text-warning bg-warning/10 border border-warning/25 rounded-lg p-2">
                    No RCS templates synced yet. Go to <strong>Settings → RCS Hub → Templates</strong> to sync from Telinfy.
                  </div>
                ) : (
                  <>
                    <Select value={rcsTemplateId || ''} onValueChange={setRcsTemplateId}>
                      <SelectTrigger className="rounded-xl bg-card"><SelectValue placeholder="Pick an RCS template…" /></SelectTrigger>
                      <SelectContent>
                        {(rcsTemplates as any[]).map((t: any) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.template_name}{t.kind ? ` · ${t.kind}` : ''}{t.status && t.status !== 'approved' ? ` · ${t.status}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedRcsTemplate && (
                      <div className="rounded-xl border bg-card p-2.5 space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Template preview</p>
                        <pre className="text-xs whitespace-pre-wrap text-foreground font-sans">{selectedRcsTemplate.body_preview || '(no body preview available)'}</pre>
                      </div>
                    )}
                    {rcsVarKeys.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Variable mapping</p>
                        {rcsVarKeys.map((k) => (
                          <div key={k} className="flex items-center gap-2">
                            <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[11px] shrink-0 min-w-[110px] truncate">{`{{${k}}}`}</code>
                            <Input
                              className="rounded-lg h-8 text-xs flex-1"
                              placeholder="Static value or {{first_name}} / {{full_name}} / {{email}}"
                              value={rcsVarMap[k] ?? ''}
                              onChange={(e) => setRcsVarMap((m) => ({ ...m, [k]: e.target.value }))}
                            />
                          </div>
                        ))}
                        <p className="text-[10px] text-muted-foreground">
                          Tokens <code>{'{{first_name}}'}</code>, <code>{'{{full_name}}'}</code>, and <code>{'{{email}}'}</code> resolve per recipient at send-time.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {channel === 'email' && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Subject</Label>
                <Input className="rounded-xl" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
              </div>
            )}

            {channel === 'whatsapp' && requiresTemplate && !templatePicked && (
              <div className="rounded-2xl border-2 border-warning/40 bg-warning/10 dark:bg-warning/10 p-3 flex gap-2.5">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div className="text-sm text-warning dark:text-warning">
                  <p className="font-semibold mb-0.5">{coldCount} of {totalCount} recipient(s) are outside the 24h WhatsApp window.</p>
                  <p className="text-[12px]">WhatsApp will reject freeform messages to them (Meta error 131047). <b>Pick an APPROVED Meta template below</b>, or narrow the audience.</p>
                </div>
              </div>
            )}
            {channel === 'whatsapp' && requiresTemplate && templatePicked && (
              <div className="rounded-2xl border-2 border-success/40 bg-success/10 dark:bg-success/10 p-3 flex gap-2.5">
                <ShieldCheck className="h-5 w-5 text-success shrink-0 mt-0.5" />
                <div className="text-sm text-success dark:text-success">
                  <p className="font-semibold mb-0.5">Approved template will be used for {coldCount} cold recipient(s).</p>
                  <p className="text-[12px]">In-window recipients ({Math.max(0, totalCount - coldCount)}) get your freeform message; cold recipients get the approved template.</p>
                </div>
              </div>
            )}

            {channel === 'whatsapp' && (
              <div className="rounded-2xl border-2 border-success/25 bg-success/10 dark:bg-success/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="h-4 w-4 text-success shrink-0" />
                    <div className="min-w-0">
                      <Label className="text-xs font-semibold text-success block">Send via approved Meta template</Label>
                      <p className="text-[11px] text-success">Required for cold leads / contacts outside the 24h messaging window.</p>
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
                      <div className="text-xs text-warning bg-warning/10 border border-warning/25 rounded-lg p-2 space-y-1">
                        <p className="font-semibold">No approved Meta templates yet.</p>
                        <p>Generate one in <strong>Settings → Communication Templates → AI Studio</strong>, or click <strong>Sync from Meta</strong> above to pull the latest approval list.</p>
                      </div>
                    ) : (() => {
                        // Scope templates to this campaign first, then by campaign type.
                        // Full list only when the user explicitly asks for it.
                        const all = approvedTemplates as any[];
                        const forThis = all.filter((t) => t.id && t.id === selectedTemplateId);
                        const forType = all.filter((t) =>
                          !forThis.includes(t) && (t.evergreen_kind === campaignType),
                        );
                        const other = all.filter((t) => !forThis.includes(t) && !forType.includes(t));
                        const scoped = showAllTemplates ? [...forThis, ...forType, ...other] : [...forThis, ...forType];
                        const renderList = scoped.length ? scoped : all; // never leave the picker empty
                        return (
                          <Select
                            value={selectedTemplateId || ''}
                            onValueChange={(id) => {
                              setSelectedTemplateId(id);
                              const t: any = all.find((x: any) => x.id === id);
                              if (t?.content) setMessage(t.content);
                              if (t?.header_type && t.header_type !== 'none' && attachment?.kind !== t.header_type) {
                                toast.info(`This template needs a ${t.header_type} header — upload one below.`);
                              }
                            }}
                          >
                            <SelectTrigger className="rounded-xl bg-card"><SelectValue placeholder="Pick a template…" /></SelectTrigger>
                            <SelectContent>
                              {renderList.map((t: any) => (
                                <SelectItem key={t.meta_template_name} value={t.id || `__meta__:${t.meta_template_name}`}>
                                  {t.name}
                                  {t.meta_template_status === 'PENDING' ? '  · ⏳ pending Meta' : ''}
                                  {t.category ? ` · ${t.category.toLowerCase()}` : ''}
                                  {t.header_type && t.header_type !== 'none' ? ` · ${t.header_type}` : ''}
                                  {t.language && t.language !== 'en' ? ` · ${t.language}` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      })()
                    }
                    {approvedTemplates.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllTemplates((v) => !v)}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        {showAllTemplates ? 'Show only templates for this campaign type' : `Show all ${approvedTemplates.length} templates`}
                      </button>
                    )}
                    {selectedTemplateId && selectedTemplateId.startsWith('__meta__:') && (
                      <p className="text-[11px] text-warning bg-warning/10 border border-warning/25 rounded-lg p-2">
                        This Meta template has no local CRM row yet. Click <strong>Sync from Meta</strong> once to materialize it before sending.
                      </p>
                    )}
                    {selectedTemplateId && !selectedTemplateId.startsWith('__meta__:') && (
                      <p className="text-[11px] text-success">
                        Body is locked to the approved template content. You can still personalize variables and attach the required header media below.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {evergreenPickedName && (
              <div className="rounded-2xl border-2 border-primary/25 bg-primary/10 dark:bg-primary/10 p-3 flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="text-sm text-primary dark:text-primary flex-1">
                  <p className="font-semibold mb-0.5">Evergreen template applied: <span className="font-mono text-[12px]">{evergreenPickedName}</span></p>
                  <p className="text-[11px]">Reusable Meta-friendly base for <b>{campaignType.replace('_', ' ')}</b> campaigns. Edit freely or pick a different evergreen below.</p>
                  {evergreenTemplates.length > 1 && (
                    <Select
                      value={evergreenPickedName}
                      onValueChange={(n) => {
                        const t: any = (evergreenTemplates as any[]).find((x) => x.name === n);
                        if (!t) return;
                        setMessage(t.content || '');
                        if (channel === 'email' && t.subject) setSubject(t.subject);
                        setEvergreenPickedName(t.name);
                        if (channel === 'whatsapp' && t.id && t.meta_template_status === 'approved') {
                          setUseApprovedTemplate(true); setSelectedTemplateId(t.id);
                        }
                      }}
                    >
                      <SelectTrigger className="rounded-lg bg-card mt-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(evergreenTemplates as any[]).map((t: any) => (
                          <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]"
                  onClick={() => { setEvergreenPickedName(null); setMessage(''); }}>
                  Clear
                </Button>
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
                  className="rounded-full h-7 px-3 text-xs gap-1.5 border-primary/25 bg-primary/10 hover:bg-primary/15 text-primary"
                >
                  <Sparkles className="h-3 w-3" /> Draft with AI
                </Button>
              </div>

              {aiOpen && (
                <div className="rounded-2xl border-2 border-primary/25 bg-primary/10 p-3 mb-3 space-y-2">
                  <Label className="text-[11px] uppercase tracking-wider text-primary font-semibold">Describe what you want to say</Label>
                  <Textarea
                    className="rounded-xl bg-card min-h-[80px]"
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
                      className="rounded-full bg-primary hover:bg-primary text-primary-foreground gap-1.5"
                    >
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      Generate
                    </Button>
                  </div>
                  <p className="text-[10px] text-primary">
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
                    className="rounded-full h-7 px-3 text-xs gap-1.5 border-success/25 bg-success/10 hover:bg-success/15 text-success"
                    title="Submit this body to Meta as a reusable WhatsApp template (PENDING approval)"
                  >
                    {submittingMeta ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Submit to Meta
                  </Button>
                )}
              </div>
            </div>

            {/* ─── Variable Legend + Live Preview + Send Test ───────────────── */}
            {message.trim().length > 0 && (() => {
              const vars = extractTemplateVars(buildFinalMessage());
              const anyPositional = vars.some((v) => v.positional);
              const fillable = vars.filter((v) => !isAutoVar(v));
              const missing = fillable.filter((v) => !(varOverrides[v.key] || '').trim());
              const previewText = renderPreview(buildFinalMessage(), varOverrides);
              return (
                <div className="rounded-2xl border-2 border-primary/25 bg-primary/5 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-primary font-semibold">Preview &amp; Test</Label>
                    {anyPositional && channel === 'whatsapp' && (
                      <span className="text-[10px] text-primary/80 font-mono">Meta positional variables detected</span>
                    )}
                  </div>

                  {vars.length > 0 && (
                    <div className="rounded-xl bg-card border p-2.5 space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Variables in this message</p>
                      {vars.filter(isAutoVar).map((v) => (
                        <div key={v.token} className="flex items-center gap-2 text-[12px]">
                          <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground shrink-0">{v.token}</code>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-foreground truncate"><b>{v.label}</b></span>
                          <span className="text-muted-foreground text-[11px] truncate">auto per recipient</span>
                        </div>
                      ))}
                      {fillable.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Fill these values — they go out to everyone
                          </p>
                          {fillable.map((v) => (
                            <div key={v.token} className="flex items-center gap-2">
                              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground shrink-0 w-14 text-center">{v.token}</code>
                              <Input
                                className="rounded-xl h-9 text-sm flex-1"
                                placeholder={v.positional ? `Value for slot ${v.key}` : v.label}
                                value={varOverrides[v.key] ?? ''}
                                onChange={(e) => setVarOverrides((p) => ({ ...p, [v.key]: e.target.value }))}
                                aria-label={`Value for ${v.token}`}
                              />
                            </div>
                          ))}
                          {missing.length > 0 && (
                            <p className="text-[10px] text-destructive leading-relaxed">
                              {missing.map((m) => m.token).join(', ')} empty —{' '}
                              {channel === 'whatsapp'
                                ? 'WhatsApp rejects sends with blank slots (template_param_empty).'
                                : 'recipients would see a blank gap in the message.'}
                            </p>
                          )}
                        </div>
                      )}
                      {anyPositional && channel === 'whatsapp' && (
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Meta stores approved templates with numbered slots ({'{{1}}, {{2}}…'}). Slot 1 is always the recipient's name; the rest are the values you type above.
                        </p>
                      )}
                    </div>
                  )}


                  {/* Channel-accurate preview */}
                  {channel === 'email' ? (
                    <div className="rounded-xl border bg-muted/30 p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Email preview</p>
                      <div className="rounded-lg overflow-hidden border bg-white">
                        <div className="px-3 py-2 border-b bg-slate-50">
                          <p className="text-[11px] text-slate-500">From: The Incline Life by Incline</p>
                          <p className="text-[13px] font-semibold text-slate-900 truncate">
                            {renderPreview(subject || '(no subject)', varOverrides)}
                          </p>
                        </div>
                        {attachment?.kind === 'image' && (
                          <img src={attachment.url} alt="Campaign banner" className="w-full max-h-56 object-cover" />
                        )}
                        <div
                          className="px-4 py-3 text-[13px] leading-relaxed text-slate-800"
                          dangerouslySetInnerHTML={{ __html: emailPreviewHtml(previewText) }}
                        />
                        <div className="px-4 py-2 border-t text-[10px] text-slate-400">
                          You're receiving this because you're a member of The Incline Life by Incline.
                        </div>
                      </div>
                      {attachment && attachment.kind !== 'image' && (
                        <p className="text-[10px] text-muted-foreground mt-1.5">+ attachment: {attachment.filename} ({attachment.kind})</p>
                      )}
                    </div>
                  ) : channel === 'sms' ? (
                    <div className="rounded-xl bg-card border p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">SMS preview</p>
                      <pre className="text-xs whitespace-pre-wrap text-foreground font-sans leading-relaxed">{previewText}</pre>
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        {previewText.length} chars · {Math.max(1, Math.ceil(previewText.length / 160))} SMS part(s) · DLT-approved sender required
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border p-2.5 bg-[#ece5dd] dark:bg-muted">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                        {channel === 'rcs' ? 'RCS preview' : 'WhatsApp preview'}
                      </p>
                      <div className="max-w-[85%] ml-auto rounded-2xl rounded-tr-sm bg-[#dcf8c6] dark:bg-success/20 px-3 py-2 shadow-sm">
                        {attachment?.kind === 'image' && (
                          <img src={attachment.url} alt="Campaign poster" className="rounded-lg mb-1.5 w-full object-cover max-h-48" />
                        )}
                        <pre className="text-xs whitespace-pre-wrap text-slate-900 dark:text-foreground font-sans leading-relaxed">{previewText}</pre>
                        <p className="text-[9px] text-slate-500 text-right mt-1">
                          {new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      {attachment && attachment.kind !== 'image' && (
                        <p className="text-[10px] text-muted-foreground mt-1.5">+ attachment: {attachment.filename} ({attachment.kind})</p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Input
                      className="rounded-xl h-9 text-sm flex-1"
                      placeholder={channel === 'email' ? 'you@example.com' : '+91XXXXXXXXXX'}
                      value={testRecipient}
                      onChange={(e) => setTestRecipient(e.target.value)}
                      disabled={sendingTest}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSendTest}
                      disabled={sendingTest || !testRecipient.trim() || missing.length > 0}
                      className="rounded-full h-9 px-4 gap-1.5 bg-primary hover:bg-primary text-primary-foreground"
                      title={missing.length > 0 ? `Fill ${missing.map((m) => m.token).join(', ')} first` : 'Send this exact message to yourself using the same pipeline as real campaigns'}
                    >
                      {sendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Send Test
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    Uses the exact same delivery path as a real send (template, attachments, variables). Test-Sends are not logged to campaign analytics.
                  </p>
                </div>
              );
            })()}

            {/* ─── Telinfy Bulk CSV Export (emergency fallback) ─────────────── */}
            {(channel === 'rcs' || channel === 'whatsapp' || channel === 'sms') && (
              <div className="rounded-2xl border border-dashed p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">Emergency bulk send</p>
                  <p className="text-[11px] text-muted-foreground">
                    Download this audience in Telinfy's CSV format (CountryCode, MSISDN, per-variable columns) for manual upload if the CRM pipeline is unavailable.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full h-8 px-3 text-xs gap-1.5 shrink-0"
                  onClick={async () => {
                    try {
                      const { resolveCampaignAudience } = await import('@/services/campaignService');
                      const recips = await resolveCampaignAudience(branchId, filter);
                      const keys = channel === 'rcs' ? rcsVarKeys : ['full_name'];
                      const { buildTelinfyCsv } = await import('./TelinfyBulkExport');
                      const csv = buildTelinfyCsv({
                        campaignName: name || 'campaign',
                        recipients: recips as any,
                        variableKeys: keys.length ? keys : ['full_name'],
                        resolveVar: channel === 'rcs' && selectedRcsTemplate
                          ? (r: any, k: string) => {
                              const mapped = rcsVarMap[k] || '';
                              const first = (r.full_name || '').trim().split(/\s+/)[0] || 'there';
                              const full = r.full_name || 'there';
                              return String(mapped)
                                .replace(/\{\{\s*first_name\s*\}\}/gi, first)
                                .replace(/\{\{\s*full_name\s*\}\}/gi, full)
                                .replace(/\{\{\s*member_name\s*\}\}/gi, full)
                                .replace(/\{\{\s*email\s*\}\}/gi, r.email || '');
                            }
                          : undefined,
                      });
                      const safe = (name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
                      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `telinfy_${safe}_${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success(`Downloaded ${(recips as any[]).filter((r: any) => r.phone).length} rows`);
                    } catch (e: any) {
                      toast.error(e?.message || 'Export failed');
                    }
                  }}
                >
                  <FileText className="h-3.5 w-3.5" /> Telinfy CSV
                </Button>
              </div>
            )}



            {(channel === 'whatsapp' || channel === 'email') && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> Flyer / Poster / Video (optional)
                </Label>
                {attachment ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2.5 rounded-xl border bg-muted/30">
                      {attachment.kind === 'image' ? <ImageIcon className="h-4 w-4 text-success" /> :
                       attachment.kind === 'video' ? <Film className="h-4 w-4 text-primary" /> :
                       <FileText className="h-4 w-4 text-warning" />}
                      <span className="text-sm flex-1 truncate">{attachment.filename}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment(null)} aria-label="Remove">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {attachment.kind === 'video' && (
                      <video src={attachment.url} controls playsInline className="rounded-xl border w-full max-h-56 bg-foreground" />
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
                  <div className="mt-2 rounded-xl border border-warning/25 bg-warning/10 dark:bg-warning/10 p-3 text-xs text-warning dark:text-warning">
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
            <div className="rounded-2xl bg-warning/10 border border-warning/25 p-3">
              <p className="text-[11px] uppercase tracking-wider text-warning font-semibold mb-1">Preview append</p>
              <pre className="text-xs whitespace-pre-wrap text-warning">{buildFinalMessage().slice(message.length).trim() || '— fill the fields above —'}</pre>
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
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${trigger === t.id ? `bg-${t.color}-600 text-primary-foreground` : 'bg-muted text-muted-foreground'}`}>
                    <t.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">{t.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
                  </div>
                </div>
              </button>
            ))}

            {selectedTemplatePending && trigger !== 'send_now' && (
              <div className="rounded-2xl border-2 border-warning/40 bg-warning/10 p-3 flex gap-2.5">
                <Clock className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div className="text-sm text-warning">
                  <p className="font-semibold mb-0.5">This template is still awaiting Meta approval.</p>
                  <p className="text-[12px]">If Meta approves it before your scheduled time, we send. If Meta rejects it, the campaign fails and you get a notification — no messages go out with a bad template.</p>
                </div>
              </div>
            )}


            {trigger === 'scheduled' && (
              <div className="rounded-2xl border-2 border-warning/25 bg-warning/10 p-4 space-y-2">
                <Label className="text-xs uppercase tracking-wider text-warning font-semibold">Send at (Asia/Kolkata)</Label>
                <Input
                  type="datetime-local"
                  className="rounded-xl bg-card"
                  value={scheduledAt}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <p className="text-[11px] text-warning">A background worker checks every minute and sends the campaign at the chosen time.</p>
              </div>
            )}

            {trigger === 'automated' && (
              <div className="rounded-2xl border-2 border-info/25 bg-info/10 p-4 space-y-3">
                <Label className="text-xs uppercase tracking-wider text-info font-semibold">Repeat schedule</Label>
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
                        recurrence === p.id ? 'border-info bg-card text-info font-medium' : 'border-transparent bg-card/60 text-info hover:border-info/40'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {recurrence === 'custom' && (
                  <div>
                    <Input
                      className="rounded-xl bg-card font-mono text-sm"
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                      placeholder="0 10 * * 1"
                    />
                    <p className="text-[11px] text-info mt-1">5-field cron (IST) · m h dom mon dow</p>
                  </div>
                )}
                <p className="text-[11px] text-info">
                  Audience is re-resolved on every run, so new members/leads matching the filter get included automatically. Manage in Settings → Automation Brain.
                </p>
              </div>
            )}

            <div className="rounded-2xl bg-muted/40 p-4 mt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Summary</p>
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Type:</span> <span className="font-medium capitalize">{campaignType.replace('_', ' ')}</span></div>
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{name || '—'}</span></div>
                <div><span className="text-muted-foreground">Channels:</span> <span className="font-medium">{selectedChannels.map((c) => c.toUpperCase()).join(' + ')}</span>{selectedChannels.length > 1 ? <span className="text-muted-foreground text-xs"> · one campaign per channel</span> : null}</div>
                <div><span className="text-muted-foreground">Recipients:</span> <span className="font-medium">{totalCount}{coldCount > 0 ? ` · ${coldCount} cold` : ''}</span></div>
                {requiresTemplate && (
                  <div><span className="text-muted-foreground">Template:</span> <span className={`font-medium ${templatePicked ? 'text-success' : 'text-warning'}`}>{templatePicked ? 'Approved Meta template selected' : 'Required — not selected'}</span></div>
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
            <Button onClick={() => setStep(step + 1)} className="rounded-xl bg-primary hover:bg-primary text-primary-foreground">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting || blockedByTemplate || missingSlotTokens.length > 0} title={blockedByTemplate ? 'Pick an approved Meta template — cold recipients require it' : missingSlotTokens.length > 0 ? `Fill template slots ${missingSlotTokens.join(', ')} on the Message step` : undefined} className="rounded-xl bg-primary hover:bg-primary text-primary-foreground">
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
