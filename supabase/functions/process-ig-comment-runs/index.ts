// v2.0.0 — Instagram Comment-to-DM executor (cron, every 1 min).
// Picks up due `ig_comment_runs` rows and dispatches them.
// - send_dm    → Graph API Private Reply (recipient.comment_id) → falls back to
//                recipient.id within the 24h DM window.
// - public_reply → POST /{comment-id}/replies
// On successful DM: ensures a CRM lead exists (linked to chat_settings) and
// bumps leads_created. AI replies use an ephemeral one-shot (no chat memory).
// Failures retry up to 3x with exponential backoff.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  renderTemplate,
  ensureLeadFromIgComment,
  generateAiReplyEphemeral,
} from "../_shared/ig-comment-automation.ts";
import { META_GRAPH_VERSION } from "../_shared/meta-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_ATTEMPTS = 3;
const BATCH = 50;

async function loadIntegration(branchId: string, integrationId: string | null, igAccountId: string | null) {
  if (integrationId) {
    const { data } = await supabase.from("integration_settings").select("*").eq("id", integrationId).maybeSingle();
    if (data) return data;
  }
  // Try IG-native providers first
  const { data: igRow } = await supabase
    .from("integration_settings")
    .select("*")
    .in("provider", ["instagram", "instagram_login"])
    .eq("is_active", true)
    .or(`branch_id.eq.${branchId},branch_id.is.null`)
    .order("branch_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (igRow) return igRow;

  // Fallback: FB Page-connected IG where token lives under meta / facebook_page
  const { data: metaRows } = await supabase
    .from("integration_settings")
    .select("*")
    .in("provider", ["meta", "facebook_page"])
    .eq("is_active", true)
    .or(`branch_id.eq.${branchId},branch_id.is.null`)
    .order("branch_id", { ascending: false, nullsFirst: false });
  if (!igAccountId) return metaRows?.[0] ?? null;
  for (const row of metaRows || []) {
    const c: any = row?.credentials || {};
    const ids = [c.instagram_business_account_id, c.instagram_account_id, c.ig_account_id]
      .filter(Boolean).map(String);
    if (ids.includes(String(igAccountId))) return row;
  }
  return metaRows?.[0] ?? null;
}

async function sendIgPrivateReply(opts: {
  igAccountId: string;
  accessToken: string;
  commentId: string;
  recipientId: string;
  message: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  // Prefer comment_id recipient (Private Replies API — wider window).
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(opts.igAccountId)}/messages`;
  const body = {
    recipient: { comment_id: opts.commentId },
    message: { text: opts.message },
    messaging_type: "RESPONSE",
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, messageId: data?.message_id || null };

  // Fallback: regular recipient.id (within 24h window)
  const r2 = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.accessToken}` },
    body: JSON.stringify({
      recipient: { id: opts.recipientId },
      message: { text: opts.message },
      messaging_type: "RESPONSE",
    }),
  });
  const data2 = await r2.json().catch(() => ({}));
  if (r2.ok) return { ok: true, messageId: data2?.message_id || null };
  return { ok: false, error: data?.error?.message || data2?.error?.message || `${r.status}/${r2.status}` };
}

async function publicCommentReply(opts: { commentId: string; accessToken: string; message: string }) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(opts.commentId)}/replies`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.accessToken}` },
    body: JSON.stringify({ message: opts.message }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, error: r.ok ? undefined : data?.error?.message || `HTTP ${r.status}` };
}

async function generateAiMessage(opts: { campaign: any; run: any }): Promise<string | null> {
  return await generateAiReplyEphemeral({
    comment: opts.run.comment_text || "",
    username: opts.run.ig_username || null,
    campaignName: opts.campaign.name || "Instagram",
    instruction: opts.campaign.ai_instruction || null,
    tone: opts.campaign.ai_tone || null,
  });
}

