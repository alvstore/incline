// v1.0.0 — RoundSMS DLR receiver.
// Public endpoint (no JWT). Configure RoundSMS DLR URL to point here:
//   https://<project>.functions.supabase.co/sms-webhook
// RoundSMS callback fields (typical):
//   { batch_id|message_id, status (DELIVRD/UNDELIV/REJECTD/EXPIRED/...), to,
//     err, datetime }
// Routes every callback through `record_delivery_event` so the Live Feed rail
// advances Queued → Sent → Delivered. SMS has no "read" — UI shows it as N/A.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function mapDlrStatus(s: string): string | null {
  const v = s.toUpperCase();
  if (['DELIVRD', 'DELIVERED', 'DELIVERY', 'SUCCESS', 'OK'].includes(v)) return 'delivered';
  if (['SENT', 'ACCEPTD', 'ENROUTE'].includes(v)) return 'sent';
  if (['UNDELIV', 'REJECTD', 'EXPIRED', 'FAILED', 'UNKNOWN', 'DELETED'].includes(v)) return 'failed';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // RoundSMS posts form-encoded OR JSON; also support GET query.
    let evt: Record<string, any> = {};
    if (req.method === 'GET') {
      const u = new URL(req.url);
      u.searchParams.forEach((v, k) => { evt[k] = v; });
    } else {
      const ct = req.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        evt = await req.json().catch(() => ({}));
      } else {
        const txt = await req.text();
        const params = new URLSearchParams(txt);
        params.forEach((v, k) => { evt[k] = v; });
      }
    }

    const providerId =
      evt.batch_id || evt.message_id || evt.msg_id || evt.id || evt.MessageID;
    const rawStatus = String(evt.status || evt.Status || evt.dlrstatus || '');
    const mapped = mapDlrStatus(rawStatus);

    if (!providerId || !mapped) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no provider_id or unmapped status' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: log } = await supabase
      .from('communication_logs')
      .select('id')
      .eq('provider_message_id', String(providerId))
      .maybeSingle();
    if (!log?.id) {
      console.log(`[sms-webhook] no log for provider_message_id=${providerId}`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.rpc('record_delivery_event', {
      p_log_id: log.id,
      p_new_status: mapped,
      p_provider: 'roundsms',
      p_provider_message_id: String(providerId),
      p_error: mapped === 'failed' ? (evt.err || evt.error || rawStatus) : null,
      p_metadata: { dlr_status: rawStatus, raw: evt },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[sms-webhook] error', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
