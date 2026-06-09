import { supabase } from "@/integrations/supabase/client";

let initialized = false;
const errorQueue: Array<{
  error_message: string;
  stack_trace: string | null;
  component_name: string | null;
  route: string | null;
  source: string;
}> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushErrors() {
  if (errorQueue.length === 0) return;
  
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const batch = errorQueue.splice(0, 20);
    // Use log_error_event RPC (server-side fingerprinting + dedup)
    await Promise.all(batch.map((e) =>
      (supabase.rpc as any)('log_error_event', {
        p_severity: 'error',
        p_source: e.source,
        p_message: e.error_message,
        p_function_name: e.component_name,
        p_route: e.route,
        p_table_name: null,
        p_branch_id: null,
        p_user_id: session.user?.id || null,
        p_request_id: null,
        p_release_sha: (import.meta.env.VITE_RELEASE_SHA as string) || 'dev',
        p_stack: e.stack_trace,
        p_context: { browser: navigator.userAgent },
      }).then(() => undefined).catch(() => undefined)
    ));
  } catch {
    // Silently fail - never cause secondary crash
  }
}

function shouldDrop(msg: string): boolean {
  if (!msg) return true;
  // Don't log connectivity issues — these are user-side, not app bugs.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg === 'Load failed') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  }
  // Stale chunk errors trigger an auto-reload via main.tsx — don't double-log.
  if (msg.includes('Failed to fetch dynamically imported module')) return true;
  // Browser extension noise.
  if (msg.includes('ResizeObserver loop') || msg.includes('Non-Error promise rejection captured')) return true;
  // AbortController cancellations (e.g., Supabase JS abort on route unmount).
  if (msg.includes('signal is aborted') || msg.includes('AbortError') || msg.includes('The user aborted a request')) return true;
  return false;
}

// v: Dedup across the in-flight queue, not just the tail entry, so a burst of
// identical "Failed to fetch" calls from different components collapses to one.
function isDuplicateInQueue(message: string, windowMs = 30_000): boolean {
  const cutoff = Date.now() - windowMs;
  for (let i = errorQueue.length - 1; i >= 0; i--) {
    const e: any = errorQueue[i];
    if (e.error_message === message && (!e._t || e._t >= cutoff)) return true;
  }
  return false;
}

function queueError(entry: typeof errorQueue[0]) {
  if (shouldDrop(entry.error_message)) return;
  // Dedup across in-flight queue (30s window), not just the tail.
  if (isDuplicateInQueue(entry.error_message)) return;

  (entry as any)._t = Date.now();
  errorQueue.push(entry);

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushErrors, 2000);

  // Flush immediately if queue is large
  if (errorQueue.length >= 10) flushErrors();
}

function formatErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function getHumanReadableMessage(msg: string): string {
  // UUID errors
  if (msg.includes('invalid input syntax for type uuid'))
    return 'Invalid ID format - a record reference is malformed or missing';
  // FK violations
  if (msg.includes('violates foreign key constraint'))
    return 'Referenced record not found - the linked item may have been deleted';
  // Unique violations
  if (msg.includes('duplicate key value violates unique constraint'))
    return 'Duplicate entry - this record already exists';
  // RLS
  if (msg.includes('new row violates row-level security'))
    return 'Permission denied - you don\'t have access to perform this action';
  // Network
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError'))
    return 'Network error - check your internet connection';
  // Auth
  if (msg.includes('JWT expired') || msg.includes('invalid claim'))
    return 'Session expired - please log in again';
  return msg;
}

export function initGlobalErrorLogging() {
  if (initialized) return;
  initialized = true;

  // Catch unhandled JS errors
  window.onerror = (message, source, lineno, colno, error) => {
    const msg = formatErrorMessage(error || message);
    queueError({
      error_message: getHumanReadableMessage(msg),
      stack_trace: error?.stack || `${source}:${lineno}:${colno}`,
      component_name: null,
      route: window.location.pathname,
      source: 'frontend',
    });
  };

  // Catch unhandled promise rejections
  window.onunhandledrejection = (event) => {
    const msg = formatErrorMessage(event.reason);
    queueError({
      error_message: getHumanReadableMessage(msg),
      stack_trace: event.reason?.stack || null,
      component_name: null,
      route: window.location.pathname,
      source: 'frontend',
    });
  };

  // Wrap console.error to capture all logged errors
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    originalConsoleError.apply(console, args);
    
    // Skip React internal warnings and our own logging
    const firstArg = String(args[0] || '');
    if (firstArg.includes('ErrorBoundary') || 
        firstArg.includes('Warning:') ||
        firstArg.includes('Download the React DevTools')) return;

    const msg = args.map(a => formatErrorMessage(a)).join(' ');
    if (msg.length < 5) return; // Skip trivial errors
    
    queueError({
      error_message: getHumanReadableMessage(msg),
      stack_trace: new Error().stack || null,
      component_name: null,
      route: window.location.pathname,
      source: 'frontend',
    });
  };

  // Intercept fetch errors for Supabase calls
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    try {
      const response = await originalFetch(...args);
      
      // Log failed Supabase/edge function requests
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
      if (!response.ok && (url.includes('supabase') || url.includes('functions'))) {
        const isEdgeFunction = url.includes('/functions/');
        try {
          const cloned = response.clone();
          const body = await cloned.text();
          const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
          const errorMsg = parsed?.error || parsed?.message || parsed?.msg || body.slice(0, 500);
          
          if (errorMsg && response.status !== 401) { // Skip auth redirects
            queueError({
              error_message: getHumanReadableMessage(String(errorMsg)),
              stack_trace: `${response.status} ${response.statusText} — ${url}`,
              component_name: isEdgeFunction ? url.split('/functions/')[1]?.split('/')[0] || null : null,
              route: window.location.pathname,
              source: isEdgeFunction ? 'edge_function' : 'database',
            });
          }
        } catch { /* ignore parse failures */ }
      }
      
      return response;
    } catch (err) {
      // Network errors
      queueError({
        error_message: getHumanReadableMessage(formatErrorMessage(err)),
        stack_trace: (err as Error)?.stack || null,
        component_name: null,
        route: window.location.pathname,
        source: 'frontend',
      });
      throw err;
    }
  };
}
