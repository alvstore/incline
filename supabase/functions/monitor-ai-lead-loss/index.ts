// v1.0.1 — AI Reply SLA monitor (observability-only). Detects inbound
// WhatsApp/IG/Messenger messages where the bot is active but no outbound
// reply was sent within the SLA window. Writes a deduped error_logs warning
// per stuck contact so SystemHealth surfaces silent lead-loss in near real-time.
// Auto-recovery via re-invoke is intentionally NOT done here to avoid
// duplicate replies — operators see the alert and can manually re-engage.
//
// Dispatched by automation-brain every 5 min (rule: monitor_ai_lead_loss).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// SLA: an inbound message must get an outbound (any direction='outbound') reply
// within REPLY_SLA_MIN minutes when the bot is active and the contact is not
// flagged do_not_contact. We only look at the last LOOKBACK_MIN minutes.
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

  // Pull recent inbound messages older than the SLA cutoff.
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
    // Was there an outbound to the same phone after this inbound?
    const { data: outRows } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("phone_number", row.phone_number)
      .eq("direction", "outbound")
      .gte("created_at", row.created_at)
      .limit(1);
    if (outRows && outRows.length > 0) continue;

    // Bot must be active for this contact.
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

async function logLeadLoss(row: StuckRow) {
  try {
    await supabase.rpc("log_error_event", {
      p_source: "ai_lead_loss",
      p_severity: "warning",
      p_message: `No AI reply within ${REPLY_SLA_MIN}m on ${row.platform} ${row.phone_number}`,
      p_context: {
        branch_id: row.branch_id,
        platform: row.platform,
        phone: row.phone_number,
        message_id: row.id,
        inbound_at: row.created_at,
      },
    });
  } catch (e) {
    console.warn("[monitor-ai-lead-loss] log_error_event failed:", (e as Error).message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  try {
    const stuck = await findStuckInbounds();
    for (const row of stuck) await logLeadLoss(row);
    const summary = {
      ok: true,
      took_ms: Date.now() - started,
      sla_min: REPLY_SLA_MIN,
      stuck: stuck.length,
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
