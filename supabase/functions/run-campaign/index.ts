// run-campaign v1.0.0
// Invoked by automation-brain for recurring marketing campaigns.
// Reads worker_payload.campaign_id, re-resolves audience fresh, dispatches via send-broadcast.
// Re-uses the same campaign row for stats; does not duplicate it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ---- AUTH GATE (v1.1.0) ----
    // Internal-only: only callable by automation-brain via service-role bearer or by an admin/owner JWT.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isService = bearer && bearer === serviceKey;
    if (!isService) {
      if (!bearer) return json({ ok: false, error: "Unauthorized" }, 401);
      const { data: userRes } = await admin.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) return json({ ok: false, error: "Unauthorized" }, 401);
      const { data: roles } = await admin
        .from("user_roles").select("role").eq("user_id", uid);
      const allowed = new Set(["owner", "admin", "manager"]);
      const hasRole = (roles || []).some((r: any) => allowed.has(r.role));
      if (!hasRole) return json({ ok: false, error: "Forbidden" }, 403);
    }



    const payload = await req.json().catch(() => ({}));
    const campaignId = payload?.campaign_id as string | undefined;
    if (!campaignId) {
      return json({ ok: false, error: "Missing campaign_id in payload" }, 400);
    }

    const { data: c, error: cErr } = await admin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    if (cErr || !c) return json({ ok: false, error: "Campaign not found" }, 404);

    // Resolve audience fresh
    const filter = (c.audience_filter || {}) as any;
    const isMembersKind = !filter.audience_kind || filter.audience_kind === "members";

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

    if (isMembersKind) {
      const today = new Date().toISOString().split("T")[0];
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
      if (!memberIds.length) {
        await admin.from("campaigns").update({
          last_run_error: "no_recipients",
          recipients_count: 0,
        }).eq("id", c.id);
        return json({ ok: true, dispatched: 0, note: "no_recipients" });
      }
    } else {
      const { data: recipients, error: rErr } = await admin.rpc("resolve_campaign_audience" as any, {
        p_branch_id: c.branch_id,
        p_filter: filter,
      });
      if (rErr) {
        await admin.from("campaigns").update({ last_run_error: rErr.message }).eq("id", c.id);
        return json({ ok: false, error: rErr.message }, 500);
      }
      broadcastBody.recipients = recipients || [];
      if (!broadcastBody.recipients.length) {
        await admin.from("campaigns").update({
          last_run_error: "no_recipients",
          recipients_count: 0,
        }).eq("id", c.id);
        return json({ ok: true, dispatched: 0, note: "no_recipients" });
      }
    }

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
        last_run_error: body?.error || `HTTP ${resp.status}`,
      }).eq("id", c.id);
      return json({ ok: false, error: body?.error || `HTTP ${resp.status}` }, 500);
    }

    const total = (broadcastBody.member_ids?.length ?? broadcastBody.recipients?.length ?? 0);
    await admin.from("campaigns").update({
      sent_at: new Date().toISOString(),
      recipients_count: total,
      success_count: body.sent || 0,
      failure_count: body.failed || 0,
      last_run_error: null,
      status: "sent",
    }).eq("id", c.id);

    return json({ ok: true, dispatched: body.sent || 0, failed: body.failed || 0, total });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
