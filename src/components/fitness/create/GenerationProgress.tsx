import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  type: 'workout' | 'diet';
  /** Wall-clock seconds after which we consider the run at risk. */
  timeoutSeconds?: number;
  onCancel: () => void;
}

const stagesFor = (type: 'workout' | 'diet') =>
  type === 'workout'
    ? ['Reading member profile', 'Matching gym equipment', 'Composing the template week', 'Building rotation variants', 'Finalising the program']
    : ['Reading member profile', 'Matching the meal catalog', 'Composing daily meals', 'Balancing macros', 'Finalising the plan'];

/** Live progress panel for long AI plan generation — staged labels, elapsed
 * timer, a soft-capped progress bar and a working cancel button. */
export function GenerationProgress({ type, timeoutSeconds = 90, onCancel }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const stages = stagesFor(type);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Ease toward 95% over the expected window so the bar never stalls at 100%.
  const pct = Math.min(95, Math.round((1 - Math.exp(-elapsed / (timeoutSeconds / 3.5))) * 95));
  const stageIdx = Math.min(stages.length - 1, Math.floor((pct / 95) * stages.length));

  return (
    <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {stages[stageIdx]}…
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{elapsed}s</span>
      </div>

      <Progress value={pct} className="h-2" />

      <ol className="space-y-1">
        {stages.map((s, i) => (
          <li
            key={s}
            className={cn(
              'flex items-center gap-2 text-xs',
              i < stageIdx && 'text-muted-foreground',
              i === stageIdx && 'text-foreground font-medium',
              i > stageIdx && 'text-muted-foreground/50',
            )}
          >
            {i < stageIdx ? (
              <Check className="h-3 w-3 text-success" />
            ) : (
              <span className="h-3 w-3 rounded-full border border-current" />
            )}
            {s}
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted-foreground">
          {elapsed > 45 ? 'Taking longer than usual — large plans can take up to a minute.' : 'Usually takes 10–25 seconds.'}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 shrink-0">
          <X className="mr-1 h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );
}
