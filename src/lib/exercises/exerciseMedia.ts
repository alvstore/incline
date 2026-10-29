import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Private bucket holding the exercise demo library (exercisedb/<slug>/…). */
export const EXERCISE_MEDIA_BUCKET = 'inclineexercisedb';
export const EXERCISE_MEDIA_PREFIX = 'exercisedb/';
const SIGNED_TTL_SECONDS = 60 * 60;

/** True when the value is a library path that needs a signed URL. */
export function isExerciseLibraryPath(value: string | null | undefined): value is string {
  return !!value && value.startsWith(EXERCISE_MEDIA_PREFIX);
}

/**
 * Resolves an exercise media reference to a playable URL. Library paths are
 * signed (1 h, cached); any other value (full URL) is returned unchanged.
 * Pass `enabled=false` to avoid any network request until the member opts in.
 */
export function useExerciseMediaUrl(value: string | null | undefined, enabled = true) {
  const needsSigning = isExerciseLibraryPath(value);
  const query = useQuery({
    queryKey: ['exercise-media-url', value],
    enabled: enabled && needsSigning,
    staleTime: (SIGNED_TTL_SECONDS - 300) * 1000,
    gcTime: SIGNED_TTL_SECONDS * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(EXERCISE_MEDIA_BUCKET)
        .createSignedUrl(value as string, SIGNED_TTL_SECONDS);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  if (!value) return { url: null, isLoading: false, isError: false };
  if (!needsSigning) return { url: value, isLoading: false, isError: false };
  return { url: query.data ?? null, isLoading: query.isLoading && enabled, isError: query.isError };
}

// ---- "Show video previews" preference (shared across cards, persisted) ----

const PREF_KEY = 'incline:exercise-previews';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setExercisePreviewsEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable (private mode) — preference just won't persist */
  }
  listeners.forEach((l) => l());
}

/** Previews are OFF by default so no media downloads until the member opts in. */
export function useExercisePreviewsEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => false,
  );
}
