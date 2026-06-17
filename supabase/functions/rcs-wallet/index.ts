// v1.0.0 — Fetch Telinfy RCS wallet balance + write snapshot.
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
    if (cfg?.is_active) {
      apiKey = (cfg as any).credentials?.api_key || apiKey;
      baseUrl = (((cfg as any).config?.base_url || baseUrl) as string).replace(/\/+$/, '');
    }
    if (!apiKey) return json(200, { ok: false, reason: 'TELINFY_API_KEY missing' });

    const resp = await fetch(`${baseUrl}/rcs/wallet`, { method: 'GET', headers: { 'x-api-key': apiKey } });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* keep text */ }
    if (!resp.ok) return json(200, { ok: false, reason: `HTTP ${resp.status}`, raw: data || text });

    const balance = Number(data?.balance ?? data?.data?.balance ?? data?.wallet ?? data?.amount ?? null);
    const currency = (data?.currency || data?.data?.currency || 'INR') as string;

    await supabase.from('rcs_wallet_snapshots').insert({
      branch_id: branchId, balance: Number.isFinite(balance) ? balance : null, currency, raw: data,
    });

    return json(200, { ok: true, balance: Number.isFinite(balance) ? balance : null, currency, raw: data });
  } catch (e) {
    console.error('[rcs-wallet] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
