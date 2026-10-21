import { Loader2, OctagonAlert, RefreshCw, ShieldCheck, Sparkles, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHealthGuidance, type HealthGuidance } from '@/hooks/useTrainerHealth';

function List({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone === 'warn' ? 'text-destructive' : 'text-muted-foreground'}`}>{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

export function HealthGuidancePanel({ memberId }: { memberId: string }) {
  const { data, mutate, isPending, error } = useHealthGuidance(memberId);
  const g: HealthGuidance | undefined = data?.guidance;
  return (
    <section className="rounded-xl border border-accent/20 bg-accent/5 p-4" aria-labelledby="ai-precautions-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="ai-precautions-title" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />AI precautions
        </h3>
        {g && (
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => mutate(true)} disabled={isPending} aria-label="Regenerate AI precautions">
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        )}
      </div>
      <div aria-live="polite" aria-busy={isPending}>
        {!g && (
          <>
            <p className="mb-3 text-sm text-muted-foreground">Get a safety plan for this client: warning signs, exercises to avoid, safer swaps and questions to ask.</p>
            <Button onClick={() => mutate(false)} disabled={isPending} className="min-h-[44px] w-full">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Stethoscope className="mr-2 h-4 w-4" aria-hidden />}
              {isPending ? 'Analysing…' : 'Get AI precautions'}
            </Button>
          </>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{(error as Error).message}</p>}
        {g && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">{g.summary}</p>
            {g.needs_doctor_clearance && (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2 text-sm text-destructive">
                <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Get a doctor's clearance before intense training.
              </p>
            )}
            <List title="Stop the session if" items={g.warning_signs} tone="warn" />
            <List title="Avoid or modify" items={g.avoid_or_modify} />
            <List title="Safer alternatives" items={g.safer_alternatives} />
            <List title="How to start" items={g.how_to_start} />
            <List title="Ask before training" items={g.ask_before_training} />
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Guidance only, not medical advice. For serious conditions, ask for a doctor's clearance.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
