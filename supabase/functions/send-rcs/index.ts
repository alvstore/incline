// v0.2.0 — RCS dispatcher (Telinfy / GreenAds Global).
// Wired into the universal dispatcher. Sends text/card via Telinfy REST API
// using TELINFY_API_KEY (bearer) + TELINFY_SENDER_ID + TELINFY_BASE_URL secrets.
// Falls back to integration_settings(provider='telinfy',integration_type='rcs')
// for per-branch overrides. DLR webhook receiver lives in rcs-webhook/.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ENV_API_KEY = Deno.env.get('TELINFY_API_KEY') || '';
const ENV_SENDER = Deno.env.get('TELINFY_SENDER_ID') || '';
const ENV_BASE_URL = (Deno.env.get('TELINFY_BASE_URL') || '').replace(/\/+$/, '');

function normalizeTo(to: string): string {
  // Telinfy expects E.164 without +. Strip non-digits, leading 91 stays.
  const digits = String(to || '').replace(/\D/g, '');
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { branch_id, recipient, message, log_id, kind } = body ?? {};
    if (!recipient || !message) {
      return json(400, { status: 'failed', reason: 'missing recipient/message' });
    }

    // Resolve creds: per-branch DB row > global DB row > env vars.
    let apiKey = ENV_API_KEY;
    let senderId = ENV_SENDER;
    let baseUrl = ENV_BASE_URL;

    const { data: cfgRow } = await supabase
      .from('integration_settings')
      .select('config, credentials, is_active')
      .eq('integration_type', 'rcs')
      .eq('provider', 'telinfy')
      .in('branch_id', branch_id ? [branch_id, null] : [null])
      .order('branch_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (cfgRow?.is_active) {
      apiKey = (cfgRow as any).credentials?.api_key || apiKey;
      senderId = (cfgRow as any).config?.sender_id || senderId;
      baseUrl = ((cfgRow as any).config?.base_url || baseUrl || '').replace(/\/+$/, '');
    }

    if (!apiKey || !baseUrl) {
      return json(200, { status: 'not_configured', reason: 'TELINFY_API_KEY or TELINFY_BASE_URL missing' });
    }

    const endpoint = kind === 'card' ? '/rcs/send/card' : '/rcs/send/text';
    const payload: Record<string, unknown> = {
      sender: senderId || undefined,
      to: normalizeTo(recipient),
      message: kind === 'card' ? undefined : String(message),
      card: kind === 'card' ? message : undefined,
    };

    const resp = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const respText = await resp.text();
    let respJson: any = null;
    try { respJson = JSON.parse(respText); } catch { /* keep text */ }

    if (!resp.ok) {
      console.error(`[send-rcs] HTTP ${resp.status} for ${recipient}: ${respText}`);
      return json(200, {
        status: 'failed',
        reason: respJson?.message || respJson?.error || `HTTP ${resp.status}`,
        provider_response: respJson || respText,
      });
    }

    const providerMessageId = respJson?.message_id || respJson?.data?.message_id || respJson?.id || null;
    console.log(`[send-rcs] sent to=${recipient} provider_id=${providerMessageId}`);

    // Update communication log if caller provided one.
    if (log_id) {
      await supabase.from('communication_logs')
        .update({
          provider_message_id: providerMessageId,
          delivery_status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', log_id);
    }

    return json(200, {
      status: 'sent',
      provider: 'telinfy',
      provider_message_id: providerMessageId,
    });
  } catch (e) {
    console.error('send-rcs error', e);
    return json(500, { status: 'failed', reason: e instanceof Error ? e.message : String(e) });
  }
});
