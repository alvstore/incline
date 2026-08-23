// v1.1.0 — Retry only currently failed recipients; do not retry contacts that
// already have a successful send log for the same campaign/source key.
// v1.0.0 — Retry only the failed recipients of a campaign.
// Reads campaign_recipients where status='failed' (or merged log status is
// failed/bounced), builds a fresh `recipients` array in the shape send-broadcast
// expects, and invokes send-broadcast with { retry: true } so the new attempt
// uses a distinct dedupe_key suffix.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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


    // Load failed recipients (recipient-side status OR joined provider DLR failure).
    const { data: recRows } = await admin
      .from('campaign_recipients')
      .select('id, source_type, source_ref_id, full_name, phone, email, status, attempt')
      .eq('campaign_id', campaign_id)
      .in('status', ['failed']);

    // Merge provider DLR states. Base keys strip any :retry:<ts> suffix so all
    // attempts for the same recipient collapse to one current outcome.
    const { data: campaignLogs } = await admin
      .from('communication_logs')
      .select('dedupe_key, delivery_status, status')
      .like('dedupe_key', `campaign:${campaign_id}:%`)
      .order('created_at', { ascending: false });

    const successfulKeys = new Set(
      (campaignLogs || [])
        .filter((l: any) => ['sent', 'delivered', 'read'].includes(String(l.delivery_status || l.status || '').toLowerCase()))
        .map((l: any) => String(l.dedupe_key || '').replace(/:retry:\d+$/, '')),
    );

    const dlrFailedKeys = new Set(
      (campaignLogs || [])
        .filter((l: any) => ['failed', 'bounced'].includes(String(l.delivery_status || '').toLowerCase()))
        .map((l: any) => String(l.dedupe_key || ''))
        // strip any :retry:N suffix so we compare to the original recipient key
        .map((k: string) => k.replace(/:retry:\d+$/, '')),
    );

    // Pull sent-but-DLR-failed recipient rows to also retry.
    let dlrFailedRecipients: any[] = [];
    if (dlrFailedKeys.size > 0) {
      const { data: sentRows } = await admin
        .from('campaign_recipients')
        .select('id, source_type, source_ref_id, full_name, phone, email, status, attempt')
        .eq('campaign_id', campaign_id)
        .eq('status', 'sent');
      dlrFailedRecipients = (sentRows || []).filter((r: any) =>
        dlrFailedKeys.has(`campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}`),
      );
    }

    const merged = [...(recRows || []), ...dlrFailedRecipients]
      .filter((r: any) => !successfulKeys.has(`campaign:${campaign_id}:${r.source_type}:${r.source_ref_id}`));
    // Dedupe by (source_type, source_ref_id)
    const seen = new Set<string>();
    const audience = merged.filter((r: any) => {
      const k = `${r.source_type}:${r.source_ref_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return !!(r.phone || r.email);
    });

    if (audience.length === 0) {
      return json(200, { accepted: 0, reason: 'no failed recipients to retry' });
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

    return json(202, { accepted: audience.length, retrying: true });
  } catch (e: any) {
    return json(500, { error: e?.message || String(e) });
  }
});
