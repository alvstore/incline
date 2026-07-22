// v1.0.0 — Unified RCS provider adapter (Telinfy + Smartping).
// Used by send-rcs, rcs-webhook, rcs-templates-sync, rcs-record.
// Provider is resolved from integration_settings; falls back to env.
//
// Adapter contract:
//   send({recipient, template_id, template_name, variables, log_id, message?})
//     → { status: 'sent'|'failed'|'unsupported'|'not_configured'|'disabled',
//         provider_message_id?, provider_record_id?, reason?, raw? }
//   syncTemplates(branch_id) → { count, upserted, endpoint?, reason? }
//   mapDlr(event) → { logSelector: {by:'record_id'|'log_id'|'provider_message_id', value:string},
//                     status: 'sent'|'delivered'|'read'|'failed'|null,
//                     provider_message_id?: string, error?: string }
//   fetchRecord(record_id) → { ok, data?|reason }
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type RcsProviderName = 'telinfy' | 'smartping';

export interface ResolvedProvider {
  provider: RcsProviderName;
  base_url: string;
  credentials: Record<string, any>;
  is_active: boolean;
}

export interface SendPayload {
  recipient: string;
  template_id?: string | null;   // Smartping uses UUID templateId
  template_name?: string | null; // Telinfy uses name
  variables?: Record<string, any> | any[];
  message?: string;
  log_id?: string;
  components?: any;              // optional raw override
}

export interface SendResult {
  status: 'sent' | 'failed' | 'unsupported' | 'not_configured' | 'disabled';
  provider: RcsProviderName;
  provider_message_id?: string | null;
  provider_record_id?: string | null;
  reason?: string;
  raw?: any;
}

const SMARTPING_DEFAULT_BASE = 'https://rcsapi.rcscloud.smartping.io';
const TELINFY_DEFAULT_BASE = 'https://hub.telinfy.com/unified/developer/api/v1';

function digitsOnly(s: string): string { return String(s || '').replace(/\D/g, ''); }

// -------------------- Resolver --------------------
export async function resolveRcsProvider(
  supabase: SupabaseClient,
  branch_id: string | null,
  preferred?: RcsProviderName,
): Promise<ResolvedProvider> {
  // Try DB rows first: branch-specific then global. Prefer preferred provider, else is_active.
  const { data: rows } = await supabase
    .from('integration_settings')
    .select('provider, config, credentials, is_active, branch_id')
    .eq('integration_type', 'rcs')
    .in('branch_id', branch_id ? [branch_id, null] : [null])
    .order('branch_id', { ascending: false, nullsFirst: false });

  const list = (rows || []) as any[];
  let picked: any = null;
  if (preferred) picked = list.find((r) => r.provider === preferred);
  if (!picked) picked = list.find((r) => r.is_active !== false) || list[0] || null;

  if (picked) {
    const provider = (picked.provider as RcsProviderName) || 'telinfy';
    const base_url = String(
      picked.config?.base_url ||
        (provider === 'smartping' ? SMARTPING_DEFAULT_BASE : TELINFY_DEFAULT_BASE),
    ).replace(/\/+$/, '');
    return {
      provider,
      base_url,
      credentials: picked.credentials || {},
      is_active: picked.is_active !== false,
    };
  }

  // Fallback: env-only. Prefer Smartping if creds present, else Telinfy.
  const spUser = Deno.env.get('SMARTPING_RCS_USER_ID');
  const spKey = Deno.env.get('SMARTPING_RCS_API_KEY');
  if ((preferred === 'smartping' || !preferred) && spUser && spKey) {
    return {
      provider: 'smartping',
      base_url: SMARTPING_DEFAULT_BASE,
      credentials: { user_id: spUser, api_key: spKey },
      is_active: true,
    };
  }
  return {
    provider: 'telinfy',
    base_url: TELINFY_DEFAULT_BASE,
    credentials: { api_key: Deno.env.get('TELINFY_API_KEY') || '' },
    is_active: true,
  };
}

