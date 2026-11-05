import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Bell, MessageSquare, Phone, Mail, Users, Check, ChevronLeft, ChevronRight, Send, Clock,
  Loader2, Paperclip, X, AlertTriangle, CheckCircle2, FileText, Smartphone, Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { uploadAttachment } from '@/utils/uploadAttachment';
import { dispatchCommunication } from '@/lib/comms/dispatch';
import { createCampaign, sendCampaignNow, resolveCampaignAudience, getAudienceBreakdown } from '@/services/campaignService';
import {
  AUDIENCE_PRESETS, channelReadiness, externalChannels, inAppAudienceKey, presetToFilter, validateDraft,
  type AudiencePreset, type ComposerChannel,
} from '@/lib/campaigns/composer';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string | null;
  initialType?: 'sms' | 'email' | 'whatsapp' | 'inapp';
  initialMessage?: string;
}

const CHANNELS: { id: ComposerChannel; label: string; hint: string; icon: typeof Bell }[] = [
  { id: 'inapp', label: 'In-App', hint: 'Bell + browser pop-up + phone app + announcement board', icon: Bell },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Needs a Meta-approved template', icon: MessageSquare },
  { id: 'sms', label: 'SMS', hint: 'DLT-registered templates only', icon: Phone },
  { id: 'email', label: 'Email', hint: 'Subject required; images get a download button', icon: Mail },
];
const STEPS = ['Audience', 'Channels', 'Message', 'Review'] as const;

interface WaTemplate { id: string | null; name: string; status: string; body: string }

