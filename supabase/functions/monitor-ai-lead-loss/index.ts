// v2.0.0 — AI Reply SLA monitor + SAFE RECOVERY.
//          Detects inbound WhatsApp/IG/Messenger messages where the bot is
//          active but no outbound reply was sent within the SLA window, then
//          ATTEMPTS A DETERMINISTIC RECOVERY (never invokes the LLM) so a
//          lead is not left mid-conversation because of an isolated send-path
//          exception. Idempotent via `ai_recover:<message_id>` lock.
//
// Recovery rules (lead-capture funnel, mirrors ai-agent-brain.ts v4.0.0):
//   - missing name           → "Sure — may I have your name first? ✨"
//   - have name, no email    → ask email
//   - have name+email, no goal       → fitness goal interactive list
//   - have name+email+goal, no plan  → membership-duration interactive list
//   - all four captured              → Founding Member CTA / soft acknowledge
// Members get a single safe "give me one sec" text and a high-severity log
// so staff can pick up.
//
// v1.0.x was alert-only. Dispatched by automation-brain every 5 min.
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
  for (const row of inbounds as StuckRow[]) {
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

    stuck.push(row);
  }
  return stuck;
}

async function logLeadLoss(row: StuckRow, recovered: boolean, recoveryReason: string) {
  try {
    await supabase.rpc("log_error_event", {
      p_source: "ai_lead_loss",
      p_severity: recovered ? "info" : "warning",
      p_message: recovered
        ? `Recovered stuck ${row.platform} thread for ${row.phone_number}`
        : `No AI reply within ${REPLY_SLA_MIN}m on ${row.platform} ${row.phone_number}`,
      p_context: {
        branch_id: row.branch_id,
        platform: row.platform,
        phone: row.phone_number,
        message_id: row.id,
        inbound_at: row.created_at,
        recovered,
        recovery_reason: recoveryReason,
      },
    });
  } catch (e) {
    console.warn("[monitor-ai-lead-loss] log_error_event failed:", (e as Error).message);
  }
}

// ─── Deterministic next-step builder (no LLM) ───────────────────────────────────

