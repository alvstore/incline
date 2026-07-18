// v0.4.0 — Unified RCS webhook. Path shapes accepted:
//   Legacy (Telinfy):    POST /rcs-webhook/delivery | /user-action | /user-message
//   Provider-scoped:     POST /rcs-webhook/{telinfy|smartping}/delivery | /user-action | /user-message
// Public (no JWT). All ingress audited to webhook_ingress_log.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { detectOptOut } from '../_shared/optOutDetector.ts';
import { mapTelinfyDlr, mapSmartpingDlr, type RcsProviderName } from '../_shared/rcsProviders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);
  // Parse suffix: /rcs-webhook[/webhook][/{provider}][/{event}]
  const raw = url.pathname.replace(/^.*\/rcs-webhook/i, '').replace(/^\/webhook/i, '').toLowerCase();
  const parts = raw.split('/').filter(Boolean);
  let provider: RcsProviderName = 'telinfy';
  let event = 'delivery';
  if (parts.length === 0) { /* defaults */ }
  else if (parts.length === 1) { event = parts[0]; }
  else {
    if (parts[0] === 'telinfy' || parts[0] === 'smartping') {
      provider = parts[0] as RcsProviderName; event = parts[1] || 'delivery';
    } else { event = parts[parts.length - 1]; }
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const events = Array.isArray(body?.events) ? body.events : Array.isArray(body?.messages) ? body.messages : [body];

  await supabase.from('webhook_ingress_log').insert({
    source: `${provider}_rcs`,
    endpoint: `/${provider}/${event}`,
    payload: body,
    received_at: new Date().toISOString(),
  }).catch(() => {});

  try {
    if (event === 'delivery' || event === '') {
      for (const evt of events) {
        const mapped = provider === 'smartping' ? mapSmartpingDlr(evt) : mapTelinfyDlr(evt);
        if (!mapped.status || !mapped.selector) continue;

        // Resolve communication_logs.id from selector
        let logId: string | null = null;
        if (mapped.selector.by === 'log_id') {
          logId = mapped.selector.value;
        } else if (mapped.selector.by === 'record_id') {
          const { data } = await supabase.from('communication_logs').select('id')
            .eq('provider_record_id', mapped.selector.value).maybeSingle();
          logId = (data as any)?.id || null;
        } else if (mapped.selector.by === 'provider_message_id') {
          const { data } = await supabase.from('communication_logs').select('id')
            .eq('provider_message_id', mapped.selector.value).maybeSingle();
          logId = (data as any)?.id || null;
        }
        if (!logId) continue;

        await supabase.rpc('record_delivery_event', {
          p_log_id: logId,
          p_new_status: mapped.status,
          p_provider: `${provider}_rcs`,
          p_provider_message_id: mapped.provider_message_id || null,
          p_error: mapped.error || null,
          p_metadata: { raw: evt },
        });
      }
      return json(200, { ok: true, provider, kind: 'delivery', count: events.length });
    }

    if (event === 'user-action') {
      for (const evt of events) {
        await supabase.from('rcs_inbound_events').insert({
          event_type: 'user_action',
          sender_phone: String(evt?.senderPhoneNumber || evt?.msisdn || evt?.to || ''),
          record_id: evt?.recordID ? String(evt.recordID) : (evt?.customOne ? String(evt.customOne) : null),
          message_id: evt?.messageId ? String(evt.messageId) : null,
          payload: evt,
        });
      }
      return json(200, { ok: true, provider, kind: 'user_action', count: events.length });
    }

    if (event === 'user-message') {
      for (const evt of events) {
        const phone = String(evt?.senderPhoneNumber || evt?.msisdn || evt?.from || '').replace(/\D/g, '');
        const text = String(evt?.user_Messaged || evt?.userMessaged || evt?.text || evt?.message || '');
        await supabase.from('rcs_inbound_events').insert({
          event_type: 'user_message',
          sender_phone: phone,
          record_id: evt?.recordID ? String(evt.recordID) : (evt?.customOne ? String(evt.customOne) : null),
          message_id: evt?.messageId ? String(evt.messageId) : null,
          payload: evt,
        });
        const opt = detectOptOut(text);
        if (opt.optOut) {
          await supabase.rpc('mark_do_not_contact', {
            p_phone: phone, p_reason: `rcs_inbound:${opt.reason}`, p_source: 'rcs',
          }).catch(() => {});
          continue;
        }
        try {
          await supabase.functions.invoke('ai-agent-brain', {
            body: { channel: 'rcs', phone, text, source: `${provider}_rcs` },
          });
        } catch (e) { console.warn('[rcs-webhook] brain handoff failed', e); }
      }
      return json(200, { ok: true, provider, kind: 'user_message', count: events.length });
    }

    return json(200, { ok: true, provider, kind: 'unknown', event });
  } catch (e) {
    console.error('[rcs-webhook] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
