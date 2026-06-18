// v0.3.0 — Telinfy RCS dispatcher (aligned with hub.telinfy.com Postman collection).
// Endpoint:  POST {base}/rcs/messages/{contactID}?messageId={custom}
// Auth:      x-api-key: <TELINFY_API_KEY>
// Body:      { templateName, lcustomParam: { ...vars } }
// Note:      Telinfy RCS is template-driven. Freeform text is unsupported by this API;
//            in that case we return status='unsupported' and the dispatcher should fall back to SMS.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ENV_API_KEY = Deno.env.get('TELINFY_API_KEY') || '';
const ENV_BASE_URL = (Deno.env.get('TELINFY_BASE_URL') || 'https://hub.telinfy.com/unified/developer/api/v1').replace(/\/+$/, '');

function normalizeTo(to: string): string {
  // Telinfy expects digits-only with country code (e.g. 919887601200).
  return String(to || '').replace(/\D/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const { branch_id, recipient, template_name, variables, message, log_id } = body ?? {};
    if (!recipient) return json(400, { status: 'failed', reason: 'missing recipient' });

    const resolvedTemplate = template_name || null;
    if (!resolvedTemplate) {
      // Telinfy RCS REST has no freeform endpoint — surface unsupported so dispatcher falls back.
      return json(200, { status: 'unsupported', reason: 'rcs_requires_template', detail: 'Telinfy RCS only supports template sends; supply template_name + variables or fall back to SMS.' });
    }

    // Resolve creds: per-branch DB row > global DB row > env. Use saved key even if toggle is off,
    // but short-circuit outbound sends when the integration is explicitly disabled.
    let apiKey = ENV_API_KEY;
    let baseUrl = ENV_BASE_URL;
    let isActive: boolean | null = null;
    const { data: cfgRow } = await supabase
      .from('integration_settings')
      .select('config, credentials, is_active')
      .eq('integration_type', 'rcs')
      .eq('provider', 'telinfy')
      .in('branch_id', branch_id ? [branch_id, null] : [null])
      .order('branch_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (cfgRow) {
      isActive = !!(cfgRow as any).is_active;
      const dbKey = (cfgRow as any).credentials?.api_key;
      if (dbKey) apiKey = dbKey;
      const dbBase = (cfgRow as any).config?.base_url;
      if (dbBase) baseUrl = String(dbBase).replace(/\/+$/, '');
    }
    if (!apiKey) return json(200, { status: 'not_configured', reason: 'TELINFY_API_KEY missing' });
    if (isActive === false) return json(200, { status: 'disabled', reason: 'Telinfy integration is disabled' });

    const contactId = normalizeTo(recipient);
    const messageId = log_id ? String(log_id) : crypto.randomUUID();
    const url = `${baseUrl}/rcs/messages/${encodeURIComponent(contactId)}?messageId=${encodeURIComponent(messageId)}`;
    const payload = {
      templateName: resolvedTemplate,
      lcustomParam: variables || {},
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
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

    const recordId =
      respJson?.recordID || respJson?.recordId || respJson?.record_id ||
      respJson?.data?.recordID || respJson?.data?.recordId || null;
    const providerMessageId = respJson?.messageId || respJson?.message_id || messageId;

    console.log(`[send-rcs] sent to=${contactId} recordID=${recordId} messageId=${providerMessageId}`);

    if (log_id) {
      await supabase.from('communication_logs')
        .update({
          provider_message_id: String(providerMessageId),
          provider_record_id: recordId ? String(recordId) : null,
          delivery_status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', log_id);
    }

    return json(200, {
      status: 'sent',
      provider: 'telinfy_rcs',
      provider_message_id: String(providerMessageId),
      provider_record_id: recordId ? String(recordId) : null,
      raw: respJson,
    });
  } catch (e) {
    console.error('[send-rcs] error', e);
    return json(500, { status: 'failed', reason: e instanceof Error ? e.message : String(e) });
  }
});