// -------------------- Smartping token cache --------------------
async function getSmartpingToken(
  supabase: SupabaseClient,
  cfg: ResolvedProvider,
  forceRefresh = false,
): Promise<string | null> {
  const userId = cfg.credentials?.user_id || Deno.env.get('SMARTPING_RCS_USER_ID');
  const apiKey = cfg.credentials?.api_key || Deno.env.get('SMARTPING_RCS_API_KEY');
  if (!userId || !apiKey) return null;

  const cacheKey = `smartping_rcs_token:${userId}`;
  if (!forceRefresh) {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .is('branch_id', null)
      .eq('key', cacheKey)
      .maybeSingle();
    const cached = (data as any)?.value;
    if (cached?.token && cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
      return String(cached.token);
    }
  }

  const url = `${cfg.base_url}/rcs/api/user/authorize`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, apiKey }),
  });
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
  if (!resp.ok) {
    console.error('[smartping] authorize failed', resp.status, text?.slice(0, 300));
    return null;
  }
  const token =
    parsed?.token || parsed?.authorization || parsed?.jwt ||
    parsed?.data?.token || parsed?.data?.authorization ||
    resp.headers.get('authorization') || resp.headers.get('Authorization');
  if (!token) {
    console.error('[smartping] no token in response', text?.slice(0, 300));
    return null;
  }
  const clean = String(token).replace(/^Bearer\s+/i, '');
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  await supabase.from('settings').upsert({
    branch_id: null,
    key: cacheKey,
    value: { token: clean, expires_at: expiresAt },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id,key' });
  return clean;
}

// -------------------- Adapters --------------------
function varArray(vars: any): string[] {
  if (Array.isArray(vars)) return vars.map(String);
  if (vars && typeof vars === 'object') return Object.values(vars).map((v) => String(v ?? ''));
  return [];
}

async function smartpingSend(
  supabase: SupabaseClient,
  cfg: ResolvedProvider,
  p: SendPayload,
): Promise<SendResult> {
  if (!p.template_id && !p.template_name) {
    return { status: 'unsupported', provider: 'smartping', reason: 'rcs_requires_template' };
  }
  let token = await getSmartpingToken(supabase, cfg);
  if (!token) return { status: 'not_configured', provider: 'smartping', reason: 'Smartping token unavailable (check credentials + IP whitelist)' };

  const params = varArray(p.variables);

  // Build components: caller-provided > template.kind-derived > flat messageText fallback.
  let components: Record<string, unknown> | undefined = p.components as any;
  if (!components && p.template_id) {
    try {
      const { data: tmpl } = await supabase
        .from('rcs_templates')
        .select('kind, body_preview, config')
        .eq('external_template_id', p.template_id)
        .maybeSingle();
      const kind = String((tmpl as any)?.kind || 'basic_standard');
      const cfgRow = ((tmpl as any)?.config || {}) as Record<string, any>;
      if (kind.startsWith('rich') && !kind.includes('carousel')) {
        // Rich card: title (messageText) + body (messageDescription) + CTAs
        const desc = cfgRow.description_params || params;
        components = {
          richCard: [
            { type: 'messageText', parameters: cfgRow.title_params || params },
            { type: 'messageDescription', parameters: desc },
            ...(cfgRow.cta_url_params ? [{ type: 'dynamicSuggestionURL', parameters: cfgRow.cta_url_params }] : []),
            ...(cfgRow.cta_dial_params ? [{ type: 'dialerAction', parameters: cfgRow.cta_dial_params }] : []),
          ],
        };
      } else if (kind.includes('carousel')) {
        const cards = Array.isArray(cfgRow.cards) ? cfgRow.cards : [];
        components = {
          carouselCard: cards.map((c: any) => [
            { type: 'title', parameters: c.title_params || [] },
            { type: 'description', parameters: c.description_params || [] },
            ...(c.cta_url_params ? [{ type: 'dynamicSuggestionURL', parameters: c.cta_url_params }] : []),
            ...(c.cta_dial_params ? [{ type: 'dialerAction', parameters: c.cta_dial_params }] : []),
          ]),
        };
      }
    } catch (e) {
      console.warn('[smartping] template kind lookup failed', e);
    }
  }
  if (!components) components = { standard: [{ type: 'messageText', parameters: params }] };

  const body = {
    messages: [{
      templateId: p.template_id, // Smartping requires UUID; if only name given caller must resolve first
      to: digitsOnly(p.recipient),
      customOne: p.log_id || undefined,
      components,
    }],
  };


  const url = `${cfg.base_url}/rcs/api/message/send`;
  const doSend = async (auth: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth },
      body: JSON.stringify(body),
    });

  let resp = await doSend(token);
  if (resp.status === 401) {
    // refresh once
    token = await getSmartpingToken(supabase, cfg, true) || token;
    resp = await doSend(token);
  }
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
  if (!resp.ok) {
    return {
      status: 'failed',
      provider: 'smartping',
      reason: parsed?.message || parsed?.error || `HTTP ${resp.status}`,
      raw: parsed || text?.slice(0, 500),
    };
  }
  const first = Array.isArray(parsed?.messages) ? parsed.messages[0] : parsed?.data?.[0] || parsed;
  const msgId = first?.messageId || first?.message_id || first?.msgId || parsed?.messageId || null;
  const recordId = first?.recordId || first?.recordID || first?.record_id || null;
  return {
    status: 'sent',
    provider: 'smartping',
    provider_message_id: msgId ? String(msgId) : null,
    provider_record_id: recordId ? String(recordId) : null,
    raw: parsed,
  };
}

