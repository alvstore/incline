// v3.0.0 — AI Reply SLA monitor. ALERT-FIRST, never conversational.
//
// v2.x shipped a deterministic "recovery ladder" (name → email → goal → plan)
// that ran every 5 minutes without ever writing what it learned. When the AI
// master switch was off, that ladder answered every inbound with the exact
// same line ("Sure — may I have your name first? ✨") over and over. That
// ladder is REMOVED.
//
// What this function does now, for each inbound with no outbound reply inside
// the SLA window:
//   1. logs a warning to System Health (log_error_event),
//   2. creates ONE front-desk task per contact per 24h so a human picks it up,
//   3. optionally sends ONE neutral holding line per contact per 24h
//      ("someone from Incline will reply shortly") — never a data-capture
//      question, never twice.
//
// Dispatched by automation-brain every 5 min.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_API_BASE, computeAppSecretProof } from "../_shared/meta-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const REPLY_SLA_MIN = 5;
const LOOKBACK_MIN = 30;
const HOLDING_COOLDOWN_HOURS = 24;

const HOLDING_LINE =
  "Thanks for reaching out to Incline ✨ Someone from our team will reply to you shortly.";

interface StuckRow {
  id: string;
  branch_id: string;
  phone_number: string;
  platform: string;
  content: string | null;
  contact_name: string | null;
  created_at: string;
}

async function findStuckInbounds(): Promise<StuckRow[]> {
  const since = new Date(Date.now() - LOOKBACK_MIN * 60_000).toISOString();
  const slaCutoff = new Date(Date.now() - REPLY_SLA_MIN * 60_000).toISOString();

  const { data: inbounds, error } = await supabase
    .from("whatsapp_messages")
    .select("id, branch_id, phone_number, platform, content, contact_name, created_at")
    .eq("direction", "inbound")
    .gte("created_at", since)
    .lte("created_at", slaCutoff)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`inbound fetch failed: ${error.message}`);
  if (!inbounds?.length) return [];

  const stuck: StuckRow[] = [];
  const seenPhones = new Set<string>();
  for (const row of inbounds as StuckRow[]) {
    // Only the most recent stuck inbound per contact matters.
    if (seenPhones.has(row.phone_number)) continue;

    const { data: outRows } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("phone_number", row.phone_number)
      .eq("direction", "outbound")
      .gte("created_at", row.created_at)
      .limit(1);
    if (outRows && outRows.length > 0) continue;

    const { data: settings } = await supabase
      .from("whatsapp_chat_settings")
      .select("bot_active, do_not_contact")
      .eq("phone_number", row.phone_number)
      .maybeSingle();
    if (settings && (settings.bot_active === false || settings.do_not_contact === true)) continue;

    seenPhones.add(row.phone_number);
    stuck.push(row);
  }
  return stuck;
}

async function logLeadLoss(row: StuckRow, action: string) {
  try {
    await supabase.rpc("log_error_event", {
      p_source: "ai_lead_loss",
      p_severity: "warning",
      p_message: `No AI reply within ${REPLY_SLA_MIN}m on ${row.platform} ${row.phone_number} (${action})`,
      p_context: {
        branch_id: row.branch_id,
        platform: row.platform,
        phone: row.phone_number,
        message_id: row.id,
        inbound_at: row.created_at,
        action,
      },
    });
  } catch (e) {
    console.warn("[monitor-ai-lead-loss] log_error_event failed:", (e as Error).message);
  }
}

/** True when this contact already got a holding line or task in the cooldown window. */
async function alreadyHandledRecently(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - HOLDING_COOLDOWN_HOURS * 3600_000).toISOString();

  // A holding line already sent?
  const { data: msgs } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", phone)
    .eq("direction", "outbound")
    .eq("content", HOLDING_LINE)
    .gte("created_at", since)
    .limit(1);
  if (msgs && msgs.length > 0) return true;

  // A front-desk task already open?
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id")
    .ilike("title", `%${phone}%`)
    .gte("created_at", since)
    .limit(1);
  return !!(tasks && tasks.length > 0);
}

async function createFrontDeskTask(row: StuckRow) {
  try {
    await supabase.from("tasks").insert({
      branch_id: row.branch_id,
      title: `Unanswered ${row.platform} message — ${row.phone_number}`,
      description:
        `The AI concierge did not reply within ${REPLY_SLA_MIN} minutes.\n\n` +
        `Contact: ${row.contact_name || "Unknown"} (${row.phone_number})\n` +
        `Message: ${row.content || "(no text)"}\n` +
        `Received: ${row.created_at}`,
      status: "pending",
      priority: "high",
      due_date: new Date().toISOString().slice(0, 10), // `due_date` is a DATE column
      sla_hours: 2,
    });
  } catch (e) {
    console.warn("[monitor-ai-lead-loss] task insert failed:", (e as Error).message);
  }
}

