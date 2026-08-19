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

  // Coverage = an APPROVED template exists for the event on this channel.
  // Reading from `templates` (not only `whatsapp_triggers`) means events that
  // have a live approved template but no trigger row are no longer reported
  // as gaps.
  const { data: coveredEvents = new Set<string>(), isLoading: matrixLoading } = useQuery({
    queryKey: ['template-coverage-gaps', channel, effectiveBranchId],
    queryFn: async () => {
      const covered = new Set<string>();

      // Coverage = an APPROVED template exists for the event on this channel.
      // We look at the 'templates' table which contains local mappings.
      const { data: templates, error: tplError } = await supabase
        .from('templates')
        .select('trigger_event, type, meta_template_status, is_active, meta_template_name')
        .eq('type', channel);
      
      if (tplError) throw tplError;

      for (const t of templates || []) {
        // WhatsApp templates are only "covered" if Meta has approved them.
        // We also check that a meta template name exists to avoid counting drafts.
        // SMS/Email are covered if they are active.
        const approved = channel === 'whatsapp'
          ? (t.meta_template_status || '').toUpperCase() === 'APPROVED' && !!t.meta_template_name
          : t.is_active !== false;
        
        if (approved && t.trigger_event) covered.add(t.trigger_event);
      }

      // Also check explicit triggers in whatsapp_triggers for cross-check.
      if (channel === 'whatsapp' && effectiveBranchId) {
        const { data: triggers, error: trigError } = await supabase
          .from('whatsapp_triggers')
          .select('event_name, templates(meta_template_status)')
          .eq('branch_id', effectiveBranchId);
        
        if (trigError) throw trigError;
        for (const trig of triggers || []) {
          const status = (trig as any).templates?.meta_template_status;
          if ((status || '').toUpperCase() === 'APPROVED') covered.add(trig.event_name);
        }
      }

      return covered;
    },
    enabled: open,
  });

  const uncovered = useMemo(
    () => SYSTEM_EVENTS.filter((e) => !coveredEvents.has(e.event) && e.channels.includes(channel)),
    [coveredEvents, channel]
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
      toast.success(`Submitted ${success} template${success === 1 ? '' : 's'} to Meta`);
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