async function telinfySend(
  _supabase: SupabaseClient,
  cfg: ResolvedProvider,
  p: SendPayload,
): Promise<SendResult> {
  const apiKey = cfg.credentials?.api_key || Deno.env.get('TELINFY_API_KEY') || '';
  if (!apiKey) return { status: 'not_configured', provider: 'telinfy', reason: 'TELINFY_API_KEY missing' };
  if (!p.template_name) {
    return { status: 'unsupported', provider: 'telinfy', reason: 'rcs_requires_template' };
  }
  const contactId = digitsOnly(p.recipient);
  const messageId = p.log_id ? String(p.log_id) : crypto.randomUUID();
  const url = `${cfg.base_url}/rcs/messages/${encodeURIComponent(contactId)}?messageId=${encodeURIComponent(messageId)}`;
  const payload = { templateName: p.template_name, lcustomParam: p.variables || {} };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep */ }
  if (!resp.ok) {
    return {
      status: 'failed',
      provider: 'telinfy',
      reason: parsed?.message || parsed?.error || `HTTP ${resp.status}`,
      raw: parsed || text?.slice(0, 500),
    };
  }
  const recordId =
    parsed?.recordID || parsed?.recordId || parsed?.record_id ||
    parsed?.data?.recordID || parsed?.data?.recordId || null;
  const providerMessageId = parsed?.messageId || parsed?.message_id || messageId;
  return {
    status: 'sent',
    provider: 'telinfy',
    provider_message_id: String(providerMessageId),
    provider_record_id: recordId ? String(recordId) : null,
    raw: parsed,
  };
}

// -------------------- Public entrypoints --------------------
export async function sendRcs(
  supabase: SupabaseClient,
  branch_id: string | null,
  payload: SendPayload,
  providerHint?: RcsProviderName,
): Promise<SendResult> {
  const cfg = await resolveRcsProvider(supabase, branch_id, providerHint);
  if (!cfg.is_active) return { status: 'disabled', provider: cfg.provider, reason: `${cfg.provider} integration disabled` };
  if (cfg.provider === 'smartping') return smartpingSend(supabase, cfg, payload);
  return telinfySend(supabase, cfg, payload);
}

// -------------------- DLR mapping --------------------
export interface DlrMapped {
  status: 'sent' | 'delivered' | 'read' | 'failed' | null;
  provider_message_id?: string | null;
  error?: string | null;
  selector: { by: 'record_id' | 'log_id' | 'provider_message_id'; value: string } | null;
}

export function mapTelinfyDlr(evt: any): DlrMapped {
  const e = String(evt?.eventDLR || evt?.status_text || evt?.event || '').toUpperCase();
  let status: DlrMapped['status'] = null;
  if (e === 'MESSAGE_READ') status = 'read';
  else if (e === 'MESSAGE_DELIVERED') status = 'delivered';
  else if (e === 'MESSAGE_UNDELIVERED' || e.includes('FAIL') || e.includes('REJECT')) status = 'failed';
  else if (e === 'MESSAGE_SENT') status = 'sent';
  const recordId = evt?.recordID ?? evt?.recordId ?? evt?.record_id;
  return {
    status,
    provider_message_id: evt?.messageId ? String(evt.messageId) : (recordId ? String(recordId) : null),
    error: status === 'failed' ? (evt?.error || evt?.reason || 'MESSAGE_UNDELIVERED') : null,
    selector: recordId ? { by: 'record_id', value: String(recordId) } : null,
  };
}

export function mapSmartpingDlr(evt: any): DlrMapped {
  const raw = String(evt?.status || evt?.dlr || evt?.event || evt?.eventType || '').toUpperCase();
  let status: DlrMapped['status'] = null;
  if (raw.includes('READ')) status = 'read';
  else if (raw.includes('DELIVER')) status = 'delivered';
  else if (raw.includes('FAIL') || raw.includes('REJECT') || raw.includes('UNDELIVER') || raw.includes('EXPIR')) status = 'failed';
  else if (raw.includes('SENT') || raw.includes('SUBMIT')) status = 'sent';
  const logId = evt?.customOne || evt?.correlationId || null;
  const messageId = evt?.messageId || evt?.message_id || evt?.msgId || null;
  let selector: DlrMapped['selector'] = null;
  if (logId) selector = { by: 'log_id', value: String(logId) };
  else if (messageId) selector = { by: 'provider_message_id', value: String(messageId) };
  return {
    status,
    provider_message_id: messageId ? String(messageId) : null,
    error: status === 'failed' ? (evt?.error || evt?.reason || raw || 'FAILED') : null,
    selector,
  };
}
