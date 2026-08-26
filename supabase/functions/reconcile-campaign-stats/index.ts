// v2.0.0 — PHASE 3 + 6: the provider delivery event is authoritative and
//          `campaign_recipients` is the single source of truth for statistics.
//
//   • A send-time ACK NEVER permanently wins over a later provider failure.
//     Precedence: read > delivered > failed/bounced/suppressed > sent > queued.
//   • Each recipient is transitioned through `apply_campaign_recipient_status`
//     (monotonic, never regresses read → delivered → sent).
//   • Counters are then recomputed by `refresh_campaign_stats` from the rows —
//     no independently incremented totals, so recipient rows and campaign
//     totals can never disagree.
//   • `unknown` is NOT success and is reported in its own bucket.
//
// v1.2.0 — Normalise dedupe keys to `campaign:<cid>:<source_type>:<source_ref_id>`
//          so variant suffixes (`:a1`, `:retry:<ts>`, `:fallback:<ts>`) fold into
//          one recipient outcome.
// - Also backfills any stuck `status='sending'` older than 30 min that never
//   got recipient rows — flips them to `failed` with reason `stuck_sending_backfill`.
// - Invocable: POST { campaign_id?: string }  (no body ⇒ scan last 24 h).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const started = Date.now();

  let onlyId: string | null = null;
  try { const b = await req.json(); if (b?.campaign_id) onlyId = String(b.campaign_id); } catch { /* ignore */ }

  // Pick campaigns to reconcile
  let q = admin
    .from('campaigns')
    .select('id, status, recipients_count, created_at, last_progress_at')
    .in('status', ['sending', 'sent', 'failed'])
    .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(200);
  if (onlyId) q = admin.from('campaigns').select('id, status, recipients_count, created_at, last_progress_at').eq('id', onlyId);

  const { data: campaigns, error: cErr } = await q;
  if (cErr) return json(500, { ok: false, error: cErr.message });

  const results: any[] = [];
  let stuckFixed = 0, reconciled = 0;

  for (const c of campaigns || []) {
    const cid = (c as any).id;
    // Recipient rows are the source of truth; superseded duplicates excluded.
    const { data: recips } = await admin
      .from('campaign_recipients')
      .select('id, source_type, source_ref_id, status, error')
      .eq('campaign_id', cid)
      .eq('superseded', false);

    // Pull every provider outcome for this campaign via dedupe_key prefix.
    const { data: logs } = await admin
      .from('communication_logs')
      .select('id, dedupe_key, delivery_status, read_at, delivered_at, failed_at, error_message, provider_message_id')
      .like('dedupe_key', `campaign:${cid}:%`);

    // Phase 3 precedence: read > delivered > failed > sent > queued.
    // A later provider failure therefore beats an earlier send-time ACK.
    const dlrByKey = new Map<string, any>();
    for (const l of logs || []) {
      const base = baseCampaignKey((l as any).dedupe_key);
      if (!base) continue;
      const existing = dlrByKey.get(base);
      if (!existing || authorityRank(l) > authorityRank(existing)) dlrByKey.set(base, l);
    }

    let applied = 0;
    for (const r of recips || []) {
      const key = `campaign:${cid}:${(r as any).source_type}:${(r as any).source_ref_id}`;
      const dlr = dlrByKey.get(key);
      if (!dlr) continue;

      const ds = String(dlr.delivery_status || '').toLowerCase();
      const mapped =
        ds === 'read' || dlr.read_at ? 'read' :
        ds === 'delivered' || dlr.delivered_at ? 'delivered' :
        ds === 'failed' || ds === 'bounced' ? 'failed' :
        ds === 'suppressed' ? 'suppressed' :
        ds === 'skipped' || ds === 'deduped' ? 'skipped' :
        ds === 'sent' ? 'sent' :
        ds === 'queued' || ds === 'sending' ? 'queued' : null;
      if (!mapped) continue;
      if (mapped === String((r as any).status)) continue;

      const { error: aErr } = await admin.rpc('apply_campaign_recipient_status', {
        p_recipient_id: (r as any).id,
        p_status: mapped,
        p_error: mapped === 'failed' ? (dlr.error_message ?? null) : null,
        p_error_class: null,
        p_meta_code: null,
        p_provider_message_id: dlr.provider_message_id ?? null,
        p_provider_route: null,
        p_log_id: dlr.id,
        p_blocked_until: null,
      });
      if (!aErr) applied++;
    }

    const total = (recips || []).length;

    // Stuck-sending backfill
    const ageMin = (Date.now() - new Date((c as any).created_at).getTime()) / 60000;
    const isStuck = (c as any).status === 'sending' && ageMin > 30 && total === 0;

    if (isStuck) {
      await admin.from('campaigns').update({
        status: 'failed',
        last_run_error: 'stuck_sending_backfill',
        sent_at: new Date().toISOString(),
      }).eq('id', cid);
      stuckFixed++;
      results.push({ cid, stuck: true });
      continue;
    }

    if (total === 0) { results.push({ cid, skip: 'no recipients' }); continue; }

    // Phase 6: counters derived from the rows, never incremented independently.
    const { data: statsRaw } = await admin.rpc('refresh_campaign_stats', { p_campaign_id: cid });
    const stats = (statsRaw ?? {}) as Record<string, number>;

    // Only a campaign with nothing in flight can be closed out.
    let finalStatus = (c as any).status;
    const inFlight = Number(stats.pending ?? 0) + Number(stats.queued ?? 0) + Number(stats.dispatching ?? 0);
    if (finalStatus === 'sending' && inFlight === 0) {
      const reached = Number(stats.sent ?? 0) + Number(stats.submitted ?? 0);
      finalStatus = reached === 0 && Number(stats.failed ?? 0) > 0 ? 'failed' : 'sent';
      await admin.from('campaigns').update({ status: finalStatus }).eq('id', cid);
    }

    reconciled++;
    results.push({ cid, applied, total, status: finalStatus, ...stats });

  }

  return json(200, {
    ok: true,
    took_ms: Date.now() - started,
    scanned: (campaigns || []).length,
    reconciled,
    stuck_fixed: stuckFixed,
    results,
  });
});

/** Fold every dedupe-key variant (`:a1`, `:retry:<ts>`, `:fallback:<ts>`, …)
 *  back to `campaign:<cid>:<source_type>:<source_ref_id>`. */
function baseCampaignKey(raw: unknown): string | null {
  const parts = String(raw || '').split(':');
  if (parts.length < 4 || parts[0] !== 'campaign') return null;
  return parts.slice(0, 4).join(':');
}

/** Phase 3 authority ranking: a provider FAILURE outranks a send-time ACK,
 *  but confirmed delivery/read outrank everything. */
function authorityRank(log: any): number {
  const s = String(log?.delivery_status || '').toLowerCase();
  if (s === 'read' || log?.read_at) return 6;
  if (s === 'delivered' || log?.delivered_at) return 5;
  if (s === 'failed' || s === 'bounced') return 4;
  if (s === 'suppressed') return 3;
  if (s === 'sent') return 2;
  if (s === 'queued' || s === 'sending') return 1;
  return 0;
}
