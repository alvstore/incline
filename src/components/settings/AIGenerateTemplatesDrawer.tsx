import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Loader2,
  Sparkles,
  Send,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import { SYSTEM_EVENTS, type EventChannel } from '@/lib/templates/systemEvents';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: EventChannel;
  prefilledEvents?: string[];
}

type ProposalState = 'pending' | 'submitting' | 'done' | 'failed';

interface Proposal {
  name: string;
  category?: string;
  body_text?: string;
  body?: string;
  footer?: string;
  language?: string;
  header_type?: string;
  header_sample_url?: string;
  variables?: string[];
  event?: string;
  trigger_event?: string;
  state: ProposalState;
  error?: string;
}

export function AIGenerateTemplatesDrawer({
  open,
  onOpenChange,
  channel = 'whatsapp',
  prefilledEvents = [],
}: Props) {
  const { effectiveBranchId } = useBranchContext();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [picked, setPicked] = useState<Set<string>>(new Set(prefilledEvents));
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);

  // Reset to a clean state whenever the drawer is reopened.
  useEffect(() => {
    if (open) {
      setStep('pick');
      setProposals([]);
      setPicked(new Set(prefilledEvents));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Coverage = an APPROVED template exists for the event on this channel AND,
  // for WhatsApp, Meta still has that template (not missing / stale in the
  // catalog mirror). A template Meta has dropped is a real gap, not coverage.
  const { data: coverage, isLoading: matrixLoading } = useQuery({
    queryKey: ['template-coverage-gaps', channel, effectiveBranchId],
    queryFn: async () => {
      const covered = new Set<string>();
      const broken: { event: string; templateName: string; metaName: string }[] = [];

      const { data: templates, error: tplError } = await supabase
        .from('templates')
        .select('name, trigger_event, type, meta_template_status, is_active, meta_template_name')
        .eq('type', channel);

      if (tplError) throw tplError;

      // Live Meta catalog mirror — same source the Templates table aligns against.
      const metaByName = new Map<string, { status: string | null; is_stale: boolean | null }>();
      if (channel === 'whatsapp') {
        const { data: metaRows, error: metaErr } = await supabase
          .from('whatsapp_templates')
          .select('name, status, is_stale');
        if (metaErr) throw metaErr;
        for (const row of metaRows || []) {
          if (!metaByName.has(row.name)) {
            metaByName.set(row.name, { status: row.status, is_stale: row.is_stale });
          }
        }
      }

      const liveInMeta = (metaName: string | null) => {
        if (!metaName) return false;
        const live = metaByName.get(metaName);
        return !!live && live.is_stale !== true;
      };

      for (const t of templates || []) {
        const approved = channel === 'whatsapp'
          ? (t.meta_template_status || '').toUpperCase() === 'APPROVED' && !!t.meta_template_name
          : t.is_active !== false;

        if (!approved || !t.trigger_event) continue;

        if (channel === 'whatsapp' && !liveInMeta(t.meta_template_name)) {
          broken.push({
            event: t.trigger_event,
            templateName: t.name,
            metaName: t.meta_template_name as string,
          });
          continue;
        }
        covered.add(t.trigger_event);
      }

      // Cross-check explicit triggers, applying the same live-in-Meta rule.
      if (channel === 'whatsapp' && effectiveBranchId) {
        const { data: triggers, error: trigError } = await supabase
          .from('whatsapp_triggers')
          .select('event_name, templates(meta_template_status, meta_template_name)')
          .eq('branch_id', effectiveBranchId);

        if (trigError) throw trigError;
        for (const trig of triggers || []) {
          const tpl = (trig as any).templates;
          const status = (tpl?.meta_template_status || '').toUpperCase();
          if (status === 'APPROVED' && liveInMeta(tpl?.meta_template_name ?? null)) {
            covered.add(trig.event_name);
          }
        }
      }

      return { covered, broken: broken.filter((b) => !covered.has(b.event)) };
    },
    enabled: open,
  });

  const coveredEvents = coverage?.covered ?? new Set<string>();
  const brokenTemplates = coverage?.broken ?? [];

  const channelEvents = useMemo(
    () => SYSTEM_EVENTS.filter((e) => e.channels.includes(channel)),
    [channel]
  );

  const uncovered = useMemo(
    () => channelEvents.filter((e) => !coveredEvents.has(e.event)),
    [channelEvents, coveredEvents]
  );


  const togglePick = (event: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const pickAll = () => setPicked(new Set(uncovered.map((e) => e.event)));
  const clearAll = () => setPicked(new Set());

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-whatsapp-templates', {
        body: {
          events: Array.from(picked).map((e) => ({ event: e })),
          branch_id: effectiveBranchId,
        },
      });
      if (error) throw new Error(error.message || 'AI provider returned an error');

      const generated: Proposal[] = (data?.templates || []).map((t: any) => ({
        ...t,
        state: 'pending' as ProposalState,
      }));
      if (generated.length === 0) {
        toast.error('The AI returned no templates — try fewer events or retry.');
        return;
      }
      setProposals(generated);
      setStep('review');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate templates');
    } finally {
      setGenerating(false);
    }
  };

  const removeProposal = (index: number) =>
    setProposals((prev) => prev.filter((_, i) => i !== index));

  const submitAll = async () => {
    setSubmitting(true);
    let success = 0;
    let firstError: string | null = null;

    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      if (p.state === 'done') continue;

      setProposals((prev) => prev.map((x, idx) => (idx === i ? { ...x, state: 'submitting', error: undefined } : x)));

      try {
        // The edge function contract is `action: 'create'` + `template_data`.
        // Sending anything else returns "Unknown action" — which is exactly
        // why every submit used to fail silently.
        const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
          body: {
            action: 'upsert',
            branch_id: effectiveBranchId,
            template_data: {
              name: p.name,
              category: (p.category || 'UTILITY').toUpperCase(),
              language: p.language || 'en',
              body_text: p.body_text || p.body || '',
              footer_text: p.footer || undefined,
              header_type: p.header_type || 'none',
               header_sample_url: p.header_sample_url || undefined,
               variables: p.variables || [],
              trigger_event: p.trigger_event || p.event || 'custom',
            },
          },
        });

        const failureMessage = (error as any)?.message || (data as any)?.error;
        if (failureMessage) throw new Error(failureMessage);

        success++;
        setProposals((prev) => prev.map((x, idx) => (idx === i ? { ...x, state: 'done' } : x)));
      } catch (err: any) {
        const message = err?.message || 'Submission failed';
        if (!firstError) firstError = message;
        setProposals((prev) =>
          prev.map((x, idx) => (idx === i ? { ...x, state: 'failed', error: message } : x))
        );
      }
    }

    setSubmitting(false);
    queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
    queryClient.invalidateQueries({ queryKey: ['template-coverage'] });
    queryClient.invalidateQueries({ queryKey: ['template-coverage-gaps'] });

    const failed = proposals.length - success;
    if (success > 0 && failed === 0) {
      toast.success(`Submitted ${success} template${success === 1 ? '' : 's'} for Meta review`);
      onOpenChange(false);
    } else if (success > 0) {
      toast.warning(`${success} submitted, ${failed} failed — ${firstError}`);
    } else {
      toast.error(firstError || 'No templates were submitted');
    }
  };

  const pendingCount = proposals.filter((p) => p.state !== 'done').length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl p-0 flex flex-col h-full gap-0">
        <SheetHeader className="px-6 py-5 border-b border-slate-100 shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="text-left">
              <SheetTitle>AI Template Studio</SheetTitle>
              <SheetDescription>
                Generate brand-aligned WhatsApp templates for missing system events.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 'pick' ? (
            <div className="space-y-4">
              {!matrixLoading && (
                <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {channelEvents.length - uncovered.length} of {channelEvents.length} system events
                    covered
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {brokenTemplates.length > 0
                      ? `${brokenTemplates.length} approved template(s) no longer exist in Meta — listed below.`
                      : 'Coverage counts only templates Meta still has approved and live.'}
                  </p>
                </div>
              )}

              {brokenTemplates.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-bold text-amber-900">
                      Missing in Meta — needs recreating
                    </span>
                  </div>
                  <p className="text-xs text-amber-800">
                    These events have a CRM template, but Meta dropped the approved template. Select
                    the event below to generate fresh copy, or re-submit the existing template from the
                    Templates list (filter “Missing / Stale”).
                  </p>
                  <ul className="space-y-1">
                    {brokenTemplates.map((b) => (
                      <li
                        key={`${b.metaName}-${b.event}`}
                        className="text-xs text-amber-900 bg-white/70 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="font-semibold">{b.templateName}</span>
                        <span className="text-amber-700"> · {b.metaName} · {b.event}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">

                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Select events to cover ({uncovered.length} gaps)
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={pickAll}
                    className="text-indigo-600 hover:text-indigo-700"
                  >
                    Select all
                  </Button>
                  {picked.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearAll} className="text-slate-500">
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {matrixLoading ? (
                <div className="grid gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />
                  ))}
                </div>
              ) : uncovered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-3 rounded-full bg-emerald-50 text-emerald-600 mb-3">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <p className="font-semibold text-slate-900">Every system event is covered</p>
                  <p className="text-sm text-slate-500 mt-1 max-w-sm">
                    All {channel} events already have an approved template. Sync from Meta if you
                    think this is out of date.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {uncovered.map((event) => (
                    <button
                      type="button"
                      key={event.event}
                      onClick={() => togglePick(event.event)}
                      aria-pressed={picked.has(event.event)}
                      className={`flex items-center gap-3 p-4 rounded-2xl border text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                        picked.has(event.event)
                          ? 'border-indigo-200 bg-indigo-50/50 shadow-sm'
                          : 'border-slate-100 bg-white hover:border-slate-200'
                      }`}
                    >
                      <Checkbox checked={picked.has(event.event)} className="rounded-full pointer-events-none" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{event.label}</span>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {event.category}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{event.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Review generated proposals ({proposals.length})
              </h3>
              {proposals.map((p, i) => (
                <div
                  key={`${p.name}-${i}`}
                  className={`p-4 rounded-2xl border space-y-3 transition-colors ${
                    p.state === 'failed'
                      ? 'border-red-200 bg-red-50/50'
                      : p.state === 'done'
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-slate-100 bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge className="bg-indigo-600 truncate max-w-[200px]">{p.name}</Badge>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="bg-white capitalize text-[10px]">
                        {p.category}
                      </Badge>
                      {p.state === 'submitting' && (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                      )}
                      {p.state === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                      {p.state === 'failed' && <AlertCircle className="h-4 w-4 text-red-600" />}
                      {p.state === 'pending' && !submitting && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => removeProposal(i)}
                          className="h-7 w-7 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-slate-700 bg-white p-3 rounded-xl border border-slate-100 whitespace-pre-wrap font-medium leading-relaxed">
                    {p.body_text || p.body}
                  </div>
                  {p.footer && <div className="text-[10px] text-slate-400 px-1">Footer: {p.footer}</div>}
                  {p.error && (
                    <p className="text-xs text-red-600 leading-relaxed px-1">{p.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4 flex items-center justify-between gap-3">
          {step === 'pick' ? (
            <>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="rounded-xl text-slate-500 font-semibold"
              >
                Cancel
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl border-slate-200 text-slate-600 font-semibold h-11"
                  onClick={() => {
                    supabase.functions
                      .invoke('manage-whatsapp-templates', {
                        body: { action: 'list', branch_id: effectiveBranchId },
                      })
                      .then(() => {
                        toast.success('Sync triggered');
                        queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
                        queryClient.invalidateQueries({ queryKey: ['template-coverage-gaps'] });
                      });
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Sync from Meta
                </Button>
                <Button
                  onClick={generate}
                  disabled={generating || picked.size === 0}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 px-6 shadow-lg shadow-indigo-200"
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Thinking...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> Generate {picked.size || ''} Templates
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setStep('pick')}
                disabled={submitting}
                className="rounded-xl text-slate-600 font-semibold"
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to events
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="rounded-xl text-slate-500 font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitAll}
                  disabled={submitting || pendingCount === 0}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 px-6 shadow-lg shadow-indigo-200"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" /> Submit {pendingCount} to Meta
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
