// v1.0.0 — Resend email webhook receiver.
// Public endpoint (no JWT). Configure in the Resend dashboard:
//   URL: https://<project>.functions.supabase.co/email-webhook
//   Events: email.sent, email.delivered, email.opened, email.clicked,
//           email.bounced, email.complained, email.delivery_delayed
// Routes every event through `record_delivery_event` so the Live Feed rail
// advances Queued → Sent → Delivered → Read (open) for emails.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function mapResendEvent(t: string): string | null {
  switch (t) {
    case 'email.sent':            return 'sent';
    case 'email.delivered':       return 'delivered';
    case 'email.opened':          return 'read';
    case 'email.clicked':         return 'clicked';
    case 'email.bounced':         return 'bounced';
    case 'email.complained':      return 'bounced';
    case 'email.delivery_delayed': return null; // keep as 'sent', metadata only
    case 'email.failed':          return 'failed';
    default:                      return null;
  }
}


async function verifySvix(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigHeader = req.headers.get('svix-signature');
  if (!secret || !id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try { keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0)); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sigHeader.split(' ').some((part) => part.split(',')[1] === expected);
}

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

    // v1.1.0 — Verify the provider (Svix) signature; fail closed when missing/invalid.
    const rawBody = await req.text();
    if (!(await verifySvix(req, rawBody))) {
      return new Response(JSON.stringify({ error: 'invalid_signature' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const payload = (() => { try { return JSON.parse(rawBody); } catch { return {}; } })();
    // Resend posts one event per request: { type, created_at, data: { email_id, to, ... } }
    const events = Array.isArray(payload?.events) ? payload.events : [payload];

    for (const evt of events) {
      const type = String(evt?.type || '').toLowerCase();
      const mapped = mapResendEvent(type);
      if (!mapped) continue;

      const providerId =
        evt?.data?.email_id ||
        evt?.data?.id ||
        evt?.data?.message_id ||
        evt?.email_id ||
        evt?.id;
      if (!providerId) continue;

      const { data: log } = await supabase
        .from('communication_logs')
        .select('id')
        .eq('provider_message_id', String(providerId))
        .maybeSingle();
      if (!log?.id) {
        console.log(`[email-webhook] no log for provider_message_id=${providerId}`);
        continue;
      }

      const err =
        mapped === 'bounced' || mapped === 'failed'
          ? evt?.data?.reason || evt?.data?.bounce?.message || type
          : null;

      await supabase.rpc('record_delivery_event', {
        p_log_id: log.id,
        p_new_status: mapped,
        p_provider: 'resend',
        p_provider_message_id: String(providerId),
        p_error: err,
        p_metadata: { resend_event: type, raw: evt?.data ?? evt },
      });

      // Mirror WhatsApp/RCS pattern: hard bounces & complaints suppress the address
      if (type === 'email.bounced' || type === 'email.complained') {
        const recipient =
          (Array.isArray(evt?.data?.to) ? evt.data.to[0] : evt?.data?.to) ||
          evt?.data?.recipient || null;
        if (recipient) {
          await supabase.from('suppressed_emails').upsert({
            email: String(recipient).toLowerCase(),
            reason: type === 'email.complained' ? 'complaint' : 'bounce',
            metadata: { resend_event: type, bounce: evt?.data?.bounce ?? null, at: new Date().toISOString() },
          }, { onConflict: 'email' });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[email-webhook] error', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