function firstNameOf(full?: string | null): string {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

function buildDeterministicReply(memory: any | null): { text: string; interactive?: any } {
  const profile = memory?.profile || {};
  const facts = memory?.facts || {};
  const rawName = profile.full_name || profile.first_name || profile.name || "";
  const fn = firstNameOf(rawName);
  const hasName = !!rawName;
  const hasEmail = !!profile.email;
  const hasGoal = !!(facts.fitness_goal || facts.goal);
  const hasPlan = !!facts.plan_interest;

  if (!hasName) return { text: "Sure — may I have your name first? ✨" };
  if (!hasEmail) {
    return {
      text: fn
        ? `Thanks, ${fn} — what's the best email for your Founding Member invite? ✨`
        : "Could you share your email for your Founding Member invite? ✨",
    };
  }
  if (!hasGoal) {
    return {
      text: fn ? `Got it, ${fn} — what's your main fitness goal?` : "What's your main fitness goal?",
      interactive: {
        type: "list",
        body: { text: fn ? `Got it, ${fn} — what's your main fitness goal?` : "What's your main fitness goal?" },
        action: {
          button: "Choose goal",
          sections: [{
            title: "Fitness Goal",
            rows: [
              { id: "weight_loss", title: "Weight Loss" },
              { id: "muscle_gain", title: "Muscle Gain" },
              { id: "endurance", title: "Endurance" },
              { id: "general", title: "Flexibility / General" },
            ],
          }],
        },
      },
    };
  }
  if (!hasPlan) {
    return {
      text: fn ? `Perfect, ${fn} — which membership duration are you thinking about?` : "Which membership duration are you thinking about?",
      interactive: {
        type: "list",
        body: { text: fn ? `Perfect, ${fn} — which membership duration are you thinking about?` : "Which membership duration are you thinking about?" },
        action: {
          button: "Choose duration",
          sections: [{
            title: "Membership Duration",
            rows: [
              { id: "monthly", title: "Monthly" },
              { id: "quarterly", title: "Quarterly" },
              { id: "half_yearly", title: "Half-Yearly" },
              { id: "annual", title: "Annual — Founding Member" },
            ],
          }],
        },
      },
    };
  }
  // Fully captured — soft acknowledge so the lead doesn't feel abandoned.
  const plan = String(facts.plan_interest || "").toLowerCase();
  const isAnnual = /annual|yearly|12\s*month/.test(plan);
  return {
    text: isAnnual
      ? (fn
          ? `Perfect ${fn} — Founding Member (Annual) is our only active enrollment right now with launch-day perks. Want our team to lock in your Founding spot? ✨`
          : "Founding Member (Annual) is our only active enrollment right now with launch-day perks. Want our team to lock in your Founding spot? ✨")
      : (fn
          ? `Noted ${fn} — I've logged your interest. Our team will share full plan options closer to launch. ✨`
          : "Noted — I've logged your interest. Our team will share full plan options closer to launch. ✨"),
  };
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

async function attemptRecovery(row: StuckRow): Promise<{ ok: boolean; reason: string }> {
  // Only WhatsApp recovery is implemented — IG/Messenger uses a different
  // send path and is left to the alert-only behaviour for now.
  if (row.platform && row.platform !== "whatsapp") {
    return { ok: false, reason: "non_whatsapp_platform" };
  }

  // Idempotent recovery lock keyed by inbound message id. Reuses the existing
  // whatsapp_send_lock RPC — if any other worker (or a fresh webhook retry)
  // is sending right now, we back off.
  const recoveryKey = `ai_recover:${row.id}`;
  try {
    const { data: gotLock } = await supabase.rpc("try_whatsapp_send_lock", {
      _phone: recoveryKey,
      _ttl_seconds: 60,
    });
    if (gotLock === false) return { ok: false, reason: "recovery_lock_held" };
  } catch (e) {
    console.warn("[monitor-ai-lead-loss] recovery lock RPC failed:", (e as Error).message);
  }

  // Re-check outbound state under the lock to avoid double-sending.
  const { data: outRows } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", row.phone_number)
    .eq("direction", "outbound")
    .gte("created_at", row.created_at)
    .limit(1);
  if (outRows && outRows.length > 0) return { ok: false, reason: "outbound_appeared_post_lock" };

  // Build deterministic reply from memory.
  const { data: memory } = await supabase
    .from("ai_memory")
    .select("profile, facts")
    .eq("platform", "whatsapp")
    .eq("contact_key", row.phone_number)
    .limit(1)
    .maybeSingle();
  const reply = buildDeterministicReply(memory);

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

  const metaBody: any = {
    messaging_product: "whatsapp",
    to: cleanPhone,
  };
  if (reply.interactive) {
    metaBody.type = "interactive";
    metaBody.interactive = reply.interactive;
  } else {
    metaBody.type = "text";
    metaBody.text = { body: reply.text };
  }

  // Insert outbound row first (mirrors sendAiReply ordering since v6.2).
  const { data: aiMsg } = await supabase
    .from("whatsapp_messages")
    .insert({
      branch_id: row.branch_id,
      phone_number: row.phone_number,
      contact_name: row.contact_name,
      content: reply.text,
      direction: "outbound",
      status: "pending",
      message_type: reply.interactive ? "interactive" : "text",
    })
    .select("id")
    .single();

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
    if (aiMsg?.id) {
      await supabase.from("whatsapp_messages").update({
        status: "failed",
        failure_reason: `recovery exception: ${(e as Error).message}`.slice(0, 500),
        failed_at: new Date().toISOString(),
      }).eq("id", aiMsg.id);
    }
    return { ok: false, reason: `meta_exception` };
  }

  const wamid = metaData?.messages?.[0]?.id || null;
  const ok = !!metaResp && metaResp.ok;
  if (aiMsg?.id) {
    if (ok) {
      await supabase.from("whatsapp_messages").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        whatsapp_message_id: wamid,
      }).eq("id", aiMsg.id);
    } else {
      await supabase.from("whatsapp_messages").update({
        status: "failed",
        failure_reason: `recovery meta: ${JSON.stringify(metaData?.error || metaData || {}).slice(0, 500)}`,
        failure_code: String(metaData?.error?.code ?? ""),
        failed_at: new Date().toISOString(),
      }).eq("id", aiMsg.id);
    }
  }

  return { ok, reason: ok ? "recovered" : `meta_${metaResp?.status ?? "unknown"}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  try {
    const stuck = await findStuckInbounds();
    let recovered = 0;
    let failed = 0;
    for (const row of stuck) {
      const r = await attemptRecovery(row);
      await logLeadLoss(row, r.ok, r.reason);
      if (r.ok) recovered++; else failed++;
    }
    const summary = {
      ok: true,
      took_ms: Date.now() - started,
      sla_min: REPLY_SLA_MIN,
      stuck: stuck.length,
      recovered,
      failed,
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
