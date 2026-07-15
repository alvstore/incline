// v1.0.0 — Poll Telinfy /rcs/record/{id} for RCS logs stuck at "sent" and
// (a) map real status → delivered/read/failed, (b) auto-fall back to SMS via
// dispatch-communication when Telinfy reports UN-DELIVERED (handset not
// RCS-capable — very common on iPhones on Indian carriers).
//
// Runs on a cron (every 2 min). Also invokable ad-hoc: POST { record_ids?: string[] }.
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

type TelinfyStatus = 'DELIVERED' | 'READ' | 'UN-DELIVERED' | 'SENT' | string;

async function resolveCreds(supabase: any, branchId: string | null) {
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
  return { apiKey, baseUrl };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const started = Date.now();

  let force_ids: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.record_ids)) force_ids = body.record_ids.map(String);
  } catch { /* ignore */ }

  // Pick RCS logs still sitting at "sent" without a terminal DLR
  //  - min age 60s (give webhook a chance)
  //  - max age 24h (Telinfy record window)
  const nowIso = new Date().toISOString();
  const minAgeIso = new Date(Date.now() - 60_000).toISOString();
  const maxAgeIso = new Date(Date.now() - 24 * 3600_000).toISOString();

  let query = supabase
    .from('communication_logs')
    .select('id, branch_id, recipient, content, category, provider_record_id, delivery_metadata, created_at')
    .eq('channel', 'rcs')
    .in('delivery_status', ['sent'])
    .is('delivered_at', null)
    .not('provider_record_id', 'is', null)
    .lte('created_at', minAgeIso)
    .gte('created_at', maxAgeIso)
    .order('created_at', { ascending: true })
    .limit(200);

  if (force_ids.length) {
    query = supabase
      .from('communication_logs')
      .select('id, branch_id, recipient, content, category, provider_record_id, delivery_metadata, created_at')
      .in('provider_record_id', force_ids);
  }

  const { data: pending, error: qErr } = await query;
  if (qErr) return json(500, { ok: false, error: qErr.message });

  const results: any[] = [];
  let delivered = 0, readCount = 0, failed = 0, fellback = 0, still = 0;

  for (const row of pending || []) {
    const rid = String((row as any).provider_record_id);
    const { apiKey, baseUrl } = await resolveCreds(supabase, (row as any).branch_id);
    if (!apiKey) { results.push({ rid, skip: 'no api key' }); continue; }

    try {
      const url = `${baseUrl}/rcs/record/${encodeURIComponent(rid)}`;
      const resp = await fetch(url, { method: 'GET', headers: { 'x-api-key': apiKey, 'Accept': 'application/json' } });
      const text = await resp.text();
      let raw: any = null; try { raw = JSON.parse(text); } catch { /* keep */ }
      const rec = raw?.data?.data || raw?.data || null;
      const status = String((rec?.STATUS || rec?.status || '') as TelinfyStatus).toUpperCase();
      const errCode = rec?.ERROR_CODE ?? rec?.error_code ?? null;
      const meta = { ...(row as any).delivery_metadata, telinfy_record: rec, reconciled_at: nowIso };

      if (status === 'READ') {
        await supabase.from('communication_logs').update({
          delivery_status: 'read',
          delivered_at: (row as any).delivered_at || nowIso,
          read_at: nowIso,
          delivery_metadata: meta,
        }).eq('id', (row as any).id);
        readCount++;
        results.push({ rid, status });
        continue;
      }
      if (status === 'DELIVERED') {
        await supabase.from('communication_logs').update({
          delivery_status: 'delivered',
          delivered_at: nowIso,
          delivery_metadata: meta,
        }).eq('id', (row as any).id);
        delivered++;
        results.push({ rid, status });
        continue;
      }
      if (status === 'UN-DELIVERED' || status === 'UNDELIVERED' || status === 'FAILED') {
        const reason = errCode === 404
          ? 'RCS undeliverable — recipient handset is not RCS-capable (iPhone/legacy Android on Indian carriers). Falling back to SMS.'
          : `RCS undeliverable (Telinfy error ${errCode ?? 'unknown'})`;
        await supabase.from('communication_logs').update({
          delivery_status: 'failed',
          failed_at: nowIso,
          error_message: reason,
          delivery_metadata: meta,
        }).eq('id', (row as any).id);
        failed++;

        // Auto SMS fallback (only for marketing/transactional content, non-empty body)
        const body = String((row as any).content || '').trim();
        const to = String((row as any).recipient || '').trim();
        if (body && to) {
          try {
            const { error: dErr } = await supabase.functions.invoke('dispatch-communication', {
              body: {
                branch_id: (row as any).branch_id,
                channel: 'sms',
                category: (row as any).category || 'marketing',
                recipient: to,
                payload: { body },
                dedupe_key: `rcs-fallback:${rid}`,
                source: 'rcs_fallback',
              },
            });
            if (!dErr) fellback++;
            results.push({ rid, status, fallback: dErr ? `sms_error: ${dErr.message}` : 'sms_queued' });
          } catch (e) {
            results.push({ rid, status, fallback: `sms_invoke_failed: ${e instanceof Error ? e.message : String(e)}` });
          }
        } else {
          results.push({ rid, status, fallback: 'skipped_no_body' });
        }
        continue;
      }

      still++;
      results.push({ rid, status: status || 'PENDING' });
    } catch (e) {
      results.push({ rid, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json(200, {
    ok: true,
    took_ms: Date.now() - started,
    scanned: (pending || []).length,
    delivered, read: readCount, failed, sms_fallback: fellback, still_pending: still,
    results,
  });
});
