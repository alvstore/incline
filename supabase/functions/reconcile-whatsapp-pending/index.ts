// v2.0.0 (Phase 1 — provider outcome safety)
// Reaper for outbound WhatsApp rows stuck at status='pending'.
//
// SAFETY CONTRACT — an unknown provider outcome MUST NOT become a resend:
//   • provider_attempted_at IS NULL  → the request never left this worker.
//                                      Replaying it is safe and idempotent.
//   • provider_attempted_at IS NOT NULL → the request may have reached Meta and
//                                      the response was lost. The row parks as
//                                      `unknown`. We never resend, never mark it
//                                      succeeded, and never mark it failed.
// Elapsed time is NEVER treated as evidence of delivery or of failure.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_API_BASE, computeAppSecretProof } from "../_shared/meta-config.ts";
import { classifyMetaError } from "../_shared/metaErrorPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_PER_TICK = 100;
const MIN_AGE_SECONDS = 180; // wait 3 min before reaping (gives original send a chance)
const MAX_AGE_HOURS = 24;    // beyond Meta's freeform window — stop reaping


interface PendingRow {
  id: string;
  branch_id: string;
  phone_number: string;
  contact_name: string | null;
  content: string;
  message_type: string;
  created_at: string;
  provider_attempted_at: string | null;
  provider_ack_state: string | null;
}


interface Integration {
  branch_id: string | null;
  config: Record<string, any>;
  credentials: Record<string, any>;
}

async function getIntegration(branchId: string): Promise<Integration | null> {
  const { data: branchInt } = await supabase
    .from("integration_settings")
    .select("branch_id, config, credentials")
    .eq("branch_id", branchId)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (branchInt) return branchInt as Integration;

  const { data: globalInt } = await supabase
    .from("integration_settings")
    .select("branch_id, config, credentials")
    .is("branch_id", null)
    .eq("integration_type", "whatsapp")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return (globalInt as Integration) || null;
}

async function mirrorLog(row: PendingRow, ok: boolean, wamid: string | null, errorText: string | null, metaStatus: number | null) {
  try {
    const cleanPhone = row.phone_number.replace(/[\s\-\+]/g, "");
    await supabase.from("communication_logs").insert({
      branch_id: row.branch_id,
      type: "whatsapp",
      channel: "whatsapp",
      category: "ai_auto_reply",
      recipient: cleanPhone,
      content: (row.content || "").slice(0, 2000),
      status: ok ? "sent" : "failed",
      delivery_status: ok ? "sent" : "failed",
      provider_message_id: wamid,
      error_message: errorText,
      dedupe_key: `ai_reply:${row.id}`,
      delivery_metadata: {
        ai_message_id: row.id,
        platform: "whatsapp",
        meta_response_code: metaStatus,
        recovered_by: "reconcile-whatsapp-pending",
      },
    });
  } catch (e) {
    console.warn("[reconciler] mirror log failed:", (e as Error).message);
  }
}

