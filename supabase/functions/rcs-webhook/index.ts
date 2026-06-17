// v0.3.0 — Telinfy RCS webhook receiver. Routes by path suffix:
//   POST /rcs-webhook/delivery      → DLR (eventDLR: MESSAGE_DELIVERED | MESSAGE_READ | MESSAGE_UNDELIVERED)
//   POST /rcs-webhook/user-action   → button click (user_action_clicked)
//   POST /rcs-webhook/user-message  → MO inbound text (user_Messaged) → opt-out + AI brain
// Public (no JWT). Identifier from Telinfy is `recordID` — looked up via
// communication_logs.provider_record_id which we populate in send-rcs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { detectOptOut } from '../_shared/optOutDetector.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function mapDlr(eventDLR: string): 'delivered' | 'read' | 'failed' | 'sent' | null {
  const e = String(eventDLR || '').toUpperCase();
  if (e === 'MESSAGE_READ') return 'read';
  if (e === 'MESSAGE_DELIVERED') return 'delivered';
  if (e === 'MESSAGE_UNDELIVERED' || e.includes('FAIL') || e.includes('REJECT')) return 'failed';
  if (e === 'MESSAGE_SENT') return 'sent';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  // Normalize path suffix (strip function prefix + /webhook prefix Telinfy sends).
  const suffix = url.pathname
    .replace(/^.*\/rcs-webhook/i, '')
    .replace(/^\/webhook/i, '')
    .replace(/\/+$/, '')
    .toLowerCase() || '/delivery';

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const events = Array.isArray(body?.events) ? body.events : [body];

  // Audit ingress
  await supabase.from('webhook_ingress_log').insert({
    source: 'telinfy_rcs',
    endpoint: suffix,
    payload: body,
    received_at: new Date().toISOString(),
  }).catch(() => {});

  try {
    if (suffix === '/delivery' || suffix === '') {
      for (const evt of events) {
        const recordId = evt?.recordID ?? evt?.recordId ?? evt?.record_id;
        const mapped = mapDlr(evt?.eventDLR || evt?.status_text || evt?.event);
        if (!recordId || !mapped) continue;

        const { data: log } = await supabase
          .from('communication_logs')
          .select('id')
          .eq('provider_record_id', String(recordId))
          .maybeSingle();
        if (!log?.id) continue;

        await supabase.rpc('record_delivery_event', {
          p_log_id: log.id,
          p_new_status: mapped,
          p_provider: 'telinfy_rcs',
          p_provider_message_id: String(evt?.messageId || recordId),
          p_error: mapped === 'failed' ? (evt?.error || evt?.reason || 'MESSAGE_UNDELIVERED') : null,
          p_metadata: { raw: evt },
        });
      }
      return json(200, { ok: true, kind: 'delivery', count: events.length });
    }

    if (suffix === '/user-action') {
      for (const evt of events) {
        await supabase.from('rcs_inbound_events').insert({
          event_type: 'user_action',
          sender_phone: String(evt?.senderPhoneNumber || ''),
          record_id: evt?.recordID ? String(evt.recordID) : null,
          message_id: evt?.messageId ? String(evt.messageId) : null,
          payload: evt,
        });
      }
      return json(200, { ok: true, kind: 'user_action', count: events.length });
    }

    if (suffix === '/user-message') {
      for (const evt of events) {
        const phone = String(evt?.senderPhoneNumber || '').replace(/\D/g, '');
        const text = String(evt?.user_Messaged || evt?.userMessaged || '');
        await supabase.from('rcs_inbound_events').insert({
          event_type: 'user_message',
          sender_phone: phone,
          record_id: evt?.recordID ? String(evt.recordID) : null,
          message_id: evt?.messageId ? String(evt.messageId) : null,
          payload: evt,
        });

        // Opt-out short-circuit
        const opt = detectOptOut(text);
        if (opt.optOut) {
          await supabase.rpc('mark_do_not_contact', {
            p_phone: phone,
            p_reason: `rcs_inbound:${opt.reason}`,
            p_source: 'rcs',
          }).catch(() => {});
          continue;
        }

        // Best-effort: hand off to AI brain (non-blocking).
        try {
          await supabase.functions.invoke('ai-agent-brain', {
            body: { channel: 'rcs', phone, text, source: 'telinfy_rcs' },
          });
        } catch (e) { console.warn('[rcs-webhook] brain handoff failed', e); }
      }
      return json(200, { ok: true, kind: 'user_message', count: events.length });
    }

    return json(200, { ok: true, kind: 'unknown', suffix });
  } catch (e) {
    console.error('[rcs-webhook] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
