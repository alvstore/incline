import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Private bucket holding the exercise demo library (exercisedb/<slug>/…). */
export const EXERCISE_MEDIA_BUCKET = 'inclineexercisedb';
export const EXERCISE_MEDIA_PREFIX = 'exercisedb/';
/** Links are handed out by the backend and expire after 5 minutes (mirrors exercise-media-sign TTL). */
export const SIGNED_TTL_SECONDS = 300;
/** Treat a link as expired this long before the server does, so it never reaches the player stale. */
const EXPIRY_MARGIN_MS = 30_000;

/** Pure: is a signed link issued at `issuedAt` still safe to hand to <img>/<video> at `now`? */
export function isSignedLinkFresh(issuedAt: number, now: number, ttlSeconds = SIGNED_TTL_SECONDS): boolean {
  return now < issuedAt + ttlSeconds * 1000 - EXPIRY_MARGIN_MS;
}

/** True when the value is a library path that needs a signed URL. */
export function isExerciseLibraryPath(value: string | null | undefined): value is string {
  return !!value && value.startsWith(EXERCISE_MEDIA_PREFIX);
}

// Collect paths requested in the same tick into one backend call.
type Pending = { resolve: (u: string | null) => void; reject: (e: unknown) => void };
let queue = new Map<string, Pending[]>();
let scheduled = false;
function flush() {
  scheduled = false;
  const batch = queue;
  queue = new Map();
  const paths = [...batch.keys()];
  for (let i = 0; i < paths.length; i += 60) {
    const chunk = paths.slice(i, i + 60);
    supabase.functions
      .invoke('exercise-media-sign', { body: { paths: chunk } })
      .then(({ data, error }) => {
        if (error) throw error;
        const urls = (data?.urls ?? {}) as Record<string, string>;
        chunk.forEach((p) => batch.get(p)?.forEach((w) => w.resolve(urls[p] ?? null)));
      })
      .catch((e) => chunk.forEach((p) => batch.get(p)?.forEach((w) => w.reject(e))));
  }
}
function signPath(path: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const list = queue.get(path) ?? [];
    list.push({ resolve, reject });
    queue.set(path, list);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
}

/**
 * Resolves an exercise media reference to a playable URL. Library paths get a
 * short-lived link from the backend (which checks role, branch switch and plan
 * ownership); any other value (full URL) is returned unchanged.
 */
export function useExerciseMediaUrl(value: string | null | undefined, enabled = true) {
  const needsSigning = isExerciseLibraryPath(value);
  const query = useQuery({
    queryKey: ['exercise-media-url', value],
    enabled: enabled && needsSigning,
    staleTime: (SIGNED_TTL_SECONDS - 30) * 1000,
    gcTime: SIGNED_TTL_SECONDS * 1000,
    retry: false,
    queryFn: () => signPath(value as string),
  });
  if (!value) return { url: null, isLoading: false, isError: false };
  if (!needsSigning) return { url: value, isLoading: false, isError: false };
  return { url: query.data ?? null, isLoading: query.isLoading && enabled, isError: query.isError };
}

/** Server-decided: staff always; members only when an owner/admin turned demos on for their branch. */
export function useExerciseDemosAllowed() {
  const q = useQuery({
    queryKey: ['exercise-demos-allowed'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_view_exercise_demos');
      if (error) throw error;
      return data === true;
    },
  });
  return q.data === true;
}

/** Pure rule mirrored from the server, kept here so it is unit-tested. */
export function demosVisible(roles: string[], branchSwitchOn: boolean): boolean {
  const staff = ['owner', 'admin', 'manager', 'trainer', 'staff'];
  if (roles.some((r) => staff.includes(r))) return true;
  return roles.includes('member') && branchSwitchOn;
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