async function retryOne(row: PendingRow): Promise<{ ok: boolean; reason: string }> {
  const integration = await getIntegration(row.branch_id);
  if (!integration) {
    console.log(`[reconciler] skip row=${row.id} branch=${row.branch_id} reason=no_integration`);
    return { ok: false, reason: "no_integration" };
  }

  const accessToken = integration.credentials?.access_token as string;
  const phoneNumberId = integration.config?.phone_number_id as string;
  const appSecret = (integration.credentials?.app_secret as string) || null;
  if (!accessToken || !phoneNumberId) {
    console.log(`[reconciler] skip row=${row.id} reason=incomplete_credentials`);
    return { ok: false, reason: "incomplete_credentials" };
  }

  const cleanPhone = row.phone_number.replace(/[\s\-\+]/g, "");

  // Acquire send-lock so we never race a parallel send
  try {
    const { data: gotLock } = await supabase.rpc("try_whatsapp_send_lock", {
      _phone: cleanPhone,
      _ttl_seconds: 8,
    });
    if (gotLock === false) {
      console.log(`[reconciler] skip row=${row.id} reason=lock_held`);
      return { ok: false, reason: "lock_held_by_another_send" };
    }
  } catch (e) {
    console.warn("[reconciler] send-lock RPC failed:", (e as Error).message);
  }

  let metaUrl = `${META_API_BASE}/${phoneNumberId}/messages`;
  if (appSecret) {
    const proof = await computeAppSecretProof(accessToken, appSecret);
    metaUrl += `?appsecret_proof=${proof}`;
  }

  const metaBody = {
    messaging_product: "whatsapp",
    to: cleanPhone,
    type: "text",
    text: { body: row.content || "" },
  };

  // Record transmission evidence before the request leaves this worker.
  await supabase.from("whatsapp_messages").update({
    provider_ack_state: "attempting",
    provider_attempted_at: new Date().toISOString(),
  }).eq("id", row.id);

  let metaResp: Response | null = null;
  let metaData: any = null;
  try {
    metaResp = await fetch(metaUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(metaBody),
    });
    metaData = await metaResp.json();
  } catch (e) {
    const err = (e as Error).message;
    const preTransmission = /dns error|error trying to connect|connection refused|failed to lookup/i.test(err);
    const pol = classifyMetaError({ networkError: err, transmitted: !preTransmission });
    if (preTransmission) {
      // Never transmitted: leave the row pending so the next tick may replay it.
      await supabase.from("whatsapp_messages").update({
        provider_ack_state: "not_transmitted",
        failure_reason: `not_transmitted: ${err}`.slice(0, 500),
      }).eq("id", row.id);
      return { ok: false, reason: `not_transmitted: ${err}` };
    }
    // Response lost after transmission — outcome unknown, never resend.
    await supabase.from("whatsapp_messages").update({
      status: "unknown",
      provider_ack_state: "response_lost",
      failure_reason: `${pol.description}`.slice(0, 500),
    }).eq("id", row.id);
    return { ok: false, reason: "unknown_response_lost" };
  }

  const wamid = metaData?.messages?.[0]?.id || null;
  const ok = metaResp.ok;

  if (ok) {
    await supabase.from("whatsapp_messages").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      whatsapp_message_id: wamid,
      provider_ack_state: "accepted",
    }).eq("id", row.id);
    await mirrorLog(row, true, wamid, null, metaResp.status);
    return { ok: true, reason: "sent" };
  } else {
    // Provider RESPONDED with a rejection — this is real evidence.
    const reason = `reconciler meta: ${JSON.stringify(metaData?.error || metaData || {}).slice(0, 500)}`;
    const code = String(metaData?.error?.code ?? "");
    await supabase.from("whatsapp_messages").update({
      status: "failed",
      failure_reason: reason,
      failure_code: code || null,
      failed_at: new Date().toISOString(),
      provider_ack_state: "rejected",
    }).eq("id", row.id);
    await mirrorLog(row, false, null, reason, metaResp.status);
    return { ok: false, reason };
  }
}

/**
 * Rows that already carry transmission evidence must never be resent, and
 * elapsed time is not evidence of failure — they park as `unknown`.
 */
async function parkAmbiguous() {
  const cutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString();
  const { data, error } = await supabase.from("whatsapp_messages")
    .update({
      status: "unknown",
      provider_ack_state: "response_lost",
      failure_reason: "provider response never observed — outcome unknown, not resent",
    })
    .eq("direction", "outbound")
    .eq("status", "pending")
    .is("whatsapp_message_id", null)
    .not("provider_attempted_at", "is", null)
    .lt("provider_attempted_at", cutoff)
    .select("id");
  if (error) console.warn("[reconciler] parkAmbiguous error:", error.message);
  return (data || []).length;
}

async function expireStale() {
  // Older than 24h AND never transmitted — the send definitively never happened.
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from("whatsapp_messages")
    .update({
      status: "failed",
      failure_reason: "reconciler: never transmitted, freeform window expired",
      failed_at: new Date().toISOString(),
      provider_ack_state: "not_transmitted",
    })
    .eq("direction", "outbound")
    .eq("status", "pending")
    .is("whatsapp_message_id", null)
    .is("provider_attempted_at", null)
    .lt("created_at", cutoff)
    .select("id");
  if (error) console.warn("[reconciler] expireStale error:", error.message);
  return (data || []).length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const ageCutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString();
    const maxCutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

    // ONLY rows with no transmission evidence are replay candidates.
    const { data: rows, error } = await supabase
      .from("whatsapp_messages")
      .select("id, branch_id, phone_number, contact_name, content, message_type, created_at, provider_attempted_at, provider_ack_state")
      .eq("direction", "outbound")
      .eq("status", "pending")
      .is("whatsapp_message_id", null)
      .is("provider_attempted_at", null)
      .lt("created_at", ageCutoff)
      .gte("created_at", maxCutoff)
      .order("created_at", { ascending: true })
      .limit(MAX_PER_TICK);

    if (error) throw error;

    const candidates = (rows || []) as PendingRow[];
    const results = { reaped: 0, sent: 0, failed: 0, skipped: 0, expired: 0, parked_unknown: 0 };

    for (const row of candidates) {
      results.reaped++;
      const r = await retryOne(row);
      if (r.ok) results.sent++;
      else if (r.reason.startsWith("lock_held") || r.reason === "no_integration" || r.reason === "incomplete_credentials" || r.reason.startsWith("not_transmitted")) results.skipped++;
      else results.failed++;
    }

    results.parked_unknown = await parkAmbiguous();
    results.expired = await expireStale();


    const body = { ok: true, took_ms: Date.now() - startedAt, ...results };
    console.log("[reconcile-whatsapp-pending]", JSON.stringify(body));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[reconcile-whatsapp-pending] fatal:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
