import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Send, RefreshCw } from 'lucide-react';
import { SYSTEM_EVENTS, type EventChannel } from '@/lib/templates/systemEvents';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: EventChannel;
  prefilledEvents?: string[];
}

export function AIGenerateTemplatesDrawer({ open, onOpenChange, channel = 'whatsapp', prefilledEvents = [] }: Props) {
  const { effectiveBranchId } = useBranchContext();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [picked, setPicked] = useState<Set<string>>(new Set(prefilledEvents));
  const [generating, setGenerating] = useState(false);
  const [proposals, setProposals] = useState<any[]>([]);
  const [bulk, setBulk] = useState<{ total: number; done: number } | null>(null);

  const { data: matrix = [], isLoading: matrixLoading } = useQuery({
    queryKey: ['template-coverage-matrix', channel],
    queryFn: async () => {
      const { data: templates, error: tplError } = await supabase
        .from('templates')
        .select('trigger_event, type, meta_template_status')
        .eq('type', channel);
      
      if (tplError) throw tplError;

      const { data: triggers, error: trigError } = await supabase
        .from('whatsapp_triggers')
        .select('event_name, is_active, template_id, templates(id, meta_template_status)')
        .eq('branch_id', effectiveBranchId!);

      if (trigError) throw trigError;

      // Map triggers to the matrix format
      return (triggers || []).map(trig => ({
        trigger_event: trig.event_name,
        type: channel,
        meta_template_status: trig.templates?.meta_template_status || 'DRAFT'
      }));
    },
    enabled: !!effectiveBranchId
  });

  const uncovered = useMemo(() => {
    const coveredEvents = new Set(matrix.filter((c: any) => c.meta_template_status === 'APPROVED').map((c: any) => c.trigger_event));
    return SYSTEM_EVENTS.filter(e => !coveredEvents.has(e.event) && e.channels.includes(channel));
  }, [matrix, channel]);


  const togglePick = (event: string) => {
    const next = new Set(picked);
    if (next.has(event)) next.delete(event);
    else next.add(event);
    setPicked(next);
  };

  const pickAll = () => {
    setPicked(new Set(uncovered.map(e => e.event)));
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-whatsapp-templates', {
        body: { 
          events: Array.from(picked).map(e => ({ event: e })),
          branch_id: effectiveBranchId 
        }
      });
      if (error) throw error;
      setProposals(data.templates || []);
      setStep('review');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate templates');
    } finally {
      setGenerating(false);
    }
  };

  const submitAll = async () => {
    setBulk({ total: proposals.length, done: 0 });
    let success = 0;
    for (const p of proposals) {
      try {
        const { error } = await supabase.functions.invoke('manage-whatsapp-templates', {
          body: { 
            action: 'upsert', 
            template: p,
            branch_id: effectiveBranchId
          }
        });
        if (error) throw error;
        success++;
        setBulk(prev => prev ? { ...prev, done: success } : null);
      } catch (err) {
        console.error('Failed to submit template', p.name, err);
      }
    }
    toast.success(`Successfully submitted ${success} templates to Meta`);
    queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
    queryClient.invalidateQueries({ queryKey: ['template-coverage'] });
    onOpenChange(false);
    setBulk(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto pb-32">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle>AI Template Studio</SheetTitle>
              <SheetDescription>
                Generate brand-aligned WhatsApp templates for missing system events.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {step === 'pick' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Select events to cover ({uncovered.length} gaps)
                </h3>
                <Button variant="ghost" size="sm" onClick={pickAll} className="text-indigo-600 hover:text-indigo-700">
                  Select All
                </Button>
              </div>
              <div className="grid gap-2">
                {uncovered.map((event) => (
                  <div
                    key={event.event}
                    onClick={() => togglePick(event.event)}
                    className={`flex items-center gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${
                      picked.has(event.event) 
                        ? 'border-indigo-200 bg-indigo-50/50 shadow-sm' 
                        : 'border-slate-100 bg-white hover:border-slate-200'
                    }`}
                  >
                    <Checkbox checked={picked.has(event.event)} className="rounded-full" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{event.label}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{event.category}</Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{event.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Review Generated Proposals
              </h3>
              {proposals.map((p, i) => (
                <div key={i} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-indigo-600">{p.name}</Badge>
                    <Badge variant="outline" className="bg-white capitalize">{p.category}</Badge>
                  </div>
                  <div className="text-sm text-slate-700 bg-white p-3 rounded-xl border border-slate-100 whitespace-pre-wrap font-medium leading-relaxed">
                    {p.body_text || p.body}
                  </div>
                  {p.footer && (
                    <div className="text-[10px] text-slate-400 px-1">
                      Footer: {p.footer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <SheetFooter className="absolute bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-slate-100 p-6 z-50">
          <div className="flex w-full items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl text-slate-500 font-semibold px-6">
              Cancel
            </Button>
            
            <div className="flex flex-col gap-2 flex-1">
              {step === 'pick' ? (
                <>
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
                      supabase.functions.invoke('manage-whatsapp-templates', { body: { action: 'list' } })
                        .then(() => {
                          toast.success('Sync triggered in background');
                          queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
                        });
                    }}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Sync Existing from Meta
                  </Button>
                </>
              ) : (
                <Button
                  onClick={submitAll}
                  disabled={!!bulk}
                  className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 text-white font-bold h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {bulk ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting {bulk.done}/{bulk.total}...</>
                  ) : (
                    <><Send className="mr-2 h-5 w-5" /> Submit All ({proposals.length})</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
