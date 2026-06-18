// v1.1.0 — Fetch Telinfy RCS wallet balance with path fallback + verbose diagnostics.
//   POST /rcs-wallet { branch_id?: string }
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

// Candidate paths — Telinfy's RCS wallet endpoint location varies by tenant. Try common ones.
const CANDIDATE_PATHS = [
  '/rcs/wallet',
  '/rcs/wallet/balance',
  '/wallet',
  '/wallet/balance',
  '/account/wallet',
  '/sms/wallet',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = body?.branch_id || null;

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
    }
    if (!apiKey) return json(200, { ok: false, reason: 'TELINFY_API_KEY missing' });

    const attempts: Array<{ url: string; status: number; body: any }> = [];
    let success: { url: string; data: any } | null = null;
    for (const p of CANDIDATE_PATHS) {
      const url = `${baseUrl}${p}`;
      try {
        const resp = await fetch(url, { method: 'GET', headers: { 'x-api-key': apiKey, 'Accept': 'application/json' } });
        const text = await resp.text();
        let data: any = null; try { data = JSON.parse(text); } catch { /* keep */ }
        attempts.push({ url, status: resp.status, body: data ?? text?.slice(0, 200) });
        if (resp.ok) { success = { url, data }; break; }
        // 401/403 means key is wrong — no point trying other paths
        if (resp.status === 401 || resp.status === 403) break;
      } catch (e) {
        attempts.push({ url, status: 0, body: e instanceof Error ? e.message : String(e) });
      }
    }

    if (!success) {
      console.error('[rcs-wallet] all candidates failed', JSON.stringify(attempts));
      const last = attempts[attempts.length - 1] ?? { status: 0, body: 'no response' };
      const reason =
        last.status === 401 ? 'Invalid API key — check x-api-key in Provider credentials' :
        last.status === 403 ? 'API key lacks wallet permission' :
        last.status === 404 ? `No wallet endpoint found on ${baseUrl} (tried ${attempts.length} paths)` :
        `HTTP ${last.status}`;
      return json(200, { ok: false, reason, attempts, base_url: baseUrl });
    }

    const d = success.data;
    const balance = Number(d?.balance ?? d?.data?.balance ?? d?.wallet ?? d?.amount ?? null);
    const currency = (d?.currency || d?.data?.currency || 'INR') as string;

    await supabase.from('rcs_wallet_snapshots').insert({
      branch_id: branchId, balance: Number.isFinite(balance) ? balance : null, currency, raw: d,
    });

    return json(200, {
      ok: true,
      balance: Number.isFinite(balance) ? balance : null,
      currency,
      endpoint: success.url,
      raw: d,
    });
  } catch (e) {
    console.error('[rcs-wallet] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