export function MessageComposerSheet({ open, onOpenChange, branchId, initialType = 'inapp', initialMessage = '' }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<AudiencePreset>('active');
  const [channels, setChannels] = useState<ComposerChannel[]>([initialType]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [subject, setSubject] = useState('');
  const [waTemplateName, setWaTemplateName] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; filename: string; kind: 'image' | 'document' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0); setChannels([initialType]); setMessage(initialMessage);
  }, [open, initialType, initialMessage]);

  const ext = externalChannels(channels);
  const wantsInApp = channels.includes('inapp');

  const inAppCount = useQuery({
    queryKey: ['composer-inapp-count', branchId, preset],
    enabled: open && !!branchId && !!inAppAudienceKey(preset),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('inapp_audience_user_ids', { p_branch_id: branchId!, p_audience: inAppAudienceKey(preset)! });
      if (error) throw error;
      return (data || []).map((r: { user_id: string }) => r.user_id);
    },
  });
  const extCount = useQuery({
    queryKey: ['composer-ext-count', branchId, preset],
    enabled: open && !!branchId && ext.length > 0,
    queryFn: () => getAudienceBreakdown(branchId!, presetToFilter(preset)),
  });

  const waTemplates = useQuery({
    queryKey: ['composer-wa-templates', branchId],
    enabled: open && channels.includes('whatsapp'),
    queryFn: async (): Promise<WaTemplate[]> => {
      let q = supabase.from('whatsapp_templates').select('name, status, components, branch_id').in('status', ['APPROVED', 'PENDING']);
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
      const { data: meta, error } = await q.order('name');
      if (error) throw error;
      const names = (meta || []).map((m) => m.name);
      const { data: locals } = names.length
        ? await supabase.from('templates').select('id, meta_template_name').in('meta_template_name', names)
        : { data: [] as { id: string; meta_template_name: string | null }[] };
      const byName = new Map((locals || []).map((l) => [l.meta_template_name, l.id]));
      return (meta || []).map((m) => {
        const comps = (m.components as Array<{ type?: string; text?: string }> | null) || [];
        return { id: byName.get(m.name) ?? null, name: m.name, status: m.status, body: comps.find((c) => c?.type === 'BODY')?.text || '' };
      });
    },
  });

  // Live template status: a Meta approval unlocks Send without reopening the drawer.
  useEffect(() => {
    if (!open || !channels.includes('whatsapp')) return;
    const ch = supabase.channel(`composer-wa-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_templates' }, () => qc.invalidateQueries({ queryKey: ['composer-wa-templates'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, channels, qc]);

  const pickedTpl = (waTemplates.data || []).find((t) => t.name === waTemplateName);
  const readiness = useMemo(() => Object.fromEntries(CHANNELS.map((c) => [c.id, channelReadiness({
    channel: c.id, preset, sendNow,
    hasApprovedWaTemplate: pickedTpl?.status === 'APPROVED' && !!pickedTpl.id,
    waTemplatePending: pickedTpl?.status === 'PENDING' && !!pickedTpl.id,
  })])), [preset, sendNow, pickedTpl]);

  const scheduledIso = !sendNow && scheduledLocal ? new Date(scheduledLocal).toISOString() : null;
  const errors = validateDraft({ channels, title, message, subject, sendNow, scheduledAt: scheduledIso });
  const blocked = channels.filter((c) => !readiness[c].ok);

  const toggle = (c: ComposerChannel) => setChannels((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error('Max 16MB'); return; }
    setUploading(true);
    try {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
      const { url } = await uploadAttachment(file, { folder: 'broadcasts', filename: file.name, contentType: file.type });
      setAttachment({ url, filename: file.name, kind });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(false); }
  };

  const reset = () => { setStep(0); setTitle(''); setMessage(''); setSubject(''); setWaTemplateName(''); setAttachment(null); setSendNow(true); setScheduledLocal(''); };

  const send = async () => {
    if (!branchId) { toast.error('Select a branch first'); return; }
    if (errors.length) { toast.error(errors[0]); return; }
    if (blocked.length) { toast.error(`${blocked[0]}: ${(readiness[blocked[0]] as { reason: string }).reason}`); return; }
    setSending(true);
    const summary: string[] = [];
    try {
      if (wantsInApp) {
        const { data: ann, error } = await supabase.from('announcements').insert({
          title: title.trim(), content: message.trim(), branch_id: branchId,
          target_audience: preset === 'staff' ? 'staff' : preset === 'members_and_staff' ? 'members_and_staff' : 'members',
          is_active: true, publish_at: scheduledIso ?? new Date().toISOString(),
          attachment_url: attachment?.url ?? null, attachment_kind: attachment?.kind ?? null, attachment_filename: attachment?.filename ?? null,
        }).select('id').single();
        if (error) throw error;
        if (sendNow) {
          // One bell row per person; the device queue mirrors it to browser + phone app.
          const users = inAppCount.data ?? [];
          let ok = 0;
          for (let i = 0; i < users.length; i += 10) {
            const res = await Promise.allSettled(users.slice(i, i + 10).map((uid) => dispatchCommunication({
              branch_id: branchId, channel: 'in_app', category: 'announcement', recipient: uid, user_id: uid,
              payload: { subject: title.trim(), body: message.trim().slice(0, 500) },
              dedupe_key: `announcement:${ann.id}:${uid}:in_app`,
            })));
            ok += res.filter((r) => r.status === 'fulfilled').length;
          }
          summary.push(`In-App: ${ok} people`);
        } else summary.push('In-App: scheduled on the board');
      }
      for (const ch of ext) {
        const tplId = ch === 'whatsapp' ? pickedTpl?.id ?? null : null;
        const campaign = await createCampaign({
          branch_id: branchId, name: `${(title.trim() || message.trim().slice(0, 40))} · ${ch.toUpperCase()}`,
          channel: ch, audience_filter: presetToFilter(preset), message: message.trim(),
          subject: ch === 'email' ? subject.trim() : null,
          trigger_type: sendNow ? 'send_now' : 'scheduled', scheduled_at: scheduledIso,
          status: sendNow ? 'sending' : (ch === 'whatsapp' && pickedTpl?.status === 'PENDING' ? 'pending_template_approval' : 'scheduled'),
          attachment_url: ch !== 'sms' ? attachment?.url ?? null : null,
          attachment_kind: ch !== 'sms' ? attachment?.kind ?? null : null,
          attachment_filename: ch !== 'sms' ? attachment?.filename ?? null : null,
          campaign_type: 'announcement', template_id: tplId,
        });
        if (sendNow) {
          const recipients = await resolveCampaignAudience(branchId, presetToFilter(preset));
          const r = await sendCampaignNow(campaign, { recipients });
          summary.push(r.awaitingApproval ? `${ch}: waiting for owner approval` : `${ch}: ${r.total} queued`);
        } else summary.push(`${ch}: scheduled`);
      }
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['announcements'] });
      toast.success(summary.join(' · '));
      reset(); onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally { setSending(false); }
  };

  const canNext = step === 0 ? true : step === 1 ? channels.length > 0 : step === 2 ? errors.filter((e) => !e.includes('send time')).length === 0 : true;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]">
        <SheetHeader className="sticky top-0 z-10 bg-card border-b border-border px-6 pt-6 pb-4 space-y-3">
          <div>
            <SheetTitle>New message</SheetTitle>
            <SheetDescription>Write once, deliver to the app, WhatsApp, SMS and email.</SheetDescription>
          </div>
          <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}
                  aria-current={i === step ? 'step' : undefined}
                  className={cn('w-full text-left rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-secondary text-foreground hover:bg-secondary/80 cursor-pointer' : 'bg-muted text-muted-foreground')}>
                  <span className="flex items-center gap-1">{i < step ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>} {s}</span>
                </button>
              </li>
            ))}
          </ol>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!branchId && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600">Pick a branch in the top bar first.</div>
          )}

          {step === 0 && (
            <section className="space-y-3" aria-labelledby="aud-h">
              <h3 id="aud-h" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Who should receive it?</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AUDIENCE_PRESETS.map((a) => (
                  <button key={a.id} type="button" onClick={() => setPreset(a.id)} aria-pressed={preset === a.id}
                    className={cn('min-h-[64px] rounded-xl border p-3 text-left transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      preset === a.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{a.label}</span>
                      {preset === a.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-4 flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div className="text-sm">
                  {inAppAudienceKey(preset) ? (
                    inAppCount.isLoading ? <Skeleton className="h-4 w-40" /> : inAppCount.isError ? <span className="text-destructive">Couldn't count the audience</span>
                      : <span><span className="font-bold tabular-nums text-foreground">{inAppCount.data?.length ?? 0}</span> people with an app account</span>
                  ) : <span className="text-muted-foreground">Leads can be reached on WhatsApp, SMS or email only.</span>}
                </div>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="space-y-3" aria-labelledby="ch-h">
              <h3 id="ch-h" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How should it reach them?</h3>
              {CHANNELS.map((c) => {
                const on = channels.includes(c.id); const r = readiness[c.id];
                const disabled = c.id === 'inapp' && preset === 'leads';
                return (
                  <button key={c.id} type="button" disabled={disabled} onClick={() => toggle(c.id)} aria-pressed={on}
                    className={cn('w-full min-h-[64px] rounded-xl border p-3 flex items-start gap-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      on ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary', disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}>
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0"><c.icon className="h-4 w-4 text-foreground" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{c.label}</span>
                        {on && !r.ok && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20"><AlertTriangle className="h-3 w-3" />Action needed</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.hint}</p>
                      {c.id === 'inapp' && (
                        <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-3"><span className="inline-flex items-center gap-1"><Bell className="h-3 w-3" />Bell</span><span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" />Browser</span><span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" />Phone app</span></p>
                      )}
                    </div>
                    <div className={cn('h-5 w-5 rounded-md border flex items-center justify-center shrink-0', on ? 'bg-primary border-primary text-primary-foreground' : 'border-border')}>{on && <Check className="h-3.5 w-3.5" />}</div>
                  </button>
                );
              })}
              {ext.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {extCount.isLoading ? 'Counting contacts…' : extCount.data ? <>Reachable by phone/email: <span className="font-semibold tabular-nums text-foreground">{extCount.data.total}</span></> : null}
                </p>
              )}
            </section>
          )}

          {step === 2 && (
            <section className="space-y-4">
              {wantsInApp && (
                <div className="space-y-1.5">
                  <Label htmlFor="mc-title">Title (shown in the app)</Label>
                  <Input id="mc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali schedule" />
                </div>
              )}
              {channels.includes('whatsapp') && (
                <div className="space-y-1.5">
                  <Label>WhatsApp template</Label>
                  {waTemplates.isLoading ? <Skeleton className="h-10 w-full" /> : (
                    <Select value={waTemplateName} onValueChange={(v) => { setWaTemplateName(v); const t = waTemplates.data?.find((x) => x.name === v); if (t && !message.trim()) setMessage(t.body); }}>
                      <SelectTrigger><SelectValue placeholder="Pick an approved template" /></SelectTrigger>
                      <SelectContent>
                        {(waTemplates.data || []).map((t) => (
                          <SelectItem key={t.name} value={t.name} disabled={!t.id}>
                            <span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" />{t.name}
                              <span className={cn('rounded-full px-1.5 text-[10px] border', t.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 border-amber-500/20')}>{t.status === 'APPROVED' ? 'Approved' : 'Waiting for Meta'}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!readiness.whatsapp.ok && <p className="text-xs text-amber-600">{(readiness.whatsapp as { reason: string }).reason}</p>}
                </div>
              )}
              {channels.includes('email') && (
                <div className="space-y-1.5">
                  <Label htmlFor="mc-subj">Email subject</Label>
                  <Input id="mc-subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="mc-msg">Message</Label>
                <Textarea id="mc-msg" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write your message…" />
                <p className="text-xs text-muted-foreground">{message.length} characters · {'{{member_name}}'} works on WhatsApp, SMS and email.</p>
              </div>
              {(wantsInApp || channels.includes('whatsapp') || channels.includes('email')) && (
                <div className="space-y-1.5">
                  <Label htmlFor="mc-file">Attachment (optional)</Label>
                  {attachment ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm flex-1 truncate">{attachment.filename}</span>
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X className="h-4 w-4" /></Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input id="mc-file" type="file" accept="image/*,application/pdf,video/mp4" disabled={uploading} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                      {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="space-y-4">
              <div className="rounded-xl border border-border p-4 space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Summary</h3>
                <p className="text-sm text-foreground"><span className="font-semibold">{AUDIENCE_PRESETS.find((a) => a.id === preset)?.label}</span></p>
                <ul className="space-y-2">
                  {channels.map((c) => {
                    const meta = CHANNELS.find((x) => x.id === c)!; const r = readiness[c];
                    const count = c === 'inapp' ? inAppCount.data?.length : extCount.data?.total;
                    return (
                      <li key={c} className="flex items-center gap-2 text-sm">
                        <meta.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">{meta.label}</span>
                        {r.ok ? <span className="tabular-nums text-muted-foreground">{count ?? '—'} people</span>
                          : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-destructive/10 text-destructive border border-destructive/20"><AlertTriangle className="h-3 w-3" />{(r as { reason: string }).reason}</span>}
                      </li>
                    );
                  })}
                </ul>
                <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap text-foreground max-h-40 overflow-y-auto">{title && <strong className="block mb-1">{title}</strong>}{message}</div>
              </div>
              <div className="rounded-xl border border-border p-4 space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">When</h3>
                <div className="grid grid-cols-2 gap-2" role="radiogroup">
                  {[{ v: true, l: 'Send now', i: Send }, { v: false, l: 'Schedule', i: Clock }].map((o) => (
                    <button key={o.l} type="button" role="radio" aria-checked={sendNow === o.v} onClick={() => setSendNow(o.v)}
                      className={cn('min-h-[44px] rounded-xl border px-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring', sendNow === o.v ? 'border-primary bg-primary/5 text-foreground' : 'border-border hover:bg-secondary text-muted-foreground')}>
                      <o.i className="h-4 w-4" />{o.l}
                    </button>
                  ))}
                </div>
                {!sendNow && (
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-when">Send at (India time)</Label>
                    <Input id="mc-when" type="datetime-local" value={scheduledLocal} min={new Date(Date.now() + 60000).toISOString().slice(0, 16)} onChange={(e) => setScheduledLocal(e.target.value)} />
                    {wantsInApp && <p className="text-xs text-muted-foreground">Scheduled app messages appear on the announcement board at that time; bell and phone pop-ups go out with "Send now".</p>}
                  </div>
                )}
              </div>
              {errors.length > 0 && <ul className="text-sm text-destructive list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
            </section>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex items-center justify-between gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))} disabled={sending} className="min-h-[44px]">
            {step === 0 ? 'Cancel' : <><ChevronLeft className="h-4 w-4 mr-1" />Back</>}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext || !branchId} className="min-h-[44px]">Continue<ChevronRight className="h-4 w-4 ml-1" /></Button>
          ) : (
            <Button onClick={send} disabled={sending || errors.length > 0 || blocked.length > 0 || !branchId} className="min-h-[44px]">
              {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</> : sendNow ? <><Send className="h-4 w-4 mr-2" />Send now</> : <><Clock className="h-4 w-4 mr-2" />Schedule</>}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