async function getIntegration(branchId: string) {
  const { data: branchInt } = await supabase
    .from("integration_settings")
    .select("branch_id, config, credentials")
    .eq("branch_id", branchId)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (branchInt) return branchInt as any;
  const { data: globalInt } = await supabase
    .from("integration_settings")
    .select("branch_id, config, credentials")
    .is("branch_id", null)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return (globalInt as any) || null;
}

/** Sends the single neutral holding line. No questions, no funnel, no repeats. */
async function sendHoldingLine(row: StuckRow): Promise<{ ok: boolean; reason: string }> {
  if (row.platform && row.platform !== "whatsapp") {
    return { ok: false, reason: "non_whatsapp_platform" };
  }

  const lockKey = `ai_holding:${row.phone_number}`;
  try {
    const { data: gotLock } = await supabase.rpc("try_whatsapp_send_lock", {
      _phone: lockKey,
      _ttl_seconds: 120,
    });
    if (gotLock === false) return { ok: false, reason: "lock_held" };
  } catch (e) {
    console.warn("[monitor-ai-lead-loss] lock RPC failed:", (e as Error).message);
  }

  // Re-check under the lock — the webhook may have replied in the meantime.
  const { data: outRows } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", row.phone_number)
    .eq("direction", "outbound")
    .gte("created_at", row.created_at)
    .limit(1);
  if (outRows && outRows.length > 0) return { ok: false, reason: "outbound_appeared" };

  const integration = await getIntegration(row.branch_id);
  if (!integration) return { ok: false, reason: "no_integration" };
  const accessToken = integration.credentials?.access_token as string;
  const phoneNumberId = integration.config?.phone_number_id as string;
  const appSecret = (integration.credentials?.app_secret as string) || null;
  if (!accessToken || !phoneNumberId) return { ok: false, reason: "missing_credentials" };

  const cleanPhone = row.phone_number.replace(/[\s\-\+]/g, "");
  let metaUrl = `${META_API_BASE}/${phoneNumberId}/messages`;
  if (appSecret) {
    const proof = await computeAppSecretProof(accessToken, appSecret);
    metaUrl += `?appsecret_proof=${proof}`;
  }

  const { data: aiMsg } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: row.branch_id,
      phone_number: row.phone_number,
      contact_name: row.contact_name,
      content: HOLDING_LINE,
      direction: "outbound",
      status: "pending",
      message_type: "text",
    })
    .select("id")
    .single();

  let metaResp: Response | null = null;
  let metaData: any = null;
  try {
    metaResp = await fetch(metaUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "text",
        text: { body: HOLDING_LINE },
      }),
    });
    metaData = await metaResp.json();
  } catch (e) {
    if (aiMsg?.id) {
      await supabase.from("whatsapp_messages").update({
        status: "failed",
        failure_reason: `holding exception: ${(e as Error).message}`.slice(0, 500),
        failed_at: new Date().toISOString(),
      }).eq("id", aiMsg.id);
    }
    return { ok: false, reason: "meta_exception" };
  }

  const ok = !!metaResp && metaResp.ok;
  if (aiMsg?.id) {
    if (ok) {
      await supabase.from("whatsapp_messages").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        whatsapp_message_id: metaData?.messages?.[0]?.id || null,
      }).eq("id", aiMsg.id);
    } else {
      await supabase.from("whatsapp_messages").update({
        status: "failed",
        failure_reason: `holding meta: ${JSON.stringify(metaData?.error || metaData || {}).slice(0, 500)}`,
        failure_code: String(metaData?.error?.code ?? ""),
        failed_at: new Date().toISOString(),
      }).eq("id", aiMsg.id);
    }
  }
  return { ok, reason: ok ? "holding_sent" : `meta_${metaResp?.status ?? "unknown"}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  try {
    const stuck = await findStuckInbounds();
    let notified = 0;
    let skipped = 0;
    for (const row of stuck) {
      if (await alreadyHandledRecently(row.phone_number)) {
        await logLeadLoss(row, "already_handled_within_24h");
        skipped++;
        continue;
      }
      await createFrontDeskTask(row);
      const r = await sendHoldingLine(row);
      await logLeadLoss(row, r.reason);
      if (r.ok) notified++; else skipped++;
    }
    const summary = {
      ok: true,
      took_ms: Date.now() - started,
      sla_min: REPLY_SLA_MIN,
      stuck: stuck.length,
      notified,
      skipped,
    };
    console.log("[monitor-ai-lead-loss]", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[monitor-ai-lead-loss] fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
