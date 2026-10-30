import { useExerciseMediaUrl, useExercisePreviewsEnabled } from '@/lib/exercises/exerciseMedia';

export interface ExercisePosterThumbProps {
  posterUrl?: string;
  index: number;
}

/** 40px exercise picture when demos are switched on; otherwise the step number. */
export function ExercisePosterThumb({ posterUrl, index }: ExercisePosterThumbProps) {
  const on = useExercisePreviewsEnabled();
  const { url, refresh } = useExerciseMediaUrl(posterUrl, on);
  if (on && url) {
    return (
      <img
        src={url}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        onError={refresh}
        className="h-10 w-10 shrink-0 rounded-md bg-muted object-cover"
      />
    );
  }
  return (
    <div className="h-6 w-6 rounded-full bg-primary/10 text-primary text-[11px] flex items-center justify-center font-semibold shrink-0">
      {index + 1}
    </div>
  );
}
