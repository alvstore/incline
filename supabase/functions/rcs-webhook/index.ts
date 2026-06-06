// v0.2.0 — Telinfy / GreenAds Global RCS DLR (delivery receipt) receiver.
// Public endpoint (no JWT). Routes every callback through `record_delivery_event`
// so the Live Feed rail advances correctly (Queued → Sent → Delivered → Read).
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
        rawStatus.includes('read')    ? 'read' :
        rawStatus.includes('fail') || rawStatus.includes('reject') ? 'failed' :
        rawStatus.includes('sent')    ? 'sent' : null;
      if (!mapped) continue;

      const { data: log } = await supabase
        .from('communication_logs')
        .select('id')
        .eq('provider_message_id', String(providerId))
        .maybeSingle();
      if (!log?.id) continue;

      await supabase.rpc('record_delivery_event', {
        p_log_id: log.id,
        p_new_status: mapped,
        p_provider: 'telinfy_rcs',
        p_provider_message_id: String(providerId),
        p_error: mapped === 'failed' ? (evt?.error || evt?.reason || 'provider_failed') : null,
        p_metadata: { raw: evt },
      });
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
