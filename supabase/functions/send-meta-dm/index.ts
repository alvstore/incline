// v1.0.0 — Outbound Instagram / Messenger DM sender.
// Mirrors process-ig-comment-runs.loadIntegration + sendIgPrivateReply logic.
// Inputs: { message_id, platform: 'instagram'|'messenger', recipient_id, content, branch_id, ig_account_id? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_GRAPH_VERSION } from "../_shared/meta-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function loadIntegration(
  supabase: ReturnType<typeof createClient>,
  branchId: string,
  platform: "instagram" | "messenger",
  igAccountId: string | null,
) {
  if (platform === "instagram") {
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
  }
  // Fallback (and primary for messenger): FB Page / meta
  const { data: metaRows } = await supabase
    .from("integration_settings")
    .select("*")
    .in("provider", ["meta", "facebook_page"])
    .eq("is_active", true)
    .or(`branch_id.eq.${branchId},branch_id.is.null`)
    .order("branch_id", { ascending: false, nullsFirst: false });
  if (!metaRows?.length) return null;
  if (platform === "instagram" && igAccountId) {
    for (const row of metaRows) {
      const c: any = row?.credentials || {};
      const ids = [c.instagram_business_account_id, c.instagram_account_id, c.ig_account_id]
        .filter(Boolean).map(String);
      if (ids.includes(String(igAccountId))) return row;
    }
  }
  return metaRows[0] ?? null;
}

function resolveAccountId(integration: any, platform: "instagram" | "messenger"): string | null {
  const cfg: any = integration?.config || {};
  const cred: any = integration?.credentials || {};
  if (platform === "instagram") {
    return (
      cfg.instagram_account_id ||
      cred.instagram_business_account_id ||
      cred.instagram_account_id ||
      cred.ig_account_id ||
      cfg.page_id ||
      cred.page_id ||
      null
    );
  }
  return cfg.page_id || cred.page_id || null;
}

function resolveAccessToken(integration: any): string | null {
  const cred: any = integration?.credentials || {};
  return cred.page_access_token || cred.access_token || cred.token || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let messageId: string | null = null;
  try {
    const body = await req.json();
    const platform = body.platform as "instagram" | "messenger";
    messageId = body.message_id ?? null;
    const recipientId = String(body.recipient_id ?? body.recipient ?? body.phone_number ?? "").trim();
    const content = String(body.content ?? body.message ?? body.body ?? "").trim();
    const branchId = body.branch_id ?? body.branchId;
    const igAccountIdHint = body.ig_account_id ?? null;

    if (!messageId || !recipientId || !content || !branchId || !platform) {
      return json(400, { error: "Missing required fields: message_id, platform, recipient_id, content, branch_id" });
    }
    if (platform !== "instagram" && platform !== "messenger") {
      return json(400, { error: "invalid_platform" });
    }

    const integration = await loadIntegration(supabase, branchId, platform, igAccountIdHint);
    if (!integration) {
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", messageId);
      return json(400, { error: `No active ${platform} / meta integration found for this branch` });
    }

    const accountId = resolveAccountId(integration, platform);
    const accessToken = resolveAccessToken(integration);
    if (!accountId || !accessToken) {
      await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", messageId);
      return json(400, { error: "Missing account_id or access_token in integration credentials" });
    }

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(accountId)}/messages`;
    const payload = {
      recipient: { id: recipientId },
      message: { text: content },
      messaging_type: "RESPONSE",
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const metaErrMsg = data?.error?.message || `HTTP ${r.status}`;
      const metaErrCode = data?.error?.code;
      const metaErrSubcode = data?.error?.error_subcode;
      console.error(`[send-meta-dm] ${platform} send failed for ${recipientId}: ${metaErrMsg} (code=${metaErrCode}/${metaErrSubcode})`);
      await supabase.from("whatsapp_messages")
        .update({ status: "failed", error_message: metaErrMsg })
        .eq("id", messageId);
      try {
        await supabase.rpc("log_error_event" as any, {
          p_source: "send-meta-dm",
          p_branch_id: branchId,
          p_message: `Meta ${platform} send failed: ${metaErrMsg}`,
          p_detail: JSON.stringify({ recipientId, code: metaErrCode, subcode: metaErrSubcode, accountId }),
        });
      } catch (_) { /* best-effort */ }
      return json(502, { error: "meta_send_failed", meta_error: metaErrMsg, meta_code: metaErrCode });
    }

    const providerMessageId = data?.message_id || null;
    await supabase.from("whatsapp_messages")
      .update({
        status: "sent",
        ...(providerMessageId ? { external_message_id: providerMessageId } : {}),
      })
      .eq("id", messageId);

    return json(200, { success: true, message_id: providerMessageId });
  } catch (err: any) {
    console.error("[send-meta-dm] error:", err?.message || err);
    if (messageId) {
      try {
        await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("id", messageId);
      } catch (_) { /* ignore */ }
    }
    return json(500, { error: "internal_error", detail: err?.message || String(err) });
  }
});
