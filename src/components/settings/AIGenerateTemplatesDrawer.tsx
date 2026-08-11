import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, Send, CheckCircle2, AlertCircle, MessageSquare, Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { getEventsForChannel, type EventChannel } from '@/lib/templates/systemEvents';
import DOMPurify from 'isomorphic-dompurify';

type Channel = EventChannel;

const CANDIDATE_BY_CHANNEL: Record<Channel, { event: string; label: string; hint?: string }[]> = {
  whatsapp: getEventsForChannel('whatsapp').map((e) => ({ event: e.event, label: e.label, hint: e.description })),
  sms: getEventsForChannel('sms').map((e) => ({ event: e.event, label: e.label, hint: e.description })),
  email: getEventsForChannel('email').map((e) => ({ event: e.event, label: e.label, hint: e.description })),
};

interface Proposal {
  event: string;
  name: string;
  category: string;
  language?: string;
  body_text: string;
  body_html?: string;
  subject?: string;
  preheader?: string;
  variables: string[];
  header_type?: 'none' | 'image' | 'document' | 'video';
  header_sample_url?: string;
  rationale?: string;
  dlt_category?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel?: Channel;
  /** Pre-select these events when the drawer opens (e.g. from a Coverage row). */
  prefilledEvents?: string[];
}

const CHANNEL_META: Record<Channel, { label: string; icon: any; color: string }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageSquare, color: 'text-success' },
  sms: { label: 'SMS', icon: Phone, color: 'text-info' },
  email: { label: 'Email', icon: Mail, color: 'text-warning' },
};

