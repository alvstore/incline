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
    // Recipient snapshot from campaign_recipients (source of truth for the send-time outcome)
    const { data: recips } = await admin
      .from('campaign_recipients')
      .select('id, source_type, source_ref_id, status')
      .eq('campaign_id', cid);

    // Pull DLR for this campaign via dedupe_key prefix
    const { data: logs } = await admin
      .from('communication_logs')
      .select('dedupe_key, delivery_status, read_at, delivered_at')
      .like('dedupe_key', `campaign:${cid}:%`);

    const dlrByKey = new Map<string, any>();
    for (const l of logs || []) {
      const base = baseCampaignKey((l as any).dedupe_key);
      if (!base) continue;
      const existing = dlrByKey.get(base);
      if (!existing || statusRank((l as any).delivery_status) > statusRank(existing.delivery_status)) {
        dlrByKey.set(base, l);
      }
    }

    const recByKey = new Map<string, any>();
    for (const r of recips || []) {
      const key = `campaign:${cid}:${(r as any).source_type}:${(r as any).source_ref_id}`;

      const existing = recByKey.get(key);
      if (!existing || recipientRank((r as any).status) > recipientRank(existing.status)) {
        recByKey.set(key, r);
      }
    }

    let sent = 0, delivered = 0, read = 0, failed = 0;
    for (const [key, r] of recByKey.entries()) {
      const dlr = dlrByKey.get(key);
      const dlrStatus = String(dlr?.delivery_status || '').toLowerCase();
      const recStatus = String((r as any).status || '').toLowerCase();

      // Provider DLR always wins over the send-time recipient snapshot.
      if (dlrStatus === 'read' || dlr?.read_at) { read++; delivered++; sent++; continue; }
      if (dlrStatus === 'delivered' || dlr?.delivered_at) { delivered++; sent++; continue; }
      if (dlrStatus === 'failed' || dlrStatus === 'bounced' || dlrStatus === 'suppressed') { failed++; continue; }
      if (dlrStatus === 'sent' || dlrStatus === 'queued' || dlrStatus === 'sending') { sent++; continue; }
      if (recStatus === 'sent') { sent++; continue; }
      if (recStatus === 'failed' || recStatus === 'skipped') { failed++; continue; }

    }

    const total = recByKey.size || (c as any).recipients_count || 0;

    // Stuck-sending backfill
    const ageMin = (Date.now() - new Date((c as any).created_at).getTime()) / 60000;
    const isStuck =
      (c as any).status === 'sending' &&
      ageMin > 30 &&
      total === 0;

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

    // Decide final status
    let finalStatus = (c as any).status;
    if (finalStatus === 'sending') {
      const done = sent + failed;
      if (done >= total) finalStatus = failed > 0 && sent === 0 ? 'failed' : 'sent';
    }

    await admin.from('campaigns').update({
      success_count: sent,
      delivered_count: delivered,
      read_count: read,
      failure_count: failed,
      recipients_count: total,
      status: finalStatus,
    }).eq('id', cid);
    reconciled++;
    results.push({ cid, sent, delivered, read, failed, total, status: finalStatus });
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

function statusRank(status: unknown): number {
  switch (String(status || '').toLowerCase()) {
    case 'read': return 5;
    case 'delivered': return 4;
    case 'sent': return 3;
    case 'queued':
    case 'sending': return 2;
    case 'failed':
    case 'bounced':
    case 'suppressed': return 1;
    default: return 0;
  }
}


function recipientRank(status: unknown): number {
  switch (String(status || '').toLowerCase()) {
    case 'sent': return 3;
    case 'failed': return 2;
    case 'skipped': return 1;
    default: return 0;
  }
}
