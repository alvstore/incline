import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Plus, Edit, Trash2, MessageSquare, Mail, Phone, Copy, Send, CheckCircle, Clock, XCircle, PauseCircle, Info, AlertCircle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { TEMPLATE_EVENTS, getEvent, validateTemplate, renderPreview } from '@/lib/templates/eventRegistry';
import { DYNAMIC_PDF_PRESETS, type TemplatePreset } from '@/lib/templates/dynamicAttachment';
import { FileText, Image as ImageIcon, Video as VideoIcon, Sparkles } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const TEMPLATE_TYPES = [
  { value: 'sms', label: 'SMS', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
];

const TEMPLATE_TRIGGERS = [
  { value: 'welcome', label: 'Welcome Message' },
  { value: 'expiry_reminder', label: 'Expiry Reminder' },
  { value: 'payment_received', label: 'Payment Received' },
  { value: 'payment_due', label: 'Payment Due' },
  { value: 'birthday', label: 'Birthday Wishes' },
  { value: 'class_reminder', label: 'Class Reminder' },
  { value: 'pt_session', label: 'PT Session Reminder' },
  { value: 'lead_welcome', label: 'Lead Welcome' },
  { value: 'team_alert', label: 'Team Alert (New Lead)' },
  { value: 'custom', label: 'Custom / Broadcast' },
];

const AVAILABLE_VARIABLES = [
  '{{member_name}}',
  '{{member_code}}',
  '{{days_left}}',
  '{{end_date}}',
  '{{plan_name}}',
  '{{amount}}',
  '{{invoice_number}}',
  '{{branch_name}}',
  '{{trainer_name}}',
  '{{class_name}}',
  '{{date}}',
  '{{time}}',
];

const META_CATEGORIES = [
  { value: 'UTILITY', label: 'Utility' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'AUTHENTICATION', label: 'Authentication' },
];

const META_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'kn', label: 'Kannada' },
  { value: 'mr', label: 'Marathi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'bn', label: 'Bengali' },
];

interface Template {
  id: string;
  name: string;
  type: string;
  trigger?: string;
  subject?: string;
  content: string;
  variables?: string[];
  is_active: boolean;
  created_at: string;
  meta_template_name?: string | null;
  meta_template_id?: string | null;
  meta_template_status?: string | null;
  meta_rejection_reason?: string | null;
  header_type?: 'none' | 'image' | 'document' | 'video' | null;
  header_media_url?: string | null;
  attachment_source?: 'none' | 'static' | 'dynamic' | null;
  attachment_filename_template?: string | null;
}

