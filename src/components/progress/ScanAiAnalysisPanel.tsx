import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, RefreshCw, Loader2, CheckCircle2, AlertTriangle, CalendarDays, MessageCircleQuestion } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Analysis {
  summary: string;
  items: Array<{ term: string; value: string; status: string; explanation: string; why?: string }>;
  strengths: string[];
  focus: string[];
  plan: Array<{ week: string; actions: string[] }>;
  questions: string[];
}

const tone = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes('above') || s.includes('high')) return 'bg-destructive/10 text-destructive border border-destructive/20';
  if (s.includes('below') || s.includes('low') || s.includes('watch')) return 'bg-amber-500/10 text-amber-600 border border-amber-500/20';
  return 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20';
};

export function ScanAiAnalysisPanel({ reportId, kind, canRegenerate }: { reportId: string; kind: 'body' | 'posture'; canRegenerate?: boolean }) {
  const qc = useQueryClient();
  const key = ['scan-ai-analysis', reportId, kind];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Analysis | null> => {
      const { data, error } = await supabase.from('scan_report_ai_analysis').select('analysis')
        .eq('report_id', reportId).eq('kind', kind).maybeSingle();
      if (error) throw error;
      return (data?.analysis as unknown as Analysis) ?? null;
    },
  });

  const regen = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('deliver-scan-report', {
        body: { report_id: reportId, kind, regenerate: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Report and AI analysis rebuilt');
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['howbody-reports'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not rebuild the report'),
  });

  return (
    <section aria-labelledby="ai-analysis-title" className="mt-6 space-y-3 rounded-2xl bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="ai-analysis-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> AI coach analysis
        </h3>
        {canRegenerate ? (
          <Button size="sm" variant="ghost" onClick={() => regen.mutate()} disabled={regen.isPending} className="min-h-[44px]">
            {regen.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            {data ? 'Rebuild' : 'Build analysis'}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-16 w-full" /></div>
      ) : isError ? (
        <div className="text-sm text-muted-foreground">
          Couldn't load the analysis. <Button variant="link" className="h-auto p-0" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          The AI analysis is prepared automatically with the report. {canRegenerate ? 'Use "Build analysis" if it is missing.' : 'Check back shortly.'}
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>
          <Accordion type="multiple" className="rounded-xl bg-card px-3">
            <AccordionItem value="items">
              <AccordionTrigger className="text-sm">Every value explained ({data.items.length})</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-3">
                  {data.items.map((it) => (
                    <li key={it.term} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{it.term}</span>
                        <span className="text-sm font-semibold tabular-nums text-primary">{it.value}</span>
                        <Badge className={`rounded-full text-[10px] ${tone(it.status)}`}>{it.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{it.explanation}</p>
                      {it.why ? <p className="text-xs text-muted-foreground/80">Why it matters: {it.why}</p> : null}
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="sf">
              <AccordionTrigger className="text-sm">Strengths and focus areas</AccordionTrigger>
              <AccordionContent className="space-y-2">
                {data.strengths.map((s) => <p key={s} className="flex gap-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />{s}</p>)}
                {data.focus.map((s) => <p key={s} className="flex gap-2 text-xs"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />{s}</p>)}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="plan">
              <AccordionTrigger className="text-sm">4-week plan</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {data.plan.map((w) => (
                  <div key={w.week}>
                    <p className="flex items-center gap-1 text-xs font-semibold text-primary"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{w.week}</p>
                    <ul className="ml-5 list-disc space-y-1 text-xs">{w.actions.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
            {data.questions.length ? (
              <AccordionItem value="q" className="border-b-0">
                <AccordionTrigger className="text-sm">Ask your trainer</AccordionTrigger>
                <AccordionContent className="space-y-1">
                  {data.questions.map((q) => <p key={q} className="flex gap-2 text-xs"><MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />{q}</p>)}
                </AccordionContent>
              </AccordionItem>
            ) : null}
          </Accordion>
          <p className="text-[11px] text-muted-foreground">Wellness guidance from your scan, not a medical diagnosis.</p>
        </>
      )}
    </section>
  );
}
