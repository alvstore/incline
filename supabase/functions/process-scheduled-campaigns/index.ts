// v1.3.0 — Pre-dispatch WhatsApp template status check.
//          Scheduled campaigns with a template_id are only sent if the linked
//          `whatsapp_templates` row is APPROVED. PENDING → the scheduled slot
//          is postponed by 30 minutes (up to a 24h grace window). REJECTED /
//          DISABLED / PAUSED → campaign fails, in-app + email alert to owner.
//          Accepts service-role bearer OR (apikey=service-role + x-system-call=automation-brain).
//          Honors audience_kind (members | leads | staff | contacts | mixed | segment).
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
    if (!due || due.length === 0) {
      return json({ processed: 0 });
    }

    const results: any[] = [];

    for (const c of due) {
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
        // Resolve audience server-side honoring audience_kind
        const filter = (c.audience_filter || {}) as any;
        const isMembersKind = !filter.audience_kind || filter.audience_kind === "members";
        const today = new Date().toISOString().split("T")[0];

        const broadcastBody: any = {
          channel: c.channel,
          message: c.message,
          subject: c.subject,
          branch_id: c.branch_id,
          campaign_id: c.id,
          attachment_url: c.attachment_url ?? undefined,
          attachment_kind: c.attachment_kind ?? undefined,
          attachment_filename: c.attachment_filename ?? undefined,
        };

        let totalRecipients = 0;

        if (isMembersKind) {
          let memberIds: string[] = [];
          const status = filter.member_status || filter.status;
          if (status === "active") {
            const { data } = await admin.from("memberships")
              .select("member_id").eq("branch_id", c.branch_id)
              .eq("status", "active").gte("end_date", today);
            memberIds = [...new Set((data || []).map((m: any) => m.member_id))];
          } else if (status === "expired") {
            const { data } = await admin.from("memberships")
              .select("member_id").eq("branch_id", c.branch_id).lt("end_date", today);
            memberIds = [...new Set((data || []).map((m: any) => m.member_id))];
          } else {
            const { data } = await admin.from("members").select("id").eq("branch_id", c.branch_id);
            memberIds = (data || []).map((m: any) => m.id);
          }
          broadcastBody.member_ids = memberIds;
          totalRecipients = memberIds.length;
        } else {
          const { data: recipients, error: rErr } = await admin.rpc("resolve_campaign_audience" as any, {
            p_branch_id: c.branch_id,
            p_filter: filter,
          });
          if (rErr) throw new Error(`Audience resolve failed: ${rErr.message}`);
          broadcastBody.recipients = recipients || [];
          totalRecipients = broadcastBody.recipients.length;
        }

        if (totalRecipients === 0) {
          await admin.from("campaigns").update({
            status: "sent", sent_at: new Date().toISOString(), recipients_count: 0,
            last_run_error: null,
          }).eq("id", c.id);
          results.push({ id: c.id, sent: 0, note: "no_recipients" });
          continue;
        }

        // Invoke send-broadcast with service-role auth
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(broadcastBody),
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

        await admin.from("campaigns").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          recipients_count: totalRecipients,
          success_count: body.sent || 0,
          failure_count: body.failed || 0,
          last_run_error: null,
        }).eq("id", c.id);

        results.push({ id: c.id, sent: body.sent || 0, failed: body.failed || 0 });
      } catch (e: any) {
        await admin.from("campaigns").update({
          status: "failed", last_run_error: e?.message || String(e),
        }).eq("id", c.id);
        results.push({ id: c.id, error: e?.message });
      }
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
