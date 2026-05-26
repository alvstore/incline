// v1.1.0 - Auth-gated error ingestion (service-role bearer or LOG_INGEST_SECRET)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const ALLOWED_SEVERITIES = new Set(['debug', 'info', 'warn', 'error', 'critical']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Auth gate: require service-role bearer or LOG_INGEST_SECRET ---
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const ingestSecret = Deno.env.get('LOG_INGEST_SECRET') || '';
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const authorized =
    (serviceRoleKey && token === serviceRoleKey) ||
    (ingestSecret && token === ingestSecret);

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceRoleKey,
    );

    const body = await req.json().catch(() => ({}));
    const {
      function_name,
      error_message,
      stack_trace,
      severity = 'error',
      context = null,
      branch_id = null,
      user_id = null,
    } = body || {};

    if (!function_name || !error_message) {
      return new Response(
        JSON.stringify({ error: 'function_name and error_message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const safeSeverity = ALLOWED_SEVERITIES.has(String(severity)) ? String(severity) : 'error';

    const { error } = await (supabase.from('error_logs') as any).insert({
      source: 'edge_function',
      route: `/functions/v1/${String(function_name).slice(0, 200)}`,
      error_message: String(error_message).slice(0, 2000),
      stack_trace: stack_trace ? String(stack_trace).slice(0, 8000) : null,
      severity: safeSeverity,
      context,
      branch_id,
      user_id,
      status: 'open',
    });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('log-edge-error failed:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
