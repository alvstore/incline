import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MessageSquare, Phone, Mail, Bell, Send, FileText, Loader2, Paperclip, X, Image as ImageIcon, Clock, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { createCampaign, type CampaignChannel } from '@/services/campaignService';

interface BroadcastDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string;
  initialType?: 'sms' | 'email' | 'whatsapp' | 'inapp';
  initialMessage?: string;
}

type Channel = 'inapp' | 'whatsapp' | 'sms' | 'email';

const CHANNELS: { value: Channel; label: string; icon: any; color: string }[] = [
  { value: 'inapp',    label: 'In-App',   icon: Bell,          color: 'text-primary' },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'text-success' },
  { value: 'sms',      label: 'SMS',      icon: Phone,         color: 'text-info' },
  { value: 'email',    label: 'Email',    icon: Mail,          color: 'text-warning' },
];

export function BroadcastDrawer({ open, onOpenChange, branchId, initialType = 'inapp', initialMessage = '' }: BroadcastDrawerProps) {
  const qc = useQueryClient();
  const [selectedChannels, setSelectedChannels] = useState<Set<Channel>>(new Set([initialType]));
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [audience, setAudience] = useState('all');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; filename: string; kind: 'image' | 'document' | 'video' } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  const handleAttachmentPick = async (file: File | null) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error('Max 16MB for attachments'); return; }
    setIsUploading(true);
    try {
      const kind: 'image' | 'document' | 'video' = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
        ? 'video'
        : 'document';
      const { url } = await uploadAttachment(file, { folder: 'broadcasts', filename: file.name, contentType: file.type });
      setAttachment({ url, filename: file.name, kind });
      toast.success('Attachment uploaded');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Templates only relevant for a single external channel
  const externalSingle = (() => {
    const ext = Array.from(selectedChannels).filter(c => c !== 'inapp');
    return ext.length === 1 ? ext[0] : '';
  })();

  const { data: savedTemplates = [] } = useQuery({
    queryKey: ['broadcast-templates', externalSingle],
    queryFn: async () => {
      if (!externalSingle) return [];
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, content, subject')
        .eq('type', externalSingle)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!externalSingle,
  });

  const toggleChannel = (channel: Channel) => {
    const next = new Set(selectedChannels);
    if (next.has(channel)) {
      if (next.size > 1) next.delete(channel);
    } else {
      next.add(channel);
    }
    setSelectedChannels(next);
    setTemplateId('');
  };

  const toggleAll = () => {
    if (selectedChannels.size === 4) {
      setSelectedChannels(new Set(['inapp']));
    } else {
      setSelectedChannels(new Set(['inapp', 'whatsapp', 'sms', 'email']));
    }
    setTemplateId('');
  };

  const handleTemplateSelect = (tid: string) => {
    const template: any = savedTemplates.find((t: any) => t.id === tid);
    if (template) {
      setTemplateId(tid);
      setMessage(template.content);
      setSubject(template.subject || '');
    }
  };

  const audienceToCampaignFilter = (a: string) => {
    if (a === 'active') return { status: 'active' as const };
    if (a === 'expired') return { status: 'expired' as const };
    return { status: 'all' as const };
  };

  const reset = () => {
    setTitle(''); setMessage(''); setSubject(''); setTemplateId(''); setAudience('all');
    setAttachment(null); setSelectedChannels(new Set(['inapp']));
    setScheduleMode('now'); setScheduledAt('');
  };

  const handleSend = async () => {
    if (selectedChannels.size === 0) { toast.error('Select at least one channel'); return; }
    if (!message.trim()) { toast.error('Please enter a message'); return; }
    if (selectedChannels.has('inapp') && !title.trim()) { toast.error('Title is required for In-App announcements'); return; }
    if (!branchId) { toast.error('No branch selected'); return; }

    let scheduledIso: string | null = null;
    if (scheduleMode === 'later') {
      if (!scheduledAt) { toast.error('Pick a date and time'); return; }
      const ts = new Date(scheduledAt).getTime();
      if (isNaN(ts) || ts <= Date.now()) { toast.error('Scheduled time must be in the future'); return; }
      scheduledIso = new Date(scheduledAt).toISOString();
    }

    setIsSending(true);
    const summary: string[] = [];

    try {
      // 1. In-App → write to announcements (publish_at controls visibility)
      if (selectedChannels.has('inapp')) {
        const { error } = await supabase.from('announcements').insert({
          title: title.trim(),
          content: message.trim(),
          branch_id: branchId,
          target_audience: audience === 'all' ? 'all' : 'members',
          is_active: true,
          publish_at: scheduledIso ?? new Date().toISOString(),
          attachment_url: attachment?.url ?? null,
          attachment_kind: attachment?.kind ?? null,
          attachment_filename: attachment?.filename ?? null,
        } as any);
        if (error) throw error;
        summary.push(scheduledIso ? 'in-app: scheduled' : 'in-app: posted');
      }

      // 2. External channels
      const externalChannels = Array.from(selectedChannels).filter(c => c !== 'inapp') as CampaignChannel[];

      for (const channel of externalChannels) {
        const supportsAttachment = channel === 'whatsapp' || channel === 'email';

        if (scheduledIso) {
          // Scheduled → persist as a campaign; cron picks it up
          await createCampaign({
            branch_id: branchId,
            name: (title.trim() || message.trim().slice(0, 40)) + ` · ${channel}`,
            channel,
            audience_filter: audienceToCampaignFilter(audience),
            message: message.trim(),
            subject: channel === 'email' ? (subject || null) : null,
            trigger_type: 'scheduled',
            scheduled_at: scheduledIso,
            status: 'scheduled',
          });
          summary.push(`${channel}: scheduled`);
        } else {
          // Send now
          const { data, error } = await supabase.functions.invoke('send-broadcast', {
            body: {
              channel,
              message,
              audience,
              branch_id: branchId,
              subject: channel === 'email' ? subject || undefined : undefined,
              template_id: channel === 'whatsapp' && templateId ? templateId : undefined,
              attachment_url: supportsAttachment && attachment ? attachment.url : undefined,
              attachment_kind: supportsAttachment && attachment ? attachment.kind : undefined,
              attachment_filename: supportsAttachment && attachment ? attachment.filename : undefined,
            },
          });
          if (error) summary.push(`${channel}: error`);
          else summary.push(`${channel}: ${data?.sent ?? 0} sent`);
        }
      }

      qc.invalidateQueries({ queryKey: ['announcements'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`Done — ${summary.join(', ')}`);
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e.message || 'Failed to send');
    } finally {
      setIsSending(false);
    }
  };

  const showSubject = selectedChannels.has('email');
  const showAttachment = selectedChannels.has('inapp') || selectedChannels.has('whatsapp') || selectedChannels.has('email');
  const showTitle = selectedChannels.has('inapp');
  const minScheduled = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Announcement</SheetTitle>
          <SheetDescription>Compose once · deliver to In-App, WhatsApp, SMS or Email · send now or schedule</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Channels */}
          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={selectedChannels.size === 4} onCheckedChange={toggleAll} />
                <span className="text-sm font-medium">All</span>
              </label>
              <div className="w-px h-5 bg-border" />
              {CHANNELS.map(ch => {
                const Icon = ch.icon;
                return (
                  <label key={ch.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedChannels.has(ch.value)}
                      onCheckedChange={() => toggleChannel(ch.value)}
                    />
                    <Icon className={`h-4 w-4 ${ch.color}`} />
                    <span className="text-sm">{ch.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Title (in-app) */}
          {showTitle && (
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gym closure on 5th May" />
              <p className="text-xs text-muted-foreground">Shown as the headline in the member app feed.</p>
            </div>
          )}

          {/* Template (single external channel) */}
          {externalSingle && (
            <div className="space-y-2">
              <Label>Use Template (Optional)</Label>
              <Select value={templateId} onValueChange={handleTemplateSelect}>
                <SelectTrigger><SelectValue placeholder="Select a saved template..." /></SelectTrigger>
                <SelectContent>
                  {savedTemplates.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No templates found for {externalSingle}
                    </div>
                  ) : (
                    savedTemplates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2"><FileText className="h-4 w-4" />{t.name}</div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Audience</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Members</SelectItem>
                <SelectItem value="active">Active Members Only</SelectItem>
                <SelectItem value="expiring">Expiring Soon (7 days)</SelectItem>
                <SelectItem value="expired">Expired Members</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">For richer targeting (leads, contacts, segments) use Marketing & Campaigns.</p>
          </div>

          {showSubject && (
            <div className="space-y-2">
              <Label>Email Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line..." />
            </div>
          )}

          <div className="space-y-2">
            <Label>Message *</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Enter your message..." rows={6} />
            <p className="text-xs text-muted-foreground">Variables like {'{{member_name}}'} work on WhatsApp/SMS/Email.</p>
          </div>

          {showAttachment && (
            <div className="space-y-2">
              <Label>Attachment (Optional)</Label>
              {attachment ? (
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
                  {attachment.kind === 'image' ? <ImageIcon className="h-4 w-4 text-success" /> : <FileText className="h-4 w-4 text-warning" />}
                  <span className="text-sm flex-1 truncate">{attachment.filename}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment(null)} aria-label="Remove attachment">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*,application/pdf,video/mp4"
                    disabled={isUploading}
                    onChange={(e) => handleAttachmentPick(e.target.files?.[0] ?? null)}
                  />
                  {isUploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                <Paperclip className="h-3 w-3 inline mr-1" />
                Image, PDF or short MP4 — max 16MB. Used on In-App, WhatsApp and Email.
              </p>
            </div>
          )}

          {/* Schedule */}
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <Label className="flex items-center gap-2"><Clock className="h-4 w-4" />When to send</Label>
            <RadioGroup value={scheduleMode} onValueChange={(v) => setScheduleMode(v as 'now' | 'later')} className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="now" id="snd-now" />
                <span className="text-sm">Send now</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="later" id="snd-later" />
                <span className="text-sm">Schedule for later</span>
              </label>
            </RadioGroup>
            {scheduleMode === 'later' && (
              <div className="pt-2 space-y-1">
                <Label className="text-xs flex items-center gap-1.5"><CalendarIcon className="h-3 w-3" />Send at (Asia/Kolkata)</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  min={minScheduled}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="rounded-xl bg-background"
                />
                <p className="text-[11px] text-muted-foreground">A background worker dispatches at the chosen time.</p>
              </div>
            )}
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
          <Button onClick={handleSend} disabled={!message.trim() || isSending}>
            {isSending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</>
            ) : scheduleMode === 'later' ? (
              <><Clock className="mr-2 h-4 w-4" /> Schedule</>
            ) : (
              <><Send className="mr-2 h-4 w-4" /> Send to {selectedChannels.size} Channel{selectedChannels.size > 1 ? 's' : ''}</>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
