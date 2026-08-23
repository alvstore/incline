// v1.5.0 — Hand off to send-broadcast v5 chunked pipeline (mode='materialize');
//          added watchdog that resumes 'sending' campaigns with no progress in
//          5+ minutes so a dead isolate never leaves a broadcast half-done.
// v1.4.0 — Respect send-broadcast v4.x async ACK (accepted/background). Do not
//          overwrite terminal status; broadcast loop owns final campaign state.
//          Prevents "sent 337 · 0 delivered · 0 failed" race for large audiences.
// v1.3.0 — Pre-dispatch WhatsApp template status check.
//          Scheduled campaigns with a template_id are only sent if the linked
//          `whatsapp_templates` row is APPROVED. PENDING → the scheduled slot
//          is postponed by 30 minutes (up to a 24h grace window). REJECTED /
//          DISABLED / PAUSED → campaign fails, in-app + email alert to owner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth gate: cron-only. Accept either:
    //   1. Authorization: Bearer <service-role-key>, OR
    //   2. apikey: <service-role-key> + x-system-call: automation-brain
    // (the master automation-brain dispatcher uses pattern #2 because the new
    // signing-keys gateway rejects dual sb_ keys.)
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const apikey = req.headers.get("apikey") || "";
    const sysCall = req.headers.get("x-system-call") || "";
    const isSystem = bearer === serviceKey || (apikey === serviceKey && sysCall === "automation-brain");
    if (!isSystem) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Pick due scheduled campaigns
    const { data: due, error } = await admin
      .from("campaigns")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .limit(20);

    if (error) throw error;
    // NOTE: don't early-return when `due` is empty — we still need to run the
    // stalled-campaign watchdog block below (v1.5.0).

    const results: any[] = [];
    const dueList = due || [];

    for (const c of dueList) {
      // ── Pre-dispatch WhatsApp template gate ──
      // If this campaign was scheduled while its template was still pending
      // Meta approval, re-check status live. APPROVED → send. REJECTED/etc →
      // fail with an operator alert. PENDING → postpone by 30 min (max 24h).
      if (c.channel === 'whatsapp' && c.template_id) {
        const { data: localTpl } = await admin
          .from('templates')
          .select('meta_template_name, name')
          .eq('id', c.template_id)
          .maybeSingle();
        const metaName = (localTpl as any)?.meta_template_name || (localTpl as any)?.name;
        if (metaName) {
          const { data: metaTpl } = await admin
            .from('whatsapp_templates')
            .select('status, meta_last_error')
            .eq('name', metaName)
            .maybeSingle();
          const metaStatus = (metaTpl as any)?.status || 'PENDING';
          if (metaStatus === 'PENDING') {
            const scheduledMs = new Date(c.scheduled_at).getTime();
            const graceMs = 24 * 60 * 60 * 1000;
            if (Date.now() - scheduledMs > graceMs) {
              await admin.from('campaigns').update({
                status: 'failed',
                last_run_error: `Template "${metaName}" still pending Meta approval after 24h grace window`,
              }).eq('id', c.id);
              await notifyOwner(admin, c, `Campaign "${c.name}" failed: template still pending Meta approval after 24h.`);
              results.push({ id: c.id, error: 'template_pending_grace_exhausted' });
            } else {
              // Push the schedule forward 30 min and let the next tick recheck.
              const nextRun = new Date(Date.now() + 30 * 60 * 1000).toISOString();
              await admin.from('campaigns').update({ scheduled_at: nextRun }).eq('id', c.id);
              results.push({ id: c.id, note: 'template_pending_deferred', next_run: nextRun });
            }
            continue;
          }
          if (metaStatus !== 'APPROVED') {
            const reason = (metaTpl as any)?.meta_last_error || `Meta status: ${metaStatus}`;
            await admin.from('campaigns').update({
              status: 'failed',
              last_run_error: `Template "${metaName}" ${metaStatus.toLowerCase()} by Meta: ${reason}`,
            }).eq('id', c.id);
            await notifyOwner(admin, c, `Campaign "${c.name}" failed: Meta ${metaStatus.toLowerCase()} template "${metaName}".`);
            results.push({ id: c.id, error: `template_${metaStatus.toLowerCase()}` });
            continue;
          }
        }
      }

      // Mark sending (optimistic lock)
      const { data: locked } = await admin
        .from("campaigns")
        .update({ status: "sending" })
        .eq("id", c.id)
        .eq("status", "scheduled")
        .select()
        .single();
      if (!locked) continue;

      try {
        // v1.5.0 — Hand the audience off to send-broadcast's chunked pipeline.
        // We no longer resolve recipients here (that duplicates work and burns
        // a big chunk of cron isolate time on 5k+ audiences); mode='materialize'
        // does it once and then self-drives the chunk loop.
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "x-system-call": "scheduled-campaigns",
          },
          body: JSON.stringify({
            mode: 'materialize',
            campaign_id: c.id,
            branch_id: c.branch_id,
          }),
        });

        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          await admin.from("campaigns").update({
            status: "failed",
            last_run_error: body?.error || `HTTP ${resp.status}`,
          }).eq("id", c.id);
          results.push({ id: c.id, error: body?.error });
          continue;
        }
        results.push({ id: c.id, accepted: true, materialized: body?.materialized ?? body?.already_materialized ?? 0 });
      } catch (e: any) {
        await admin.from("campaigns").update({
          status: "failed", last_run_error: e?.message || String(e),
        }).eq("id", c.id);
        results.push({ id: c.id, error: e?.message });
      }
    }

    // ── Watchdog: resume any 'sending' campaign that hasn't made progress in
    // 5+ minutes and still has pending/dispatching recipients. Guarantees the
    // pipeline recovers if a chunk isolate dies without self-invoking.
    try {
      const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: stalled } = await admin
        .from('campaigns')
        .select('id, branch_id, last_progress_at')
        .eq('status', 'sending')
        .lt('last_progress_at', staleCutoff)
        .limit(20);
      for (const s of (stalled || [])) {
        const { count: pending } = await admin
          .from('campaign_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', (s as any).id)
          .in('status', ['pending', 'dispatching']);
        if ((pending ?? 0) > 0) {
          await fetch(`${supabaseUrl}/functions/v1/send-broadcast`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
              'x-system-call': 'stalled-reaper',
            },
            body: JSON.stringify({ mode: 'chunk', campaign_id: (s as any).id }),
          }).catch((e) => console.warn('[reaper] resume failed:', e?.message || e));
          results.push({ id: (s as any).id, resumed: true, pending });
        } else {
          // No pending rows but status still 'sending' → close it out.
          await admin.from('campaigns').update({
            status: 'sent', sent_at: new Date().toISOString(),
          }).eq('id', (s as any).id);
          results.push({ id: (s as any).id, closed_out: true });
        }
      }
    } catch (e: any) {
      console.warn('[reaper] scan failed:', e?.message || e);
    }


    return json({ processed: results.length, results });
  } catch (e: any) {
    return json({ error: e?.message || "Internal error" }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Fire an in-app notification to the campaign creator (best-effort — never
 * throws). Used when a scheduled campaign is failed due to template status.
 */
async function notifyOwner(admin: any, campaign: any, message: string) {
  try {
    if (!campaign.created_by) return;
    await admin.from('notifications').insert({
      user_id: campaign.created_by,
      title: 'Campaign failed',
      message,
      type: 'campaign_failed',
      metadata: { campaign_id: campaign.id, branch_id: campaign.branch_id },
    });
  } catch (e) {
    console.error('notifyOwner failed', e);
  }
}
