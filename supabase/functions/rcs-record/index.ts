// v1.0.0 — Fetch Telinfy RCS per-record detail (delivery timeline).
//   POST /rcs-record { branch_id?: string, record_id: string|number }
// Mirrors rcs-wallet shape: resolves Telinfy creds from integration_settings.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ENV_API_KEY = Deno.env.get('TELINFY_API_KEY') || '';
const ENV_BASE = (Deno.env.get('TELINFY_BASE_URL') || 'https://hub.telinfy.com/unified/developer/api/v1').replace(/\/+$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = body?.branch_id || null;
    const recordId = body?.record_id;
    if (!recordId) return json(400, { ok: false, reason: 'record_id required' });

    let apiKey = ENV_API_KEY;
    let baseUrl = ENV_BASE;
    const { data: cfg } = await supabase
      .from('integration_settings')
      .select('config, credentials, is_active')
      .eq('integration_type', 'rcs').eq('provider', 'telinfy')
      .in('branch_id', branchId ? [branchId, null] : [null])
      .order('branch_id', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    if (cfg) {
      const dbKey = (cfg as any).credentials?.api_key;
      if (dbKey) apiKey = dbKey;
      const dbBase = (cfg as any).config?.base_url;
      if (dbBase) baseUrl = String(dbBase).replace(/\/+$/, '');
      if ((cfg as any).is_active === false) return json(200, { ok: false, reason: 'Telinfy integration disabled' });
    }
    if (!apiKey) return json(200, { ok: false, reason: 'TELINFY_API_KEY missing' });

    const url = `${baseUrl}/rcs/record/${encodeURIComponent(String(recordId))}`;
    const resp = await fetch(url, { method: 'GET', headers: { 'x-api-key': apiKey, 'Accept': 'application/json' } });
    const text = await resp.text();
    let data: any = null; try { data = JSON.parse(text); } catch { /* keep */ }
    if (!resp.ok) {
      return json(200, { ok: false, reason: `HTTP ${resp.status}`, detail: data ?? text?.slice(0, 300), endpoint: url });
    }
    return json(200, { ok: true, data, endpoint: url });
  } catch (e) {
    console.error('[rcs-record] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
