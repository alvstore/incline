import { lazy, type ComponentType } from 'react';

/**
 * Route-level `lazy()` wrapper that survives stale deploy chunks.
 *
 * A dynamic `import()` fails when the hashed chunk referenced by the currently
 * loaded HTML no longer exists on the CDN (typical right after a deploy).
 * Chrome reports "Failed to fetch dynamically imported module"; Safari/iOS
 * reports the opaque message "Load failed" — which previously surfaced in
 * System Health as a critical route crash on pages like /fitness/templates.
 *
 * Strategy: retry once after a short delay (covers transient network blips),
 * then force a single cache-busting reload per session so the browser picks up
 * the new asset manifest. Never loops.
 */
const RELOAD_KEY = '__incline_chunk_retry';

function isChunkError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Load failed|error loading dynamically imported module/i.test(
    msg,
  );
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!isChunkError(err)) throw err;

      // Second chance — transient network failure.
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await factory();
      } catch (retryErr) {
        if (typeof window === 'undefined') throw retryErr;
        try {
          if (!sessionStorage.getItem(RELOAD_KEY)) {
            sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
            const url = new URL(window.location.href);
            url.searchParams.set('_r', String(Date.now()));
            window.location.replace(url.toString());
            // Keep the promise pending while the reload happens.
            return await new Promise<{ default: T }>(() => {});
          }
        } catch {
          /* storage blocked — fall through */
        }
        throw retryErr;
      }
    }
  });
}

/** Clears the one-shot reload guard once the app has successfully booted. */
export function clearChunkRetryGuard() {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* noop */
  }
}