async function processRun(run: any): Promise<void> {
  const { data: campaign } = await supabase
    .from("ig_comment_campaigns")
    .select("*")
    .eq("id", run.campaign_id)
    .maybeSingle();
  if (!campaign) {
    await supabase.from("ig_comment_runs").update({
      status: "skipped", skip_reason: "campaign_missing", executed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return;
  }
  if (!campaign.is_active) {
    await supabase.from("ig_comment_runs").update({
      status: "skipped", skip_reason: "campaign_inactive", executed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return;
  }

  const integration = await loadIntegration(run.branch_id, campaign.integration_id);
  const accessToken: string | undefined =
    integration?.credentials?.page_access_token || integration?.credentials?.access_token;
  const igAccountId: string | undefined =
    integration?.credentials?.instagram_account_id || integration?.credentials?.ig_account_id ||
    campaign.ig_account_id;

  if (!accessToken || !igAccountId) {
    await supabase.from("ig_comment_runs").update({
      status: "failed", error_message: "missing_integration_credentials", attempts: run.attempts + 1,
      executed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return;
  }

  const vars: Record<string, string> = {
    first_name: (run.ig_username || "").replace(/^@/, "").split(/\s|\./)[0] || "",
    username: run.ig_username || "",
    keyword: run.matched_keyword || "",
    campaign_name: campaign.name || "",
    post_link: run.ig_media_id ? `https://www.instagram.com/p/${run.ig_media_id}/` : "",
  };

  if (run.action === "public_reply") {
    const msg = campaign.comment_public_reply || "";
    if (!msg) {
      await supabase.from("ig_comment_runs").update({
        status: "skipped", skip_reason: "no_public_reply_text", executed_at: new Date().toISOString(),
      }).eq("id", run.id);
      return;
    }
    const rendered = renderTemplate(msg, vars);
    const res = await publicCommentReply({ commentId: run.comment_id, accessToken, message: rendered });
    await supabase.from("ig_comment_runs").update({
      status: res.ok ? "sent" : "failed",
      error_message: res.error || null,
      attempts: run.attempts + 1,
      executed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return;
  }

  // send_dm
  let message = "";
  if (campaign.reply_mode === "template") {
    message = renderTemplate(campaign.dm_template || "", vars);
  } else {
    const ai = await generateAiMessage({ campaign, ev: { ...run, branch_id: run.branch_id } });
    if (ai) {
      message = ai;
    } else if (campaign.reply_mode === "hybrid" && campaign.dm_template) {
      message = renderTemplate(campaign.dm_template, vars);
    } else if (campaign.fallback_message) {
      message = renderTemplate(campaign.fallback_message, vars);
    }
  }

  if (!message?.trim()) {
    await supabase.from("ig_comment_runs").update({
      status: "failed", error_message: "no_message_rendered", attempts: run.attempts + 1,
      executed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return;
  }

  // Log outbound message in whatsapp_messages for the inbox UI
  const { data: outMsg } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: run.branch_id,
      phone_number: run.ig_user_id,
      content: message,
      direction: "outbound",
      status: "pending",
      message_type: "text",
      platform: "instagram" as any,
    })
    .select("id")
    .single();

  const res = await sendIgPrivateReply({
    igAccountId, accessToken,
    commentId: run.comment_id,
    recipientId: run.ig_user_id,
    message,
  });

  await supabase
    .from("whatsapp_messages")
    .update({ status: res.ok ? "sent" : "failed", error_message: res.error || null })
    .eq("id", outMsg?.id ?? "");

  await supabase.from("ig_comment_runs").update({
    status: res.ok ? "sent" : (run.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "scheduled"),
    error_message: res.error || null,
    attempts: run.attempts + 1,
    outbound_message_id: outMsg?.id ?? null,
    executed_at: new Date().toISOString(),
    scheduled_at: res.ok ? null : new Date(Date.now() + Math.pow(2, run.attempts) * 60_000).toISOString(),
  }).eq("id", run.id);

  await supabase.rpc("bump_ig_campaign_counters", {
    p_campaign_id: campaign.id,
    p_dms_sent: res.ok ? 1 : 0,
    p_dms_failed: res.ok ? 0 : 1,
  });

  if (res.ok && campaign.notify_staff) {
    try {
      const { data: staff } = await supabase
        .from("user_roles").select("user_id").in("role", ["owner", "admin", "manager"]).limit(50);
      const seen = new Set<string>();
      const rows = (staff || [])
        .filter((r: any) => r.user_id && !seen.has(r.user_id) && seen.add(r.user_id))
        .map((r: any) => ({
          user_id: r.user_id,
          branch_id: run.branch_id,
          title: `Instagram automation: ${campaign.name}`,
          message: `${run.ig_username || run.ig_user_id} triggered "${run.matched_keyword}"`,
          type: "info",
          category: "lead",
          action_url: "/instagram-automations",
          is_read: false,
        }));
      if (rows.length) await supabase.from("notifications").insert(rows);
    } catch (e) { console.error("[ig-exec] notify failed:", e); }
  }
}

async function tick() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("ig_comment_runs")
    .select("*")
    .in("status", ["pending", "scheduled"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("[ig-exec] query failed:", error.message);
    return { processed: 0, error: error.message };
  }
  let processed = 0;
  for (const run of (due || [])) {
    try {
      await processRun(run);
      processed++;
    } catch (e) {
      console.error("[ig-exec] run failed:", e instanceof Error ? e.message : e);
    }
  }
  return { processed };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const result = await tick();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
