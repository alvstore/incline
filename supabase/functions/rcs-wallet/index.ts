// v2.0.0 — Provider-aware wallet fetch. Routes via `integration_settings` (Smartping preferred, Telinfy fallback).
//   • Telinfy: probes candidate /rcs/wallet paths with x-api-key.
//   • Smartping: wallet endpoint is NOT publicly documented → returns { ok:true, unsupported:true }
//     so the UI can show "wallet not exposed" without treating it as an error.
//   POST /rcs-wallet { branch_id?: string }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveRcsProvider } from '../_shared/rcsProviders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const TELINFY_CANDIDATE_PATHS = [
  '/rcs/wallet', '/rcs/wallet/balance',
  '/wallet', '/wallet/balance', '/account/wallet', '/sms/wallet',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const branchId: string | null = body?.branch_id || null;

    const cfg = await resolveRcsProvider(supabase, branchId);
    if (!cfg.is_active) return json(200, { ok: false, reason: `${cfg.provider} integration is disabled`, provider: cfg.provider });

    // ---- Smartping: no documented public wallet endpoint ----
    if (cfg.provider === 'smartping') {
      await supabase.from('rcs_wallet_snapshots').insert({
        branch_id: branchId, balance: null, currency: 'INR', raw: { unsupported: true, provider: 'smartping' },
      });
      return json(200, {
        ok: true, unsupported: true, provider: 'smartping', balance: null, currency: 'INR',
        reason: 'Smartping RCS API does not expose a wallet balance endpoint. Check balance in the Smartping dashboard.',
      });
    }

    // ---- Telinfy: probe candidate paths ----
    const apiKey = cfg.credentials?.api_key || Deno.env.get('TELINFY_API_KEY') || '';
    if (!apiKey) return json(200, { ok: false, provider: 'telinfy', reason: 'Telinfy API key missing' });

    const attempts: Array<{ url: string; status: number; body: any }> = [];
    let success: { url: string; data: any } | null = null;
    for (const p of TELINFY_CANDIDATE_PATHS) {
      const url = `${cfg.base_url}${p}`;
      try {
        const resp = await fetch(url, { method: 'GET', headers: { 'x-api-key': apiKey, 'Accept': 'application/json' } });
        const text = await resp.text();
        let data: any = null; try { data = JSON.parse(text); } catch { /* keep */ }
        attempts.push({ url, status: resp.status, body: data ?? text?.slice(0, 200) });
        if (resp.ok) { success = { url, data }; break; }
        if (resp.status === 401 || resp.status === 403) break;
      } catch (e) {
        attempts.push({ url, status: 0, body: e instanceof Error ? e.message : String(e) });
      }
    }

    if (!success) {
      const last = attempts[attempts.length - 1] ?? { status: 0 };
      const reason =
        last.status === 401 ? 'Invalid API key' :
        last.status === 403 ? 'API key lacks wallet permission' :
        last.status === 404 ? `No wallet endpoint found on ${cfg.base_url}` :
        `HTTP ${last.status}`;
      return json(200, { ok: false, provider: 'telinfy', reason, attempts, base_url: cfg.base_url });
    }

    const d = success.data;
    const balance = Number(d?.balance ?? d?.data?.balance ?? d?.wallet ?? d?.amount ?? null);
    const currency = (d?.currency || d?.data?.currency || 'INR') as string;

    await supabase.from('rcs_wallet_snapshots').insert({
      branch_id: branchId, balance: Number.isFinite(balance) ? balance : null, currency, raw: d,
    });

    return json(200, {
      ok: true, provider: 'telinfy',
      balance: Number.isFinite(balance) ? balance : null,
      currency, endpoint: success.url, raw: d,
    });
  } catch (e) {
    console.error('[rcs-wallet] error', e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
