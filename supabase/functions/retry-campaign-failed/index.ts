// v2.0.0 — Smart retry. Every candidate row is classified through the single
// policy module (`_shared/whatsappPolicy.ts`): only `retryable` rows are sent
// again. Pace-limited (Meta 131049/130472) and terminal recipients are never
// re-attempted, and an unconfirmed outcome is never blind-resent.
// Supports `dry_run: true` so the UI can show the Retryable / Pace limited /
// Terminal split before the operator confirms.
// v1.3.0 — Fold every dedupe-key variant (`:a1`, `:retry:<ts>`, `:fallback:<ts>`)
// back to the base recipient key so DLR-failed rows are actually detected.
// v1.1.0 — Retry only currently failed recipients; do not retry contacts that
// already have a successful send log for the same campaign/source key.
// v1.0.0 — Retry only the failed recipients of a campaign.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { retryEligibility } from '../_shared/whatsappPolicy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await authClient.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    if (claimsErr || !claims?.claims) return json(401, { error: 'Unauthorized' });

    const admin = createClient(supabaseUrl, service);

    const body = await req.json().catch(() => ({}));
    const campaign_id = String(body?.campaign_id || '').trim();
    if (!campaign_id) return json(400, { error: 'campaign_id required' });

    const { data: campaign, error: cErr } = await admin
      .from('campaigns')
      .select('id, branch_id, channel, message, subject, template_id, attachment_url, attachment_kind, attachment_filename, audience_filter, status, last_progress_at, created_at')
      .eq('id', campaign_id)
      .maybeSingle();
    if (cErr || !campaign) return json(404, { error: 'Campaign not found' });
    // v1.2.0 — a campaign that says "sending" but hasn't written progress in
    // 5+ minutes has a dead chunk isolate; allow the retry instead of a 409.
    const lastProgressMs = new Date(
      (campaign as any).last_progress_at || campaign.created_at,
    ).getTime();
    const stalled = Date.now() - lastProgressMs > 5 * 60_000;
    if (campaign.status === 'sending' && !stalled) {
      return json(409, { error: 'Campaign is already sending — wait for it to finish' });
    }


    const dryRun = body?.dry_run === true;

    // Load failed recipients (recipient-side status OR joined provider DLR failure).
    const { data: recRows } = await admin
      .from('campaign_recipients')
      .select('id, source_type, source_ref_id, full_name, phone, email, status, attempt, error, last_meta_error_code, marketing_blocked_until')
      .eq('campaign_id', campaign_id)
      .in('status', ['failed', 'pace_limited']);

    // Merge provider DLR states. Base keys strip any :retry:<ts> suffix so all
    // attempts for the same recipient collapse to one current outcome.
    const { data: campaignLogs } = await admin
      .from('communication_logs')
      .select('dedupe_key, delivery_status, status, error_message')
      .like('dedupe_key', `campaign:${campaign_id}:%`)
      .order('created_at', { ascending: false });

    const successfulKeys = new Set(
      (campaignLogs || [])
        .filter((l: any) => ['sent', 'delivered', 'read'].includes(String(l.delivery_status || l.status || '').toLowerCase()))
        .map((l: any) => baseCampaignKey(l.dedupe_key))
        .filter(Boolean) as string[],
    );

    const dlrFailedKeys = new Set(
      (campaignLogs || [])
        .filter((l: any) => ['failed', 'bounced'].includes(String(l.delivery_status || '').toLowerCase()))
        .map((l: any) => baseCampaignKey(l.dedupe_key))
        .filter(Boolean) as string[],
    );

    // Latest provider error text per base recipient key (logs are newest-first).
    const latestErrorByKey = new Map<string, string>();
    for (const l of (campaignLogs || []) as any[]) {
      const key = baseCampaignKey(l.dedupe_key);
      if (key && !latestErrorByKey.has(key) && l.error_message) {
        latestErrorByKey.set(key, String(l.error_message));
      }
    }

    // Pull sent-but-DLR-failed recipient rows to also retry.
    let dlrFailedRecipients: any[] = [];
    if (dlrFailedKeys.size > 0) {
      const { data: sentRows } = await admin
        .from('campaign_recipients')
        .select('id, source_type, source_ref_id, full_name, phone, email, status, attempt, error, last_meta_error_code, marketing_blocked_until')
        .eq('campaign_id', campaign_id)
        .eq('status', 'sent');
      dlrFailedRecipients = (sentRows || []).filter((r: any) =>
        dlrFailedKeys.has(`campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}`),
      );
    }

    const merged = [...(recRows || []), ...dlrFailedRecipients]
      .filter((r: any) => {
        const key = `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}`;
        return !successfulKeys.has(key);
      });
    // Dedupe by (source_type, source_ref_id)
    const seen = new Set<string>();
    const candidates = merged.filter((r: any) => {
      const k = `${r.source_type}:${r.source_ref_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return !!(r.phone || r.email);
    });

    // ── Single policy decision per candidate ────────────────────────────────
    const buckets: Record<'retryable' | 'pace_limited' | 'terminal', any[]> = {
      retryable: [], pace_limited: [], terminal: [],
    };
    const reasonCounts: Record<string, number> = {};
    for (const r of candidates) {
      const key = `campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}`;
      const verdict = retryEligibility({
        status: r.status,
        error: r.error ?? latestErrorByKey.get(key) ?? null,
        error_code: r.last_meta_error_code ?? null,
        marketing_blocked_until: r.marketing_blocked_until ?? null,
        attempt: r.attempt ?? 0,
      });
      buckets[verdict.bucket].push(r);
      if (verdict.bucket !== 'retryable') {
        reasonCounts[verdict.reason] = (reasonCounts[verdict.reason] || 0) + 1;
      }
    }

    const audience = buckets.retryable;
    const split = {
      candidates: candidates.length,
      retryable: buckets.retryable.length,
      pace_limited: buckets.pace_limited.length,
      terminal: buckets.terminal.length,
      skipped_reasons: reasonCounts,
    };

    if (dryRun) {
      return json(200, { dry_run: true, accepted: 0, split });
    }

    if (audience.length === 0) {
      return json(200, {
        accepted: 0,
        reason: 'no retryable recipients — pace-limited and terminal contacts are never re-attempted',
        split,
      });
    }


    // Bump attempt + last_retried_at on these recipient rows.
    const ids = audience.map((r: any) => r.id).filter(Boolean);
    if (ids.length > 0) {
      for (const row of audience) {
        await admin
          .from('campaign_recipients')
          .update({
            attempt: (row.attempt || 1) + 1,
            last_retried_at: new Date().toISOString(),
            status: 'pending',
            error: null,
          })
          .eq('id', row.id);
      }
    }

    // Build recipients payload for send-broadcast (retry mode).
    const recipients = audience.map((r: any) => ({
      source_type: r.source_type,
      source_ref_id: r.source_ref_id,
      full_name: r.full_name,
      phone: r.phone,
      email: r.email,
      contact_id: null,
    }));

    // Flip campaign to sending so the UI reflects the retry immediately.
    await admin
      .from('campaigns')
      .update({
        status: 'sending',
        last_progress_at: new Date().toISOString(),
        last_run_error: null,
      })
      .eq('id', campaign_id);

    const { error: invokeErr } = await admin.functions.invoke('send-broadcast', {
      headers: { Authorization: authHeader },
      body: {
        channel: campaign.channel,
        message: campaign.message,
        subject: campaign.subject,
        branch_id: campaign.branch_id,
        recipients,
        campaign_id,
        template_id: campaign.template_id ?? undefined,
        attachment_url: campaign.attachment_url ?? undefined,
        attachment_kind: campaign.attachment_kind ?? undefined,
        attachment_filename: campaign.attachment_filename ?? undefined,
        retry: true,
      },
    });
    if (invokeErr) {
      return json(500, { error: invokeErr.message || 'send-broadcast invoke failed' });
    }

    return json(202, { accepted: audience.length, retrying: true, split });
  } catch (e: any) {
    return json(500, { error: e?.message || String(e) });
  }
});

/** Fold `campaign:<cid>:<type>:<ref>:<variant…>` down to the base recipient key. */
function baseCampaignKey(raw: unknown): string | null {
  const parts = String(raw || '').split(':');
  if (parts.length < 4 || parts[0] !== 'campaign') return null;
  return parts.slice(0, 4).join(':');
}
