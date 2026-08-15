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
      
      // Safety check: ensure we're using event details from the catalog
      const payloadEvents = events.map(e => ({
        event: e.event,
        label: e.label,
        description: e.hint
      }));

      const { data, error } = await supabase.functions.invoke('ai-generate-whatsapp-templates', {
        body: { 
          branch_id: branchId, 
          channel, 
          events: payloadEvents, 
          existing 
        },
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
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0 border-0 bg-slate-50/50 backdrop-blur-3xl">
        <SheetHeader className="p-8 bg-white border-b border-slate-100 shadow-sm">
          <SheetTitle className="flex items-center gap-3 text-2xl font-black tracking-tight text-slate-900">
            <div className="h-10 w-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            AI Template Studio
          </SheetTitle>
          <SheetDescription className="text-slate-500 font-medium text-sm leading-relaxed max-w-md">
            {step === 'pick'
              ? 'Select system events to generate polished, brand-aligned communication templates. Our AI ensures DLT and Meta compliance.'
              : `Review your generated ${Meta.label} templates. You can refine the content or header settings before batch-submitting to Meta.`}
          </SheetDescription>
        </SheetHeader>

        <div className="px-8 pb-32">

        {step === 'pick' && (
          <div className="py-6 space-y-6">
            {!channelProp && (
              <div className="space-y-3">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Target Channel</Label>
                <div className="grid grid-cols-3 gap-3">
                  {(['whatsapp', 'sms', 'email'] as Channel[]).map((c) => {
                    const M = CHANNEL_META[c];
                    const I = M.icon;
                    const active = channel === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setChannel(c)}
                        className={`flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm transition-all duration-300 ${
                          active 
                            ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-bold shadow-lg shadow-indigo-100 scale-[1.02]' 
                            : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <I className={`h-4.5 w-4.5 ${active ? 'text-indigo-600' : M.color}`} /> {M.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900">Coverage Gaps identified</p>
                  <p className="text-xs text-slate-500 font-medium">
                    <span className="text-indigo-600 font-bold">{missingEvents.length}</span> unmapped events · 
                    <span className="text-indigo-600 font-bold ml-1">{picked.size}</span> to generate
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPicked(new Set(missingEvents))}
                    disabled={missingEvents.length === 0}
                    className="h-9 rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold px-4"
                  >
                    Select Missing
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} className="h-9 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900">
                    Clear
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                {candidates.map((e) => {
                  const have = existing.some((t) => t.trigger_event === e.event);
                  const isSelected = picked.has(e.event);
                  return (
                    <label
                      key={e.event}
                      className={`group flex items-start gap-3 p-4 rounded-2xl border-2 transition-all duration-300 cursor-pointer ${
                        isSelected 
                          ? 'border-indigo-500 bg-indigo-50/30 shadow-md shadow-indigo-50' 
                          : 'border-slate-100 bg-white hover:border-slate-200'
                      } ${have ? 'opacity-70 bg-slate-50/50' : ''}`}
                    >
                      <div className="pt-0.5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(v) => {
                            const next = new Set(picked);
                            if (v) next.add(e.event); else next.delete(e.event);
                            setPicked(next);
                          }}
                          className={`rounded-md border-2 transition-colors ${isSelected ? 'border-indigo-600 bg-indigo-600' : 'border-slate-200'}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className={`text-sm font-bold tracking-tight transition-colors ${isSelected ? 'text-indigo-900' : 'text-slate-900'}`}>
                            {e.label}
                          </p>
                          {have && (
                            <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-slate-100 border-0 text-slate-500 h-4">
                              Exists
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono mb-1">{e.event}</p>
                        {e.hint && <p className="text-[11px] text-slate-500 leading-tight line-clamp-2">{e.hint}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="py-6 space-y-4 mb-20">
            {proposals.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in duration-500">
                <div className="h-20 w-20 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">All Templates Synchronized</h3>
                <p className="text-slate-500 mt-2 max-w-xs mx-auto">Your system coverage is now complete. Meta will review your WhatsApp templates within 24 hours.</p>
              </div>
            )}
            {proposals.map((p, i) => {
              const evIsMarketing = /(offer|promo|promotion|event|birthday|referral|win[_-]?back|re[_-]?engagement|wait[_-]?is[_-]?over|launch|announcement|newsletter|gift|festive|sale|deal)/i.test(p.event || p.name);
              const categoryMismatch = evIsMarketing && p.category !== 'MARKETING';
              const issue = issues[p.name];
              return (
              <div
                key={`${p.event}-${i}`}
                className={`rounded-2xl border-2 p-5 space-y-4 bg-white transition-all duration-300 shadow-sm hover:shadow-md ${
                  issue?.level === 'error' ? 'border-rose-200 bg-rose-50/20' : issue ? 'border-amber-200 bg-amber-50/20' : 'border-slate-100 hover:border-indigo-100'
                }`}
              >
                {issue && (
                  <div
                    className={`flex items-start gap-3 rounded-xl px-4 py-3 text-xs font-medium ${
                      issue.level === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{issue.message}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                      <Icon className={`h-5 w-5 ${Meta.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Input
                        value={p.name}
                        onChange={(e) => updateProposal(i, { name: e.target.value })}
                        className="h-9 font-bold text-sm bg-transparent border-slate-200 focus:bg-white rounded-lg transition-all"
                      />
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1 ml-1">Event: {p.event}</p>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => submitOne(p)} 
                    disabled={submitting === p.name}
                    className="h-10 w-10 p-0 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all border-0 shadow-none"
                  >
                    {submitting === p.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>

                {channel === 'whatsapp' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Meta Category</Label>
                      <select
                        value={p.category}
                        onChange={(e) => updateProposal(i, { category: e.target.value })}
                        className={`w-full h-10 rounded-xl border bg-slate-50 px-3 text-xs font-semibold transition-all focus:bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none ${categoryMismatch ? 'border-amber-300 text-amber-700' : 'border-slate-200 text-slate-700'}`}
                      >
                        <option value="MARKETING">MARKETING</option>
                        <option value="UTILITY">UTILITY</option>
                        <option value="AUTHENTICATION">AUTHENTICATION</option>
                      </select>
                      {categoryMismatch && (
                        <p className="text-[10px] font-medium text-amber-600 ml-1">Promotional event — Meta requires MARKETING.</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Header Component</Label>
                      <select
                        value={p.header_type || 'none'}
                        onChange={(e) => updateProposal(i, { header_type: e.target.value as any })}
                        className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition-all focus:bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none"
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
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">
                      Header Media Sample (Required for Meta Approval)
                    </Label>
                    <Input
                      value={p.header_sample_url || ''}
                      onChange={(e) => updateProposal(i, { header_sample_url: e.target.value })}
                      placeholder={
                        p.header_type === 'video' ? 'https://example.com/sample.mp4' :
                        p.header_type === 'image' ? 'https://example.com/sample.jpg' :
                        'https://example.com/sample.pdf'
                      }
                      className="h-9 rounded-xl border-slate-200 bg-slate-50 font-mono text-xs transition-all focus:bg-white"
                    />
                    <p className="text-[9px] font-medium text-slate-400 ml-1">
                      Provide a public URL. Meta uploads this once to generate a permanent media handle.
                    </p>
                  </div>
                )}

                {channel === 'email' && (
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Email Subject</Label>
                    <Input
                      value={p.subject || ''}
                      onChange={(e) => updateProposal(i, { subject: e.target.value })}
                      placeholder="Subject"
                      className="h-10 rounded-xl border-slate-200 bg-slate-50 font-semibold text-sm transition-all focus:bg-white"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Message Content</Label>
                  <Textarea
                    value={p.body_text}
                    onChange={(e) => updateProposal(i, { body_text: e.target.value })}
                    rows={channel === 'sms' ? 3 : 5}
                    className="rounded-xl border-slate-200 bg-slate-50 text-sm leading-relaxed transition-all focus:bg-white focus:ring-2 focus:ring-indigo-500/10"
                  />
                  {channel === 'sms' && (
                    <p className="text-[10px] font-bold text-slate-400 ml-1">{p.body_text.length} chars · {Math.ceil(p.body_text.length / 160)} segment(s)</p>
                  )}
                </div>

                {channel === 'email' && p.body_html && (
                  <details className="group">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-indigo-500 hover:text-indigo-600 transition-colors ml-1">
                      View HTML Preview
                    </summary>
                    <div className="mt-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 max-h-60 overflow-auto shadow-inner" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.body_html) }} />
                  </details>
                )}

                {p.rationale && (
                  <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100/50">
                    <p className="text-[11px] text-indigo-700 leading-tight italic font-medium">
                      <Sparkles className="h-3 w-3 inline-block mr-1 opacity-70" /> {p.rationale}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {p.variables.map((v) => (
                    <Badge key={v} variant="secondary" className="bg-white text-indigo-600 border border-indigo-100 text-[10px] font-bold tracking-tight rounded-lg px-2 py-0.5 shadow-sm">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

        <SheetFooter className="absolute bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-slate-100 p-6 z-50">
          <div className="flex w-full items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl text-slate-500 font-semibold px-6">
              Cancel
            </Button>
            <div className="flex flex-col gap-2 flex-1">
              <Button
                onClick={generate}
                disabled={generating || picked.size === 0}
                className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 text-white font-bold h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {generating ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Thinking...</>
                ) : (
                  <><Sparkles className="mr-2 h-5 w-5" /> Generate {picked.size} Templates</>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full rounded-2xl border-slate-200 text-slate-600 font-semibold"
                onClick={() => {
                  const qc = queryClient;
                  supabase.functions.invoke('manage-whatsapp-templates', { body: { action: 'list' } })
                    .then(() => {
                      toast.success('Sync triggered in background');
                      qc.invalidateQueries({ queryKey: ['communication-templates'] });
                    });
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Sync Existing from Meta
              </Button>
            </div>
            ) : (
              proposals.length > 0 && (
                <Button
                  onClick={submitAll}
                  disabled={!!bulk}
                  className="flex-1 rounded-2xl bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 text-white font-bold h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {bulk ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting {bulk.done}/{bulk.total}...</>
                  ) : (
                    <><Send className="mr-2 h-5 w-5" /> Submit All ({proposals.length})</>
                  )}
                </Button>
              )
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
