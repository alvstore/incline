import { Film } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { track } from '@/lib/analytics';
import { setExercisePreviewsEnabled, useExercisePreviewsEnabled } from '@/lib/exercises/exerciseMedia';

/** Opt-in switch: exercise pictures and demo videos load only while it is on. */
export function ExercisePreviewToggle({ className = '' }: { className?: string }) {
  const on = useExercisePreviewsEnabled();
  return (
    <div
      className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Film className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <Label htmlFor="exercise-preview-toggle" className="cursor-pointer text-sm font-semibold text-foreground">
            Exercise demos
          </Label>
          <p className="text-[11px] text-muted-foreground">
            {on ? 'On — tap a picture to play the video (staff preview)' : 'Off — turn on to preview demos'}
          </p>
        </div>
      </div>
      <Switch
        id="exercise-preview-toggle"
        checked={on}
        onCheckedChange={(v) => {
          setExercisePreviewsEnabled(v);
          track('exercise_previews_toggled', { on: v });
        }}
        aria-label="Show exercise demo pictures and videos"
        className="cursor-pointer"
      />
    </div>
  );
}
