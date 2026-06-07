// v2.0.0 - Shared helper for edge functions to forward errors via log_error_event RPC
// Provides fingerprint-based dedup, occurrence counting, and unified observability.
//
// Usage:
//   import { captureEdgeError } from '../_shared/capture-edge-error.ts'
//   try { ... } catch (e) { await captureEdgeError('my-fn', e, { branch_id }); throw e; }

export interface CaptureContext {
  branch_id?: string | null;
  user_id?: string | null;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  context?: Record<string, unknown> | null;
  request_id?: string | null;
  route?: string | null;
}

export async function captureEdgeError(
  functionName: string,
  error: unknown,
  ctx: CaptureContext = {},
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return;

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
    const stack = error instanceof Error ? error.stack : null;

    // Direct PostgREST RPC call — fast, no SDK overhead, fire-and-forget.
    await fetch(`${supabaseUrl}/rest/v1/rpc/log_error_event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_severity: ctx.severity || 'error',
        p_source: 'edge_function',
        p_message: String(message).slice(0, 2000),
        p_function_name: functionName,
        p_route: ctx.route || `/functions/v1/${functionName}`,
        p_table_name: null,
        p_branch_id: ctx.branch_id || null,
        p_user_id: ctx.user_id || null,
        p_request_id: ctx.request_id || null,
        p_release_sha: Deno.env.get('SUPABASE_DEPLOYMENT_ID') || null,
        p_stack: stack ? String(stack).slice(0, 8000) : null,
        p_context: ctx.context || null,
      }),
    }).catch(() => { /* swallow */ });
  } catch {
    // Never throw from logging
  }
}
