import { Loader2, OctagonAlert, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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

/** Loads saved precautions automatically; creates them once if missing. Regenerates only when goals/health change (server-side). */
export function HealthGuidancePanel({ memberId }: { memberId: string }) {
  const { data, isLoading, isError, error, regenerate, regenerating } = useHealthGuidance(memberId);
  const g: HealthGuidance | null | undefined = data?.guidance;
  return (
    <section className="rounded-xl border border-accent/20 bg-accent/5 p-4" aria-labelledby="ai-precautions-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="ai-precautions-title" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />AI precautions
        </h3>
        {g && data?.can_regenerate && (
          <Button variant="ghost" size="sm" className="min-h-[44px] text-xs" onClick={regenerate} disabled={regenerating}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} aria-hidden />Regenerate
          </Button>
        )}
      </div>
      <div aria-live="polite" aria-busy={isLoading || regenerating}>
        {isLoading ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Preparing precautions…</p>
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" />
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p>
        ) : data?.none_needed || !g ? (
          <p className="text-sm text-muted-foreground">No health precautions needed.</p>
        ) : (
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