function metaStatusBadge(status: string | null | undefined) {
  if (!status) return null;
  const map: Record<string, { label: string; icon: any; className: string }> = {
    APPROVED: { label: 'Approved', icon: CheckCircle, className: 'bg-success/10 text-success border-success/20' },
    PENDING: { label: 'Pending', icon: Clock, className: 'bg-warning/10 text-warning border-warning/20' },
    REJECTED: { label: 'Rejected', icon: XCircle, className: 'bg-destructive/10 text-destructive border-destructive/20' },
    PAUSED: { label: 'Paused', icon: PauseCircle, className: 'bg-gray-100 text-gray-600 border-gray-200' },
    DISABLED: { label: 'Disabled', icon: PauseCircle, className: 'bg-gray-100 text-gray-600 border-gray-200' },
  };
  const cfg = map[status];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

interface TemplatePrefill {
  name: string;
  trigger: string;
  content: string;
  type?: 'whatsapp' | 'sms' | 'email';
  /** System event name (e.g. 'member_created') for whatsapp_triggers wiring. */
  eventName?: string;
}

interface TemplateManagerProps {
  /** When provided, auto-opens the editor pre-filled with this template draft. */
  prefill?: TemplatePrefill;
  /** Fired once the editor has consumed the prefill (so parent can clear it). */
  onPrefillConsumed?: () => void;
  /** When set, only show templates of this channel (hides outer channel tabs). */
  filterType?: 'whatsapp' | 'sms' | 'email';
  /** Hide the outer Card chrome (header + description); useful when embedded in a custom hub. */
  hideHeader?: boolean;
}

export function TemplateManager({ prefill, onPrefillConsumed, filterType, hideHeader }: TemplateManagerProps = {}) {
  const queryClient = useQueryClient();
  const { branchFilter, effectiveBranchId } = useBranchContext();
  const [showEditor, setShowEditor] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [pendingEventName, setPendingEventName] = useState<string | null>(null);
  const [showMetaDialog, setShowMetaDialog] = useState(false);
  const [metaTarget, setMetaTarget] = useState<Template | null>(null);
  const [metaForm, setMetaForm] = useState({
    name: '',
    category: 'UTILITY',
    language: 'en',
    body_text: '',
  });
  const [isSubmittingMeta, setIsSubmittingMeta] = useState(false);
  const [metaError, setMetaError] = useState<{
    message: string;
    user_title?: string | null;
    user_msg?: string | null;
    code?: number | null;
    subcode?: number | null;
    fbtrace_id?: string | null;
  } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    type: 'whatsapp',
    trigger: 'custom',
    subject: '',
    content: '',
    is_active: true,
    header_type: 'none' as 'none' | 'image' | 'document' | 'video',
    header_media_url: '',
    attachment_source: 'none' as 'none' | 'static' | 'dynamic',
    attachment_filename_template: '',
  });
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending' | 'rejected' | 'draft'>('all');
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['communication-templates'],
    queryFn: async () => {
      // Use the unified status view so we get approval_status (Approved/Pending/Rejected/Draft)
      const { data, error } = await supabase
        .from('v_template_with_meta_status' as any)
        .select('*')
        .order('type', { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // 7-day delivery counts per template (sent / failed / queued)
  const { data: deliveryStats = {} } = useQuery({
    queryKey: ['template-delivery-stats-7d'],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('communication_logs')
        .select('template_id, delivery_status, status, delivery_metadata')
        .gte('created_at', since)
        .not('template_id', 'is', null);
      const map: Record<string, { sent: number; failed: number; queued: number; delivered: number; read: number }> = {};
      for (const r of (data || []) as any[]) {
        if (!r.template_id) continue;
        const k = r.template_id as string;
        if (!map[k]) map[k] = { sent: 0, failed: 0, queued: 0, delivered: 0, read: 0 };
        const ds = (r.delivery_status || r.status || '').toString().toLowerCase();
        const wa = (r.delivery_metadata?.wa_status || '').toString().toLowerCase();
        if (wa === 'read') map[k].read++;
        else if (wa === 'delivered') map[k].delivered++;
        if (['sent', 'delivered', 'read'].includes(ds) || ['sent', 'delivered', 'read'].includes(wa)) map[k].sent++;
        else if (['failed', 'error', 'bounced', 'rejected'].includes(ds) || wa === 'failed') map[k].failed++;
        else map[k].queued++;
      }
      return map;
    },
    refetchInterval: 60_000,
  });

  /** After saving a template, optionally wire it to a system event in
   *  whatsapp_triggers so Templates Health flips green for that event. */
  const wireWhatsAppTrigger = async (templateId: string, eventName: string) => {
    if (!effectiveBranchId) return;
    const { data: existing } = await supabase
      .from('whatsapp_triggers')
      .select('id')
      .eq('branch_id', effectiveBranchId)
      .eq('event_name', eventName)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('whatsapp_triggers')
        .update({ template_id: templateId, is_active: true })
        .eq('id', existing.id);
    } else {
      await supabase.from('whatsapp_triggers').insert({
        branch_id: effectiveBranchId,
        event_name: eventName,
        template_id: templateId,
        is_active: true,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['whatsapp-triggers-health'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { data: inserted, error } = await supabase
        .from('templates')
        .insert(data)
        .select('id')
        .single();
      if (error) throw error;
      return inserted;
    },
    onSuccess: async (inserted) => {
      if (pendingEventName && inserted?.id) {
        try { await wireWhatsAppTrigger(inserted.id, pendingEventName); } catch (e) { console.error(e); }
      }
      toast.success('Template created');
      queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
      closeEditor();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const { error } = await supabase.from('templates').update(data).eq('id', id);
      if (error) throw error;
      return { id };
    },
    onSuccess: async ({ id }) => {
      if (pendingEventName && id) {
        try { await wireWhatsAppTrigger(id, pendingEventName); } catch (e) { console.error(e); }
      }
      toast.success('Template updated');
      queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
      closeEditor();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Template deleted');
      queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-triggers-health'] });
    },
    onError: (error: any) => toast.error(error.message),
  });

  const openEditor = (template?: Template) => {
    if (template) {
      setSelectedTemplate(template);
      setFormData({
        name: template.name,
        type: template.type,
        trigger: template.trigger || 'custom',
        subject: template.subject || '',
        content: template.content,
        is_active: template.is_active,
        header_type: (template.header_type as any) || 'none',
        header_media_url: template.header_media_url || '',
        attachment_source: (template.attachment_source as any) || 'none',
        attachment_filename_template: template.attachment_filename_template || '',
      });
    } else {
      setSelectedTemplate(null);
      setFormData({
        name: '',
        type: 'whatsapp',
        trigger: 'custom',
        subject: '',
        content: '',
        is_active: true,
        header_type: 'none',
        header_media_url: '',
        attachment_source: 'none',
        attachment_filename_template: '',
      });
    }
    setShowEditor(true);
  };

  /** Apply a one-click preset (e.g. Invoice PDF) to the editor form. */
  const applyPreset = (preset: TemplatePreset) => {
    setSelectedTemplate(null);
    setFormData({
      name: preset.label,
      type: preset.type,
      trigger: preset.trigger,
      subject: preset.subject || '',
      content: preset.content,
      is_active: true,
      header_type: preset.header_type,
      header_media_url: '',
      attachment_source: preset.attachment_source,
      attachment_filename_template: preset.attachment_filename_template || '',
    });
    setShowEditor(true);
    toast.success(`Loaded preset: ${preset.label}`);
  };

  /** Compact media badge shown next to template names in the list. */
  const mediaBadge = (t: Template) => {
    const ht = t.header_type || 'none';
    const src = t.attachment_source || 'none';
    if (ht === 'none' || src === 'none') return null;
    const icon = ht === 'image' ? ImageIcon : ht === 'video' ? VideoIcon : FileText;
    const Icon = icon;
    const label = `${src === 'dynamic' ? 'Dynamic' : 'Static'} ${ht === 'document' ? 'PDF' : ht.charAt(0).toUpperCase() + ht.slice(1)}`;
    const cls = src === 'dynamic'
      ? 'bg-violet-50 text-violet-700 border-violet-200'
      : 'bg-sky-50 text-sky-700 border-sky-200';
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  };

  /** Indicates how this template will deliver to the recipient. */
  const deliveryModeBadge = (t: Template) => {
    if (t.type !== 'whatsapp') return null;
    const ht = (t.header_type || 'none').toLowerCase();
    const approved = (t.meta_template_status || '').toUpperCase() === 'APPROVED';
    if (ht !== 'none' && approved) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200" title="Recipients receive a native WhatsApp document/image/video as the message header.">
          Native {ht === 'document' ? 'PDF' : ht}
        </span>
      );
    }
    if (ht !== 'none' && !approved) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200" title="Native delivery becomes active once Meta approves this template. Until then sends fall back to a link in the body.">
          Native (pending approval)
        </span>
      );
    }
    return null;
  };

  const closeEditor = () => {
    setShowEditor(false);
    setSelectedTemplate(null);
    setPendingEventName(null);
  };

  // Auto-open the editor pre-filled when parent passes a prefill payload
  // (used by the Templates Health → "Map" CTA to seed an event template).
  useEffect(() => {
    if (!prefill) return;
    setSelectedTemplate(null);
    setPendingEventName(prefill.eventName || null);
    setFormData({
      name: prefill.name,
      type: prefill.type || 'whatsapp',
      trigger: prefill.trigger || 'custom',
      subject: '',
      content: prefill.content,
      is_active: true,
      header_type: 'none',
      header_media_url: '',
      attachment_source: 'none',
      attachment_filename_template: '',
    });
    setShowEditor(true);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.content) {
      toast.error('Please fill in required fields');
      return;
    }

    // NOTE: `templates` table has no `trigger` column — event mapping lives in
    // `whatsapp_triggers`. We persist trigger via wireWhatsAppTrigger() instead.
    const branch = branchFilter && branchFilter !== 'all' ? branchFilter : effectiveBranchId;
    const templateData: any = {
      name: formData.name,
      type: formData.type,
      subject: formData.type === 'email' ? formData.subject : null,
      content: formData.content,
      is_active: formData.is_active,
      variables: AVAILABLE_VARIABLES.filter((v) => formData.content.includes(v)),
      header_type: formData.header_type,
      header_media_url: formData.header_media_url || null,
      attachment_source: formData.attachment_source,
      attachment_filename_template: formData.attachment_filename_template || null,
    };

    if (selectedTemplate) {
      updateMutation.mutate({ id: selectedTemplate.id, ...templateData });
    } else {
      if (!branch) {
        toast.error('Please select a branch before creating a template');
        return;
      }
      templateData.branch_id = branch;
      createMutation.mutate(templateData);
    }
  };

  const insertVariable = (variable: string) => {
    setFormData((prev) => ({
      ...prev,
      content: prev.content + variable,
    }));
  };

  const getTypeIcon = (type: string) => {
    const t = TEMPLATE_TYPES.find((tt) => tt.value === type);
    return t?.icon || MessageSquare;
  };

  const openMetaDialog = (template: Template) => {
    // Meta requires lowercase with underscores only (hyphens not permitted)
    const slugName = template.name.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
    // Auto-convert {{named}} placeholders → {{1}}, {{2}}, ... for Meta.
    let i = 0;
    const map: Record<string, number> = {};
    const numbered = template.content.replace(/\{\{([^}]+)\}\}/g, (_m, v) => {
      const key = v.trim();
      if (!map[key]) map[key] = ++i;
      return `{{${map[key]}}}`;
    });
    setMetaTarget(template);
    setMetaForm({
      name: template.meta_template_name || slugName,
      category: 'UTILITY',
      language: 'en',
      body_text: numbered,
    });
    setMetaError(null);
    setShowMetaDialog(true);
  };

  const handleSubmitToMeta = async () => {
    if (!metaTarget) return;
    if (!metaForm.name || !metaForm.body_text) {
      toast.error('Please fill in all required fields');
      return;
    }

    const branch = branchFilter && branchFilter !== 'all' ? branchFilter : null;
    if (!branch) {
      toast.error('Please select a specific branch before submitting to Meta');
      return;
    }

    setIsSubmittingMeta(true);
    setMetaError(null);
    try {
      // Pre-submit local duplicate check (cheap, prevents avoidable Meta rejection).
      const { data: existing } = await supabase
        .from('whatsapp_templates')
        .select('id, name, language, category, status')
        .eq('name', metaForm.name)
        .eq('language', metaForm.language)
        .maybeSingle();
      if (existing) {
        if (existing.category && existing.category !== metaForm.category) {
          throw new Error(
            `Template "${metaForm.name}" (${metaForm.language}) already exists in Meta with category ${existing.category}. ` +
            `Meta does not allow changing the category. Pick a new template name.`
          );
        }
        throw new Error(
          `Template "${metaForm.name}" (${metaForm.language}) already exists in your Meta catalog. ` +
          `Pick a new template name or sync from Meta to refresh status.`
        );
      }

      // Look up real meta_template_id (the view doesn't expose it; query the canonical table).
      let metaId: string | null = null;
      if (metaTarget.meta_template_name) {
        const { data: row } = await supabase
          .from('whatsapp_templates')
          .select('meta_template_id')
          .eq('name', metaTarget.meta_template_name)
          .eq('language', metaForm.language)
          .maybeSingle();
        metaId = (row as any)?.meta_template_id ?? null;
      }
      const isEdit = !!metaId;
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: isEdit
          ? {
              action: 'edit',
              branch_id: branch,
              template_data: {
                meta_template_id: metaId,
                category: metaForm.category,
                body_text: metaForm.body_text,
                local_template_id: metaTarget.id,
              },
            }
          : {
              action: 'create',
              branch_id: branch,
              template_data: {
                name: metaForm.name,
                category: metaForm.category,
                language: metaForm.language,
                body_text: metaForm.body_text,
                local_template_id: metaTarget.id,
                header_type: metaTarget.header_type && metaTarget.header_type !== 'none' ? metaTarget.header_type : undefined,
                header_sample_url: metaTarget.attachment_source === 'static' ? metaTarget.header_media_url : undefined,
              },
            },
      });

      // supabase-js wraps non-2xx responses; try to extract real body.
      if (error) {
        let parsed: any = null;
        try {
          const ctx: any = (error as any).context;
          if (ctx?.body && typeof ctx.body.text === 'function') {
            const txt = await ctx.body.text();
            parsed = txt ? JSON.parse(txt) : null;
          } else if (typeof ctx?.text === 'function') {
            parsed = JSON.parse(await ctx.text());
          }
        } catch (_) { /* ignore parse failure */ }
        const msg = parsed?.error || (error as any).message || 'Failed to submit template to Meta';
        if (parsed?.meta_error) setMetaError({ message: msg, ...parsed.meta_error });
        throw new Error(msg);
      }

      // Backend now returns 200 with success:false for Meta business rejections.
      if (data?.success === false || data?.error) {
        const me = data.meta_error || {};
        setMetaError({
          message: data.error || 'Meta rejected this template',
          user_title: me.user_title,
          user_msg: me.user_msg,
          code: me.code,
          subcode: me.subcode,
          fbtrace_id: me.fbtrace_id,
        });
        throw new Error(data.error || 'Meta rejected this template');
      }

      toast.success(`Template submitted to Meta — status: ${data.status || 'PENDING'}`);
      queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
      setShowMetaDialog(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit template to Meta');
    } finally {
      setIsSubmittingMeta(false);
    }
  };

  // Status counts (across all channels — relevant only for whatsapp but shown unified)
  const statusCounts = templates.reduce((acc: Record<string, number>, t: any) => {
    const s = (t.approval_status as string) || (t.type === 'whatsapp' ? 'draft' : 'not_applicable');
    acc[s] = (acc[s] || 0) + 1;
    acc.all = (acc.all || 0) + 1;
    return acc;
  }, {});

  // Apply status filter (only restricts WhatsApp templates; SMS/Email always pass)
  const filteredTemplates = templates.filter((t: any) => {
    if (filterType && t.type !== filterType) return false;
    if (statusFilter === 'all') return true;
    if (t.type !== 'whatsapp') return false; // status sub-tabs are WhatsApp-specific
    return (t.approval_status || 'draft') === statusFilter;
  });

  const groupedTemplates = filteredTemplates.reduce((acc: Record<string, Template[]>, t: any) => {
    if (!acc[t.type]) acc[t.type] = [];
    acc[t.type].push(t);
    return acc;
  }, {} as Record<string, Template[]>);

  const visibleTypes = filterType ? TEMPLATE_TYPES.filter((t) => t.value === filterType) : TEMPLATE_TYPES;

  return (
    <div className="space-y-6">
      {!hideHeader && (
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Communication Templates</h3>
          <p className="text-sm text-muted-foreground">
            Manage SMS, Email, and WhatsApp message templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SubmitPendingDocsButton templates={templates} branchId={effectiveBranchId} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Sparkles className="mr-2 h-4 w-4" />
                Quick Presets
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Dynamic PDF Presets</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DYNAMIC_PDF_PRESETS.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => applyPreset(p)} className="flex items-start gap-2 py-2">
                  <FileText className="h-4 w-4 mt-0.5 text-violet-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {p.attachment_filename_template}
                    </p>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => openEditor()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Template
          </Button>
        </div>
      </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
        <Tabs defaultValue={visibleTypes[0]?.value || 'whatsapp'} className="w-full">
          {visibleTypes.length > 1 && (
          <TabsList className="w-full grid grid-cols-3">
            {visibleTypes.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {label}
                {groupedTemplates[value]?.length ? (
                  <Badge variant="secondary" className="ml-1 text-xs h-5 px-1.5">
                    {groupedTemplates[value].length}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          )}
          {visibleTypes.map(({ value, label }) => (
            <TabsContent key={value} value={value}>
              {/* WhatsApp-only approval status filter chips */}
              {value === 'whatsapp' && (
                <div className="flex flex-wrap items-center gap-2 mt-4 mb-3 px-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mr-1">Status:</span>
                  {([
                    { v: 'all',      label: 'All',       cls: 'bg-muted text-foreground' },
                    { v: 'approved', label: '✅ Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    { v: 'pending',  label: '⏳ Pending',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                    { v: 'rejected', label: '❌ Rejected', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
                    { v: 'draft',    label: '⚪ Draft',    cls: 'bg-slate-50 text-slate-700 border-slate-200' },
                  ] as const).map((s) => (
                    <button
                      key={s.v}
                      type="button"
                      onClick={() => setStatusFilter(s.v as any)}
                      className={`text-xs px-3 py-1 rounded-full border transition ${statusFilter === s.v ? 'ring-2 ring-primary/40 ' : ''}${s.cls}`}
                      title={s.v === 'draft' ? 'Local-only template — not sent to Meta yet. WhatsApp send will be blocked.' : ''}
                    >
                      {s.label}
                      <span className="ml-1.5 opacity-70">{statusCounts[s.v] ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
              <Card>
                <CardContent className="pt-4">
                  {!groupedTemplates[value]?.length ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No {label} templates yet. Click "Add Template" to create one.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {groupedTemplates[value].map((template) => (
                        <div
                          key={template.id}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium truncate">{template.name}</p>
                              {!template.is_active && (
                                <Badge variant="secondary" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                              {value === 'whatsapp' && metaStatusBadge(template.meta_template_status)}
                              {mediaBadge(template)}
                              {deliveryModeBadge(template)}
                            </div>
                            {value === 'whatsapp' && template.meta_template_name && (
                              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                                Meta: {template.meta_template_name}
                              </p>
                            )}
                            {value === 'whatsapp' && template.meta_template_status === 'REJECTED' && template.meta_rejection_reason && (
                              <p className="text-xs text-destructive mt-0.5">
                                Reason: {template.meta_rejection_reason}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground truncate mt-1">
                              {template.content.slice(0, 80)}...
                            </p>
                            {(() => {
                              const ds = deliveryStats[template.id];
                              if (!ds || (ds.sent + ds.failed + ds.queued) === 0) return null;
                              return (
                                <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                                  <span className="text-muted-foreground uppercase tracking-wider font-semibold">7d:</span>
                                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">{ds.sent} sent</span>
                                  {ds.delivered > 0 && <span className="px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 font-medium">{ds.delivered} delivered</span>}
                                  {ds.read > 0 && <span className="px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium">{ds.read} read</span>}
                                  {ds.failed > 0 && <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">{ds.failed} failed</span>}
                                  {ds.queued > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">{ds.queued} queued</span>}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                            {value === 'whatsapp' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs gap-1.5"
                                onClick={() => openMetaDialog(template)}
                                title={
                                  template.meta_template_status === 'REJECTED'
                                    ? 'Edit & resubmit this template to Meta'
                                    : template.meta_template_name
                                      ? 'Already submitted — opens edit form'
                                      : 'Submit to Meta for approval'
                                }
                              >
                                <Send className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">
                                  {template.meta_template_status === 'REJECTED'
                                    ? 'Submit for Edit'
                                    : template.meta_template_name
                                      ? 'Edit & Resubmit'
                                      : 'Submit to Meta'}
                                </span>
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPreviewTemplate(template)}
                              aria-label="Preview template"
                              title="Preview"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditor(template)}
                              aria-label="Edit template"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate(template.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
        </>
      )}

      {/* Template Editor Drawer */}
      <Sheet open={showEditor} onOpenChange={setShowEditor}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {selectedTemplate ? 'Edit Template' : 'Create Template'}
            </SheetTitle>
            <SheetDescription>
              Create reusable message templates with variable placeholders
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Welcome Message"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData({ ...formData, type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select
                  value={formData.trigger}
                  onValueChange={(v) => setFormData({ ...formData, trigger: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_TRIGGERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.type === 'email' && (
              <div className="space-y-2">
                <Label>Subject Line</Label>
                <Input
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Email subject"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Message Content *</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Type your message here..."
                rows={6}
                required
              />
              {formData.type === 'whatsapp' && formData.content && (
                <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Meta-formatted preview (positional placeholders)
                  </p>
                  <p className="text-xs font-mono whitespace-pre-wrap text-foreground/90">
                    {(() => {
                      let i = 0;
                      const map: Record<string, number> = {};
                      return formData.content.replace(/\{\{([^}]+)\}\}/g, (_m, v) => {
                        const key = v.trim();
                        if (!map[key]) map[key] = ++i;
                        return `{{${map[key]}}}`;
                      });
                    })()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Meta requires numbered placeholders. We auto-convert when you "Submit to Meta".
                  </p>
                </div>
              )}
              {/* Live preview & validation */}
              {(() => {
                const validation = validateTemplate(formData.content || '', formData.trigger);
                const preview = renderPreview(formData.content || '', formData.trigger);
                const evt = getEvent(formData.trigger);
                return (
                  <div className="rounded-lg border bg-card p-3 space-y-3 mt-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
                        <Eye className="h-3 w-3" /> Live Preview
                      </p>
                      {validation.ok ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                          <CheckCircle className="h-3 w-3 mr-1" /> Valid
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">
                          <AlertCircle className="h-3 w-3 mr-1" /> {validation.unknown.length} unknown var{validation.unknown.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-foreground/90 bg-muted/40 rounded-md p-2 min-h-[40px]">
                      {preview || <span className="text-muted-foreground italic">Type a message to see preview…</span>}
                    </p>
                    {validation.unknown.length > 0 && (
                      <p className="text-[11px] text-rose-600">
                        Unknown variable{validation.unknown.length > 1 ? 's' : ''}: {validation.unknown.map((v) => `{{${v}}}`).join(', ')}
                      </p>
                    )}
                    {evt && validation.unused.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
                        <span className="text-[10px] text-muted-foreground self-center mr-1">Available for "{evt.label}":</span>
                        {evt.variables.map((v) => (
                          <Button
                            key={v.key}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-[10px] h-6 px-1.5"
                            onClick={() => insertVariable(`{{${v.key}}}`)}
                          >
                            {`{{${v.key}}}`}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Available Variables</Label>
              <div className="flex flex-wrap gap-1">
                {AVAILABLE_VARIABLES.map((v) => (
                  <Button
                    key={v}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => insertVariable(v)}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {v}
                  </Button>
                ))}
              </div>
            </div>


            {/* Attachment / Header media — applies to WhatsApp and Email */}
            {(formData.type === 'whatsapp' || formData.type === 'email') && (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div>
                  <Label className="font-medium">Attachment / Header Media</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Attach a PDF, image, or video. Use <span className="font-mono">Dynamic</span> for invoice/report PDFs that change per send.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Header Type</Label>
                    <Select
                      value={formData.header_type}
                      onValueChange={(v) => setFormData({ ...formData, header_type: v as any })}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None (text only)</SelectItem>
                        <SelectItem value="image">Image</SelectItem>
                        <SelectItem value="document">Document (PDF)</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Source</Label>
                    <Select
                      value={formData.attachment_source}
                      onValueChange={(v) => setFormData({ ...formData, attachment_source: v as any })}
                      disabled={formData.header_type === 'none'}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Pick —</SelectItem>
                        <SelectItem value="static">Static (same file every time)</SelectItem>
                        <SelectItem value="dynamic">Dynamic (resolved at send time)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {formData.header_type !== 'none' && formData.attachment_source === 'static' && (
                  <div className="space-y-2">
                    <Label className="text-xs">Upload File</Label>
                    <Input
                      type="file"
                      accept={
                        formData.header_type === 'image' ? 'image/*'
                        : formData.header_type === 'video' ? 'video/*'
                        : 'application/pdf'
                      }
                      disabled={uploadingMedia}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingMedia(true);
                        try {
                          const ext = file.name.split('.').pop() || 'bin';
                          const path = `${effectiveBranchId || 'global'}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                          const { error: upErr } = await supabase.storage.from('template-media').upload(path, file, { upsert: false, contentType: file.type });
                          if (upErr) throw upErr;
                          const { data: pub } = supabase.storage.from('template-media').getPublicUrl(path);
                          setFormData({ ...formData, header_media_url: pub.publicUrl });
                          toast.success('File uploaded');
                        } catch (err: any) {
                          toast.error(err.message || 'Upload failed');
                        } finally {
                          setUploadingMedia(false);
                        }
                      }}
                    />
                    {formData.header_media_url && (
                      <div className="flex items-center justify-between gap-2 text-xs bg-background border rounded-md px-2 py-1.5">
                        <span className="truncate font-mono text-muted-foreground">{formData.header_media_url.split('/').pop()}</span>
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs"
                          onClick={() => setFormData({ ...formData, header_media_url: '' })}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {formData.header_type === 'document' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Filename Template</Label>
                    <Input
                      placeholder="e.g. Invoice_{{invoice_number}}.pdf"
                      value={formData.attachment_filename_template}
                      onChange={(e) => setFormData({ ...formData, attachment_filename_template: e.target.value })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Used as the filename shown to recipients. Variables get replaced at send time.
                    </p>
                  </div>
                )}

                {formData.attachment_source === 'dynamic' && formData.header_type !== 'none' && (
                  <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 p-2 text-[11px] text-violet-800 dark:text-violet-200 space-y-1">
                    <p><strong>Dynamic mode — no upload required.</strong> The system generates and signs the file at send time and attaches it automatically. Supported sources:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      <li><strong>Invoice PDF</strong> — Invoice Share / Send Receipt drawer</li>
                      <li><strong>Payment Receipt PDF</strong> — POS checkout</li>
                      <li><strong>Body / Posture Scan Report</strong> — HOWBODY scan delivery</li>
                      <li><strong>Diet / Workout Plan PDF</strong> — Trainer plan share</li>
                    </ul>
                    <p>Filename will render from the template above (e.g. <span className="font-mono">Invoice-INV-INC-26-0008.pdf</span>).</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <Label className="font-medium">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Only active templates appear in broadcast
                </p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
              />
            </div>

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={closeEditor}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {selectedTemplate ? 'Save Changes' : 'Create Template'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Submit to Meta Drawer */}
      <Sheet open={showMetaDialog} onOpenChange={setShowMetaDialog}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-success" />
              Submit to Meta
            </SheetTitle>
            <SheetDescription>
              Submit this template to WhatsApp for approval. Once approved, it can be sent to users who have not opted in.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 mt-6">
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
              <p className="text-xs text-warning-foreground">
                <strong>Note:</strong> Template names must be lowercase with underscores only (e.g., <span className="font-mono">welcome_message</span>).
              </p>
            </div>

            {metaError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {metaError.user_title && (
                      <p className="text-sm font-semibold text-destructive">{metaError.user_title}</p>
                    )}
                    <p className="text-xs text-destructive/90 break-words">
                      {metaError.user_msg || metaError.message}
                    </p>
                    {(metaError.code || metaError.subcode || metaError.fbtrace_id) && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-1">
                        {metaError.code != null && <>code: {metaError.code} </>}
                        {metaError.subcode != null && <>· subcode: {metaError.subcode} </>}
                        {metaError.fbtrace_id && <>· trace: {metaError.fbtrace_id}</>}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(metaError, null, 2));
                      toast.success('Error copied');
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-muted/50 border space-y-1">
              <p className="text-xs font-semibold flex items-center gap-1"><Info className="h-3 w-3" /> India Pricing per Conversation</p>
              <p className="text-xs text-muted-foreground">• <strong>Utility</strong> (confirmations, updates): ~₹0.15</p>
              <p className="text-xs text-muted-foreground">• <strong>Marketing</strong> (promos, re-engagement): ~₹0.77</p>
              <p className="text-xs text-muted-foreground">• <strong>Authentication</strong> (OTP, verification): ~₹0.13</p>
              <p className="text-xs text-muted-foreground">• <strong>Service</strong> (user-initiated, 24h window): Free</p>
            </div>

            <div className="space-y-2">
              <Label>Template Name <span className="text-xs text-muted-foreground">(lowercase, underscores only)</span></Label>
              <Input
                value={metaForm.name}
                onChange={(e) => setMetaForm({ ...metaForm, name: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })}
                placeholder="e.g., welcome_message"
                data-testid="input-meta-template-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={metaForm.category}
                  onValueChange={(v) => setMetaForm({ ...metaForm, category: v })}
                >
                  <SelectTrigger data-testid="select-meta-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {META_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Language</Label>
                <Select
                  value={metaForm.language}
                  onValueChange={(v) => setMetaForm({ ...metaForm, language: v })}
                >
                  <SelectTrigger data-testid="select-meta-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {META_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Body Text</Label>
              <Textarea
                value={metaForm.body_text}
                onChange={(e) => setMetaForm({ ...metaForm, body_text: e.target.value })}
                rows={5}
                placeholder="Template body text..."
                data-testid="textarea-meta-body"
              />
              <p className="text-xs text-muted-foreground">
                Replace <span className="font-mono">{"{{variable}}"}</span> with Meta positional parameters like <span className="font-mono">{"{{1}}"}</span>, <span className="font-mono">{"{{2}}"}</span>, etc. before submitting.
              </p>
            </div>
          </div>

          <SheetFooter className="pt-4">
            <Button variant="outline" onClick={() => setShowMetaDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitToMeta}
              disabled={isSubmittingMeta || !metaForm.name || !metaForm.body_text}
              className="bg-success hover:bg-success/90 text-success-foreground"
              data-testid="btn-confirm-submit-meta"
            >
              {isSubmittingMeta ? (
                <><span className="animate-spin mr-2">⟳</span> Submitting...</>
              ) : (
                <><Send className="h-4 w-4 mr-2" /> Submit for Approval</>
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Template Preview Drawer */}
      <Sheet open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Template Preview
            </SheetTitle>
            <SheetDescription>
              Rendered with sample data for the "{previewTemplate?.trigger || 'custom'}" event.
            </SheetDescription>
          </SheetHeader>
          {previewTemplate && (() => {
            const tpl = previewTemplate;
            const rendered = renderPreview(tpl.content || '', tpl.trigger);
            const subject = renderPreview(tpl.subject || '', tpl.trigger);
            const evt = getEvent(tpl.trigger);
            const isEmail = tpl.type === 'email';
            const isWa = tpl.type === 'whatsapp';
            const dyn = tpl.attachment_source === 'dynamic';
            return (
              <div className="space-y-4 mt-4">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="capitalize">{tpl.type}</Badge>
                  {evt && <Badge variant="secondary">{evt.label}</Badge>}
                  {tpl.attachment_source && tpl.attachment_source !== 'none' && (
                    <Badge className="bg-indigo-100 text-indigo-700">
                      <FileText className="h-3 w-3 mr-1" />
                      {tpl.attachment_source === 'dynamic' ? 'Dynamic PDF' : 'Static media'}
                    </Badge>
                  )}
                </div>

                {isEmail && (
                  <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 border-b text-xs">
                      <div><span className="text-slate-500">From: </span>Incline Fitness &lt;noreply@inclinefitness.in&gt;</div>
                      <div><span className="text-slate-500">Subject: </span><span className="font-medium">{subject || '(no subject)'}</span></div>
                    </div>
                    <div className="p-4 text-sm whitespace-pre-wrap text-slate-800" dangerouslySetInnerHTML={{ __html: rendered.replace(/\n/g, '<br/>') }} />
                  </div>
                )}

                {isWa && (
                  <div className="rounded-2xl bg-[#e7f3df] p-3 max-w-sm ml-auto shadow">
                    {dyn && (
                      <div className="rounded-lg bg-white/80 border border-slate-200 p-2 mb-2 flex items-center gap-2 text-xs">
                        <FileText className="h-4 w-4 text-rose-600" />
                        <div className="flex-1 min-w-0 truncate">
                          <div className="font-medium text-slate-800 truncate">
                            {(tpl.attachment_filename_template || 'document.pdf').replace(/\{\{[^}]+\}\}/g, 'sample')}
                          </div>
                          <div className="text-[10px] text-slate-500">PDF · attached at send time</div>
                        </div>
                      </div>
                    )}
                    {tpl.header_media_url && tpl.header_type === 'image' && (
                      <img src={tpl.header_media_url} alt="" className="rounded-lg mb-2 max-h-40 object-cover w-full" />
                    )}
                    <p className="text-sm text-slate-900 whitespace-pre-wrap">{rendered}</p>
                  </div>
                )}

                {tpl.type === 'sms' && (
                  <div className="rounded-2xl bg-slate-100 p-3 max-w-xs">
                    <p className="text-sm text-slate-900 whitespace-pre-wrap">{rendered}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{rendered.length} chars</p>
                  </div>
                )}

                {evt && (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Sample variables</p>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {evt.variables.map((v) => (
                        <div key={v.key} className="flex justify-between gap-2">
                          <span className="font-mono text-muted-foreground truncate">{`{{${v.key}}}`}</span>
                          <span className="text-foreground truncate">{v.sample}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <SheetFooter className="pt-4">
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Toolbar button: submits all WhatsApp document templates whose
 * meta_template_status is draft|pending to Meta in a single click.
 * Only shows when at least one such template exists.
 */
function SubmitPendingDocsButton({ templates, branchId }: { templates: any[]; branchId?: string | null }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const pending = (templates || []).filter(
    (t) =>
      t.type === 'whatsapp' &&
      t.is_active &&
      (t.header_type === 'document' || t.header_type === 'image' || t.header_type === 'video') &&
      ['draft', 'pending'].includes(String(t.approval_status || '').toLowerCase()),
  );
  if (pending.length === 0) return null;

  const submitAll = async () => {
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const t of pending) {
      try {
        const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
          body: {
            action: 'create',
            branch_id: t.branch_id ?? branchId ?? null,
            template_data: {
              name: t.meta_template_name || t.name,
              category: 'UTILITY',
              language: 'en',
              body_text: t.content,
              local_template_id: t.id,
              header_type: t.header_type,
              header_sample_url: t.header_media_url || undefined,
            },
          },
        });
        if (error || data?.success === false || data?.error) fail++;
        else ok++;
      } catch {
        fail++;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
    if (ok && !fail) toast.success(`Submitted ${ok} document template${ok > 1 ? 's' : ''} to Meta`);
    else if (ok && fail) toast.warning(`Submitted ${ok}, failed ${fail}. Open a template to see the Meta error.`);
    else toast.error('All submissions failed. Open a template to see the Meta error.');
  };

  return (
    <Button variant="outline" onClick={submitAll} disabled={busy} className="gap-2">
      <Send className="h-4 w-4" />
      {busy ? 'Submitting…' : `Submit ${pending.length} Pending Doc${pending.length > 1 ? 's' : ''}`}
    </Button>
  );
}