export function AIGenerateTemplatesDrawer({ open, onOpenChange, channel: channelProp, prefilledEvents }: Props) {
  const qc = useQueryClient();
  const { selectedBranch } = useBranchContext();
  const [channel, setChannel] = useState<Channel>(channelProp || 'whatsapp');
  useEffect(() => { if (channelProp) setChannel(channelProp); }, [channelProp]);

  const candidates = CANDIDATE_BY_CHANNEL[channel];
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);
  /** Per-proposal failure/warning text, keyed by proposal name. */
  const [issues, setIssues] = useState<Record<string, { level: 'error' | 'warning'; message: string }>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);


  const { data: existing = [] } = useQuery({
    queryKey: ['ai-templates-existing', selectedBranch, channel],
    queryFn: async () => {
      const q = supabase.from('templates').select('name, content, trigger_event').eq('type', channel);
      const { data } = selectedBranch && selectedBranch !== 'all' ? await q.eq('branch_id', selectedBranch) : await q;
      return (data || []).map((t: any) => ({
        name: t.name,
        body: t.content || '',
        trigger_event: t.trigger_event as string | null,
      }));
    },
    enabled: open,
  });

  // Events from the canonical catalog that don't yet have a template.
  const missingEvents = useMemo(() => {
    const have = new Set(existing.map((t) => t.trigger_event).filter(Boolean) as string[]);
    return candidates.filter((e) => !have.has(e.event)).map((e) => e.event);
  }, [existing, candidates]);

  // Default selection = all missing events. Re-applies when channel/branch/open changes
  // OR when the missing list updates (so the count is never stuck at 0).
  useEffect(() => {
    if (!open) return;
    if (prefilledEvents && prefilledEvents.length > 0) {
      setPicked(new Set(prefilledEvents));
    } else {
      setPicked(new Set(missingEvents));
    }
    setStep('pick');
    setProposals([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, open, prefilledEvents?.join('|'), missingEvents.join('|')]);


  const branchId = selectedBranch && selectedBranch !== 'all' ? selectedBranch : null;
  const Meta = CHANNEL_META[channel];

  const generate = async () => {
    if (!branchId) { toast.error('Select a specific branch first'); return; }
    if (picked.size === 0) { toast.error('Pick at least one event'); return; }
    setGenerating(true);
    try {
      const events = candidates.filter((e) => picked.has(e.event));
      const { data, error } = await supabase.functions.invoke('ai-generate-whatsapp-templates', {
        body: { branch_id: branchId, channel, events, existing },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const list: Proposal[] = data?.templates || [];
      if (list.length === 0) throw new Error('AI returned no proposals');
      setProposals(list);
      setStep('review');
      toast.success(`Generated ${list.length} ${Meta.label} proposals`);
    } catch (e: any) {
      const msg = e?.context?.error || e?.message || 'Generation failed';
      toast.error(String(msg));
    } finally {
      setGenerating(false);
    }
  };

  const updateProposal = (i: number, patch: Partial<Proposal>) => {
    setProposals((arr) => arr.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const submitOne = async (p: Proposal): Promise<'ok' | 'draft' | 'error'> => {
    if (!branchId) return 'error';
    let outcome: 'ok' | 'draft' | 'error' = 'ok';
    setSubmitting(p.name);
    setIssues((m) => { const { [p.name]: _drop, ...rest } = m; return rest; });

    try {
      const insertRow: any = {
        branch_id: branchId,
        type: channel,
        name: p.name,
        trigger_event: p.event,
        content: channel === 'email' ? (p.body_html || p.body_text) : p.body_text,
        variables: p.variables,
        is_active: true,
      };
      if (channel === 'email') insertRow.subject = p.subject || null;
      if (channel === 'whatsapp') {
        insertRow.header_type = p.header_type && p.header_type !== 'none' ? p.header_type : null;
        insertRow.header_media_url = p.header_sample_url || null;
      }
      const { data: localRow, error: localErr } = await supabase
        .from('templates')
        .insert(insertRow)
        .select('id')
        .single();
      if (localErr) throw localErr;

      // For WhatsApp, also submit to Meta
      if (channel === 'whatsapp') {
        const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
          body: {
            action: 'create',
            branch_id: branchId,
            template_data: {
              name: p.name,
              category: p.category,
              language: p.language || 'en',
              body_text: p.body_text,
              local_template_id: localRow!.id,
              variables: p.variables,
              header_type: p.header_type && p.header_type !== 'none' ? p.header_type : undefined,
              header_sample_url: p.header_sample_url,
            },
          },
        });
        if (error) throw error;
        if (data?.success === false) {
          const msg = data.meta_error?.user_msg || data.error || 'Meta rejected';
          if (data.saved_as_draft) {
            outcome = 'draft';
            setIssues((m) => ({ ...m, [p.name]: { level: 'warning', message: `Saved as draft — ${msg}` } }));
            toast.warning(`"${p.name}" saved as DRAFT — ${msg}. Edit it under WhatsApp → CRM Templates and resubmit.`, { duration: 8000 });
          } else {
            throw new Error(msg);
          }
        } else {
          toast.success(`Submitted "${p.name}" — Meta status: ${data.status}`);
        }
      } else {
        toast.success(`Saved "${p.name}"`);
      }

      // Auto-create automation mapping so the event actually fires once approved.
      if (channel === 'whatsapp' && p.event && p.event !== 'custom') {
        const { error: trigErr } = await supabase
          .from('whatsapp_triggers')
          .upsert(
            {
              branch_id: branchId,
              event_name: p.event,
              template_id: localRow!.id,
              delay_minutes: 0,
              is_active: true,
            },
            { onConflict: 'branch_id,event_name' },
          );
        if (trigErr) console.warn('whatsapp_triggers upsert failed', trigErr);
        qc.invalidateQueries({ queryKey: ['whatsapp-triggers'] });
      }

      qc.invalidateQueries({ queryKey: ['communication-templates'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-templates-health'] });
      qc.invalidateQueries({ queryKey: ['template-coverage'] });
      setProposals((arr) => arr.filter((x) => x.name !== p.name));
    } catch (e: any) {
      outcome = 'error';
      const message = e?.message || 'Save failed';
      setIssues((m) => ({ ...m, [p.name]: { level: 'error', message } }));
      toast.error(`${p.name}: ${message}`);
    } finally {
      setSubmitting(null);
    }
    return outcome;
  };

  const submitAll = async () => {
    const queue = proposals.slice();
    let ok = 0, drafted = 0, failed = 0;
    setBulk({ done: 0, total: queue.length });
    for (const [i, p] of queue.entries()) {
      const res = await submitOne(p);
      if (res === 'ok') ok += 1;
      else if (res === 'draft') drafted += 1;
      else failed += 1;
      setBulk({ done: i + 1, total: queue.length });
    }
    setBulk(null);
    const parts = [`${ok} saved`];
    if (drafted) parts.push(`${drafted} draft`);
    if (failed) parts.push(`${failed} failed`);
    if (failed) toast.error(parts.join(' · ') + ' — see the highlighted cards below');
    else toast.success(parts.join(' · '));
  };


  const Icon = Meta.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Template Generator
          </SheetTitle>
          <SheetDescription>
            {step === 'pick'
              ? 'Pick a channel and the events you want polished, brand-safe templates for. The AI avoids duplicating existing ones.'
              : `Review and edit each ${Meta.label} proposal, then save individually or in bulk.`}
          </SheetDescription>
        </SheetHeader>

        {step === 'pick' && (
          <div className="py-4 space-y-4">
            {!channelProp && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Channel</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(['whatsapp', 'sms', 'email'] as Channel[]).map((c) => {
                    const M = CHANNEL_META[c];
                    const I = M.icon;
                    const active = channel === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setChannel(c)}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${active ? 'border-primary bg-primary/5 text-primary font-semibold' : 'border-border hover:bg-muted/40'}`}
                      >
                        <I className={`h-4 w-4 ${active ? '' : M.color}`} /> {M.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{missingEvents.length}</span> missing
                · <span className="font-semibold text-foreground">{picked.size}</span> selected
                · {candidates.length} total · <span className="text-warning">max 60 per run</span>
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPicked(new Set(missingEvents))}
                  disabled={missingEvents.length === 0}
                >
                  Select all missing
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {candidates.map((e) => {
                const have = existing.some((t) => t.trigger_event === e.event);
                return (
                  <label
                    key={e.event}
                    className={`flex items-start gap-2 p-3 rounded-lg border hover:bg-muted/40 cursor-pointer ${have ? 'opacity-60' : ''}`}
                  >
                    <Checkbox
                      checked={picked.has(e.event)}
                      onCheckedChange={(v) => {
                        const next = new Set(picked);
                        if (v) next.add(e.event); else next.delete(e.event);
                        setPicked(next);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{e.label}</p>
                        {have && <Badge variant="outline" className="text-[10px]">exists</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{e.event}</p>
                      {e.hint && <p className="text-xs text-muted-foreground mt-0.5">{e.hint}</p>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="py-4 space-y-4">
            {proposals.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                All proposals saved.
              </div>
            )}
            {proposals.map((p, i) => {
              const evIsMarketing = /(offer|promo|promotion|event|birthday|referral|win[_-]?back|re[_-]?engagement|wait[_-]?is[_-]?over|launch|announcement|newsletter|gift|festive|sale|deal)/i.test(p.event || p.name);
              const categoryMismatch = evIsMarketing && p.category !== 'MARKETING';
              const issue = issues[p.name];
              return (
              <div
                key={`${p.event}-${i}`}
                className={`rounded-xl border p-3 space-y-2 bg-card ${
                  issue?.level === 'error' ? 'border-destructive' : issue ? 'border-warning' : ''
                }`}
              >
                {issue && (
                  <div
                    className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${
                      issue.level === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
                    }`}
                  >
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{issue.message}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon className={`h-4 w-4 ${Meta.color}`} />
                    <Input
                      value={p.name}
                      onChange={(e) => updateProposal(i, { name: e.target.value })}
                      className="h-8 w-56 font-mono text-xs"
                    />
                    {p.dlt_category && <Badge variant="outline" className="text-[10px]">{p.dlt_category}</Badge>}
                  </div>
                  <Button size="sm" onClick={() => submitOne(p)} disabled={submitting === p.name}>
                    {submitting === p.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Event: {p.event}</p>

                {channel === 'whatsapp' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</Label>
                      <select
                        value={p.category}
                        onChange={(e) => updateProposal(i, { category: e.target.value })}
                        className={`mt-1 w-full h-9 rounded-md border bg-background px-2 text-xs ${categoryMismatch ? 'border-warning' : ''}`}
                      >
                        <option value="MARKETING">MARKETING</option>
                        <option value="UTILITY">UTILITY</option>
                        <option value="AUTHENTICATION">AUTHENTICATION</option>
                      </select>
                      {categoryMismatch && (
                        <p className="text-[10px] text-warning mt-1">Event looks promotional — Meta usually requires MARKETING.</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Header type</Label>
                      <select
                        value={p.header_type || 'none'}
                        onChange={(e) => updateProposal(i, { header_type: e.target.value as any })}
                        className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="none">None (text only)</option>
                        <option value="image">Image (JPG/PNG)</option>
                        <option value="video">Video (MP4)</option>
                        <option value="document">Document (PDF)</option>
                      </select>
                    </div>
                  </div>
                )}

                {channel === 'whatsapp' && p.header_type && p.header_type !== 'none' && (
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Sample {p.header_type} URL (used by Meta to approve the template)
                    </Label>
                    <Input
                      value={p.header_sample_url || ''}
                      onChange={(e) => updateProposal(i, { header_sample_url: e.target.value })}
                      placeholder={
                        p.header_type === 'video' ? 'https://example.com/sample.mp4' :
                        p.header_type === 'image' ? 'https://example.com/sample.jpg' :
                        'https://example.com/sample.pdf'
                      }
                      className="h-8 text-xs font-mono mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Must be a publicly reachable URL. The platform uploads it once to Meta and stores the returned media handle.
                    </p>
                  </div>
                )}

                {channel === 'email' && (
                  <Input
                    value={p.subject || ''}
                    onChange={(e) => updateProposal(i, { subject: e.target.value })}
                    placeholder="Subject"
                    className="h-9 text-sm"
                  />
                )}
                <Textarea
                  value={p.body_text}
                  onChange={(e) => updateProposal(i, { body_text: e.target.value })}
                  rows={channel === 'sms' ? 2 : 4}
                  className="text-sm"
                />
                {channel === 'sms' && (
                  <p className="text-[10px] text-muted-foreground">{p.body_text.length} chars · {Math.ceil(p.body_text.length / 160)} segment(s)</p>
                )}
                {channel === 'email' && p.body_html && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">HTML preview</summary>
                    <div className="mt-2 rounded border bg-card p-2 max-h-60 overflow-auto" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.body_html) }} />
                  </details>
                )}
                {p.rationale && <p className="text-xs text-muted-foreground italic">{p.rationale}</p>}
                <div className="flex flex-wrap gap-1">
                  {p.variables.map((v) => (
                    <Badge key={v} variant="secondary" className="text-[10px] font-mono">{`{{${v}}}`}</Badge>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        )}

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {step === 'pick' ? (
            <Button onClick={generate} disabled={generating || picked.size === 0}>
              {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate {picked.size}</>}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('pick')}>
                <AlertCircle className="h-4 w-4 mr-1" /> Re-pick
              </Button>
              <Button onClick={submitAll} disabled={proposals.length === 0 || !!submitting}>
                <Send className="h-4 w-4 mr-2" /> {channel === 'whatsapp' ? 'Submit All to Meta' : 'Save All'}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
