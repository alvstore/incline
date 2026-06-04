// v0.1.0 — Telinfy / GreenAds Global RCS DLR (delivery receipt) receiver.
// Telinfy POSTs `{ message_id, status, to, timestamp, error }` to this URL.
// Public endpoint (no JWT). Updates communication_logs.delivery_status.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const events = Array.isArray(body?.events) ? body.events : [body];

    for (const evt of events) {
      const providerId = evt?.message_id || evt?.id || evt?.data?.message_id;
      const rawStatus = String(evt?.status || evt?.event || '').toLowerCase();
      if (!providerId) continue;

      const mapped =
        rawStatus.includes('deliver') ? 'delivered' :
        rawStatus.includes('read') ? 'read' :
        rawStatus.includes('fail') || rawStatus.includes('reject') ? 'failed' :
        rawStatus.includes('sent') ? 'sent' : rawStatus || 'unknown';

      const patch: Record<string, unknown> = { delivery_status: mapped };
      if (mapped === 'delivered') patch.delivered_at = new Date().toISOString();
      if (mapped === 'read') patch.read_at = new Date().toISOString();
      if (mapped === 'failed') patch.error_message = evt?.error || evt?.reason || 'provider_failed';

      await supabase.from('communication_logs')
        .update(patch)
        .eq('provider_message_id', String(providerId));
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[rcs-webhook] error', e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
