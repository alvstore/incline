// Frontend error reporter — pipes uncaught errors and ErrorBoundary failures to
// the unified error_logs table via log_error_event RPC.
// v1.2.0 — filters benign noise (offline, abort, login errors, Radix dev warnings)
// and auto-recovers from stale dynamic-import chunks after deploys.
import { supabase } from '@/integrations/supabase/client';

const RELEASE_SHA = (import.meta.env.VITE_RELEASE_SHA as string) || 'dev';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

let reporterDisabled = false;

// Patterns we never want in error_logs (user-driven, transient, or library noise).
const NOISE_PATTERNS: RegExp[] = [
  /signal is aborted/i,
  /\bAbortError\b/,
  /Invalid login credentials/i,
  /DialogContent.*requires a.*DialogTitle/i,
  /ResizeObserver loop/i,
  /^not_found$/i,
  /Non-Error promise rejection captured/i,
];

function isNoise(message: string): boolean {
  if (!message) return true;
  // Drop network failures while offline — those are environmental.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (/Failed to fetch|NetworkError|Load failed|Network error/i.test(message)) return true;
  }
  return NOISE_PATTERNS.some((re) => re.test(message));
}

// Handle stale-chunk failures after a deploy: reload the page once.
function handleStaleChunk(message: string): boolean {
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message)) {
    return false;
  }
  if (typeof window === 'undefined') return false;
  const KEY = '__incline_chunk_reloaded';
  try {
    if (sessionStorage.getItem(KEY)) return false; // already tried once this session
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  } catch { /* noop */ }
  return true;
}

export async function reportError(
  message: string,
  opts: {
    severity?: ErrorSeverity;
    stack?: string | null;
    route?: string | null;
    context?: Record<string, unknown> | null;
    branchId?: string | null;
  } = {},
) {
  if (reporterDisabled) return;
  const msg = String(message || '').slice(0, 2000);
  if (isNoise(msg)) return;
  if (handleStaleChunk(msg)) return; // reloads, no log needed
  try {
    const { data: userResult } = await supabase.auth.getUser();
    const { error } = await (supabase.rpc as any)('log_error_event', {
      p_severity: opts.severity || 'error',
      p_source: 'frontend',
      p_message: msg,
      p_function_name: null,
      p_route: opts.route || (typeof window !== 'undefined' ? window.location.pathname : null),
      p_table_name: null,
      p_branch_id: opts.branchId || null,
      p_user_id: userResult?.user?.id || null,
      p_request_id: null,
      p_release_sha: RELEASE_SHA,
      p_stack: opts.stack || null,
      p_context: opts.context || null,
    });
    // If the RPC is missing (404 / PGRST202), permanently disable reporting
    // for this session so we don't spam the console with retries.
    if (error && (error.code === 'PGRST202' || (error as any).status === 404)) {
      reporterDisabled = true;
    }
  } catch {
    /* never throw from reporter */
  }
}

let installed = false;
export function installGlobalErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    reportError(e.message || 'window.onerror', {
      severity: 'error',
      stack: e.error?.stack || null,
      context: { filename: e.filename, lineno: e.lineno, colno: e.colno },
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason;
    reportError(reason?.message || String(reason || 'unhandledrejection'), {
      severity: 'error',
      stack: reason?.stack || null,
      context: { kind: 'unhandledrejection' },
    });
  });
}
