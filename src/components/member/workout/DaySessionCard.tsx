import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock, Dumbbell, ExternalLink, Layers, Moon, Play, Timer, X } from 'lucide-react';
import { estimatedMinutes, totalSets, type WorkoutDay, type WorkoutExercise } from './planNormalize';
import { getVideoPublicUrl } from '@/services/videoUploadService';
import { track } from '@/lib/analytics';
import { useExerciseDemosAllowed, useExerciseMediaUrl } from '@/lib/exercises/exerciseMedia';

const EMBED_HOSTS_RE = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)/i;

function resolveVideoUrl(ex: WorkoutExercise): string | null {
  if (ex.video_url) return ex.video_url;
  if (ex.video_file_path) return getVideoPublicUrl(ex.video_file_path);
  return null;
}

/** Expandable inline demo player for one exercise. Direct files play in a
 *  <video> tag; YouTube/Vimeo open externally. No autoplay, ever. */
function ExerciseVideoButton({ exercise }: { exercise: WorkoutExercise }) {
  const [open, setOpen] = useState(false);
  const previewsOn = useExerciseDemosAllowed();
  const raw = resolveVideoUrl(exercise);
  // Nothing downloads until the member switches demos on; the MP4 only after a tap.
  const { url: poster, refresh: refreshPoster } = useExerciseMediaUrl(exercise.poster_url, previewsOn);
  const {
    url,
    isLoading: videoLoading,
    isError: videoError,
    refresh: refreshVideo,
  } = useExerciseMediaUrl(raw, previewsOn && open, { autoRenew: false });
  // Expired links are re-requested once per open; a second failure shows "unavailable".
  const [videoRetried, setVideoRetried] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const onVideoError = () => {
    if (!videoRetried) {
      setVideoRetried(true);
      refreshVideo();
    } else {
      setVideoFailed(true);
    }
  };
  const retryVideo = () => {
    setVideoFailed(false);
    setVideoRetried(false);
    refreshVideo();
  };
  if (!raw || !previewsOn) return null;
  const isEmbedHost = !!url && EMBED_HOSTS_RE.test(url);

  if (isEmbedHost) {
    return (
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          track('exercise_video_played', { exercise: exercise.name, kind: 'external' });
        }}
        className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs font-medium text-primary transition-colors duration-200 hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label={`Watch demo video for ${exercise.name} (opens in new tab)`}
      >
        <Play className="h-3.5 w-3.5" /> Watch demo <ExternalLink className="h-3 w-3 text-muted-foreground" />
      </a>
    );
  }

  const toggle = () =>
    setOpen((v) => {
      if (!v) {
        track('exercise_demo_played', { exercise: exercise.name, kind: 'inline' });
        setVideoRetried(false);
        setVideoFailed(false);
      }
      return !v;
    });
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="px-3 pb-3">
      {!open && poster ? (
        // Instant WebP preview (a few KB) — the MP4 only downloads after a tap.
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={`Play demo video for ${exercise.name}`}
          className="group relative flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-background p-2 text-left transition-colors duration-200 hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
            <img
              src={poster}
              alt=""
              width={96}
              height={64}
              loading="lazy"
              decoding="async"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              onError={refreshPoster}
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-foreground/10">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-primary">
                <Play className="h-4 w-4" />
              </span>
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-foreground">Watch how it's done</span>
            <span className="block text-[11px] text-muted-foreground">Tap to play the demo</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Watch'} demo video for ${exercise.name}`}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-background px-4 text-xs font-medium text-primary transition-colors duration-200 hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {open ? <X className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {open ? 'Hide video' : 'Watch demo'}
        </button>
      )}
      {open && (
        <div className="mt-2 w-full max-w-xs overflow-hidden rounded-xl border border-border/60 bg-muted sm:max-w-sm">
          {videoFailed || (!videoLoading && !url && (videoError || open)) && !videoLoading && !url ? (
            <div className="flex aspect-video max-h-[220px] w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-muted-foreground" role="alert">
              <span>This demo couldn't load right now.</span>
              <Button type="button" size="sm" variant="outline" className="h-9 cursor-pointer" onClick={retryVideo}>
                Try again
              </Button>
            </div>
          ) : videoLoading || !url ? (
            <div className="flex aspect-video max-h-[220px] w-full items-center justify-center text-xs text-muted-foreground" role="status">
              Loading video…
            </div>
          ) : (
          <video
            key={url}
            src={url}
            poster={poster ?? undefined}
            controls
            controlsList="nodownload noremoteplayback noplaybackrate"
            disablePictureInPicture
            disableRemotePlayback
            onContextMenu={(e) => e.preventDefault()}
            onError={onVideoError}
            muted
            loop={!reduceMotion}
            autoPlay={!reduceMotion}
            preload="none"
            playsInline
            className="aspect-video max-h-[220px] w-full bg-muted object-contain"
            aria-label={`Demo video: ${exercise.name}`}
          />
          )}
          {exercise.form_tips && exercise.form_tips.length > 0 && (
            <div className="bg-card px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Form cues
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground">
                {exercise.form_tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DaySessionCardProps {
  day: WorkoutDay;
  doneKeys: Set<string>;
  onToggleExercise: (exerciseIndex: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** One focused training day: hero band, exercise rows with tick-off, progress. */
export function DaySessionCard({
  day,
  doneKeys,
  onToggleExercise,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: DaySessionCardProps) {
  const doneCount = day.exercises.filter((_, i) => doneKeys.has(`${day.id}:${i}`)).length;
  const pct = day.exercises.length ? Math.round((doneCount / day.exercises.length) * 100) : 0;

  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
      {/* Hero band */}
      <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-primary/5 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-lg font-bold">{day.dayLabel}</h3>
              {day.weekLabel && <Badge variant="secondary" className="text-[11px]">{day.weekLabel}</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {day.isRest ? 'Recovery day — mobility, walking and sleep' : day.focus || 'Training session'}
            </p>
          </div>
          {!day.isRest && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Stat icon={<Layers className="h-3.5 w-3.5" />} label={`${day.exercises.length} exercises`} />
              <Stat icon={<Timer className="h-3.5 w-3.5" />} label={`${totalSets(day)} sets`} />
              <Stat icon={<Clock className="h-3.5 w-3.5" />} label={`~${estimatedMinutes(day)} min`} />
            </div>
          )}
        </div>

        {!day.isRest && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Session progress</span>
              <span className="font-semibold text-foreground">{doneCount}/{day.exercises.length}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        )}
      </div>

      <CardContent className="space-y-2.5 p-4 sm:p-5">
        {day.isRest ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Moon className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No training scheduled. Focus on recovery and hydration.</p>
          </div>
        ) : (
          day.exercises.map((exercise, i) => {
            const key = `${day.id}:${i}`;
            const done = doneKeys.has(key);
            return (
              <div
                key={key}
                className={cn(
                  'rounded-xl border transition-colors duration-200',
                  done ? 'border-success/30 bg-success/5' : 'border-border/60 bg-muted/40',
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggleExercise(i)}
                  aria-pressed={done}
                  aria-label={`Mark ${exercise.name} as ${done ? 'not done' : 'done'}`}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-3 rounded-t-xl p-3 text-left transition-colors duration-200',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                    !done && 'hover:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      done ? 'bg-success/15 text-success' : 'bg-background text-muted-foreground',
                    )}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm font-semibold', done && 'line-through opacity-70')}>
                      {exercise.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{exercise.sets} sets × {exercise.reps || '—'}</span>
                      {exercise.rest && <span>Rest {exercise.rest}</span>}
                      {exercise.equipment && (
                        <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                          <Dumbbell className="h-3 w-3" aria-hidden="true" />
                          {exercise.equipment}
                        </span>
                      )}
                    </span>
                    {exercise.notes && (
                      <span className="mt-1 block text-xs italic text-muted-foreground">{exercise.notes}</span>
                    )}
                  </span>
                  <Circle className={cn('mt-1 h-4 w-4 shrink-0', done ? 'hidden' : 'text-muted-foreground/40')} />
                </button>
                <ExerciseVideoButton exercise={exercise} />
              </div>
            );
          })
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 font-medium text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}
