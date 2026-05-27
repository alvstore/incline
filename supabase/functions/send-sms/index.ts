// v2.0.0 — Multi-provider SMS Edge Function with RoundSMS full API
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- AUTH GATE (v2.1.0) ----
    // Allow internal service-role callers (dispatch-communication, send-broadcast, etc.)
    // OR authenticated staff/manager/admin/owner JWTs.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const isService = bearer && bearer === SUPABASE_SERVICE_ROLE_KEY;
    if (!isService) {
      if (!bearer) {
        return json({ error: "Unauthorized" }, 401);
      }
      const { data: userRes } = await supabase.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", uid);
      const allowed = new Set(["owner", "admin", "manager", "staff"]);
      const hasRole = (roles || []).some((r: any) => allowed.has(r.role));
      if (!hasRole) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json();
    const { action = "send", phone, message, branch_id, provider: providerOverride } = body;


    // Get active SMS integration
    let query = supabase
      .from("integration_settings")
      .select("*")
      .eq("integration_type", "sms")
      .eq("is_active", true);

    if (providerOverride) {
      query = query.eq("provider", providerOverride);
    }

    const { data: integrations, error: intError } = await query.limit(1);
    if (intError || !integrations?.length) {
      return json({ error: "No active SMS provider configured" }, 400);
    }

    const integration = integrations[0];
    const config = integration.config || {};
    const credentials = integration.credentials || {};
    const provider = integration.provider;

    // Route based on action
    switch (action) {
      case "send": {
        if (!phone || !message) return json({ error: "Missing phone or message" }, 400);
        let result: { success: boolean; message_id?: string; error?: string };
        switch (provider) {
          case "roundsms": result = await sendRoundSMS(phone, message, config, credentials); break;
          case "msg91": result = await sendMSG91(phone, message, config, credentials); break;
          case "twilio": result = await sendTwilio(phone, message, config, credentials); break;
          case "textlocal": result = await sendTextLocal(phone, message, config, credentials); break;
          case "fast2sms": result = await sendFast2SMS(phone, message, config, credentials); break;
          default: result = { success: false, error: `Unsupported provider: ${provider}` };
        }
        await supabase.from("sms_logs").insert({
          phone, message, status: result.success ? "sent" : "failed",
          message_id: result.message_id || null, provider, branch_id: branch_id || null,
          error_message: result.error || null,
        });
        return result.success
          ? json({ success: true, message_id: result.message_id })
          : json({ error: result.error || "SMS sending failed" }, 500);
      }

      case "schedule": {
        if (provider !== "roundsms") return json({ error: "Schedule only supported for RoundSMS" }, 400);
        if (!phone || !message || !body.time) return json({ error: "Missing phone, message, or time" }, 400);
        const result = await scheduleRoundSMS(phone, message, body.time, config, credentials);
        await supabase.from("sms_logs").insert({
          phone, message, status: result.success ? "scheduled" : "failed",
          message_id: result.message_id || null, provider, branch_id: branch_id || null,
          error_message: result.error || null,
        });
        return result.success
          ? json({ success: true, message_id: result.message_id })
          : json({ error: result.error }, 500);
      }

      case "balance": {
        if (provider !== "roundsms") return json({ error: "Balance check only supported for RoundSMS" }, 400);
        const result = await checkRoundSMSBalance(config, credentials);
        return json(result);
      }

      case "senderids": {
        if (provider !== "roundsms") return json({ error: "Sender IDs only supported for RoundSMS" }, 400);
        const result = await getRoundSMSSenderIds(config, credentials);
        return json(result);
      }

      case "add_senderid": {
        if (provider !== "roundsms") return json({ error: "Add sender ID only supported for RoundSMS" }, 400);
        if (!body.senderid || !body.type) return json({ error: "Missing senderid or type" }, 400);
        const result = await addRoundSMSSenderId(body.senderid, body.type, config, credentials);
        return json(result);
      }

      case "delivery_report": {
        if (provider !== "roundsms") return json({ error: "DLR only supported for RoundSMS" }, 400);
        if (!body.msgid || !body.phone || !body.msgtype) return json({ error: "Missing msgid, phone, or msgtype" }, 400);
        const result = await getRoundSMSDeliveryReport(body.msgid, body.phone, body.msgtype, config, credentials);
        return json(result);
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    await captureEdgeError('send-sms', error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

// === RoundSMS Functions ===

function roundBaseUrl(config: Record<string, string>) {
  return config.api_base_url || config.api_url || "http://voice.roundsms.co/api";
}

function roundAuthParams(credentials: Record<string, string>) {
  return `user=${encodeURIComponent(credentials.username || "")}&pass=${encodeURIComponent(credentials.password || "")}`;
}

async function sendRoundSMS(phone: string, message: string, config: Record<string, string>, credentials: Record<string, string>) {
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  const base = roundBaseUrl(config);
  const endpoint = config.send_endpoint || "/sendmsg.php";
  const priority = config.priority || "ndnd";
  const stype = config.stype || config.sms_type || "normal";
  const url = `${base}${endpoint}?${roundAuthParams(credentials)}&sender=${encodeURIComponent(config.sender_id || "")}&phone=${cleanPhone}&text=${encodeURIComponent(message)}&priority=${priority}&stype=${stype}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    if (text.startsWith("S.")) return { success: true, message_id: text.trim() };
    return { success: false, error: `RoundSMS error: ${text.trim()}` };
  } catch (e) { return { success: false, error: `RoundSMS fetch failed: ${(e as Error).message}` }; }
}

async function scheduleRoundSMS(phone: string, message: string, time: string, config: Record<string, string>, credentials: Record<string, string>) {
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  const base = roundBaseUrl(config);
  const endpoint = config.schedule_endpoint || "/schedulemsg.php";
  const priority = config.priority || "ndnd";
  const stype = config.stype || config.sms_type || "normal";
  const url = `${base}${endpoint}?${roundAuthParams(credentials)}&sender=${encodeURIComponent(config.sender_id || "")}&phone=${cleanPhone}&text=${encodeURIComponent(message)}&priority=${priority}&stype=${stype}&time=${encodeURIComponent(time)}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    if (text.startsWith("S.")) return { success: true, message_id: text.trim() };
    return { success: false, error: `Schedule error: ${text.trim()}` };
  } catch (e) { return { success: false, error: `Schedule failed: ${(e as Error).message}` }; }
}

async function checkRoundSMSBalance(config: Record<string, string>, credentials: Record<string, string>) {
  const base = roundBaseUrl(config);
  const endpoint = config.balance_endpoint || "/checkbalance.php";
  const url = `${base}${endpoint}?${roundAuthParams(credentials)}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return { success: true, balance: text.trim() };
  } catch (e) { return { success: false, error: `Balance check failed: ${(e as Error).message}` }; }
}

async function getRoundSMSSenderIds(config: Record<string, string>, credentials: Record<string, string>) {
  const base = roundBaseUrl(config);
  const endpoint = config.senderids_endpoint || "/getsenderids.php";
  const url = `${base}${endpoint}?${roundAuthParams(credentials)}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return { success: true, sender_ids: text.trim() };
  } catch (e) { return { success: false, error: `Sender IDs failed: ${(e as Error).message}` }; }
}

async function addRoundSMSSenderId(senderId: string, type: string, config: Record<string, string>, credentials: Record<string, string>) {
  const base = roundBaseUrl(config);
  const endpoint = config.addsenderid_endpoint || "/addsenderid.php";
  const url = `${base}${endpoint}?${roundAuthParams(credentials)}&senderid=${encodeURIComponent(senderId)}&type=${encodeURIComponent(type)}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return { success: true, response: text.trim() };
  } catch (e) { return { success: false, error: `Add Sender ID failed: ${(e as Error).message}` }; }
}

async function getRoundSMSDeliveryReport(msgid: string, phone: string, msgtype: string, config: Record<string, string>, credentials: Record<string, string>) {
  const base = roundBaseUrl(config);
  const endpoint = config.dlr_endpoint || "/recdlr.php";
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  const url = `${base}${endpoint}?${roundAuthParams(credentials)}&msgid=${encodeURIComponent(msgid)}&phone=${cleanPhone}&msgtype=${encodeURIComponent(msgtype)}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return { success: true, report: text.trim() };
  } catch (e) { return { success: false, error: `DLR failed: ${(e as Error).message}` }; }
}

// === Other Providers (unchanged) ===

async function sendMSG91(phone: string, message: string, config: Record<string, string>, credentials: Record<string, string>) {
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  try {
    const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: credentials.auth_key || "" },
      body: JSON.stringify({ sender: config.sender_id, route: config.route || "4", DLT_TE_ID: config.dlt_template_id, mobiles: `91${cleanPhone}`, message }),
    });
    const data = await resp.json();
    return data.type === "success" ? { success: true, message_id: data.request_id } : { success: false, error: data.message || "MSG91 error" };
  } catch (e) { return { success: false, error: `MSG91 failed: ${(e as Error).message}` }; }
}

async function sendTwilio(phone: string, message: string, config: Record<string, string>, credentials: Record<string, string>) {
  const sid = credentials.account_sid;
  const token = credentials.auth_token;
  const from = config.from_number;
  const to = phone.startsWith("+") ? phone : `+91${phone.replace(/^91/, "")}`;
  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from || "", Body: message }),
    });
    const data = await resp.json();
    return data.sid ? { success: true, message_id: data.sid } : { success: false, error: data.message || "Twilio error" };
  } catch (e) { return { success: false, error: `Twilio failed: ${(e as Error).message}` }; }
}

async function sendTextLocal(phone: string, message: string, _config: Record<string, string>, credentials: Record<string, string>) {
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  try {
    const resp = await fetch("https://api.textlocal.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ apikey: credentials.api_key || "", numbers: `91${cleanPhone}`, message }),
    });
    const data = await resp.json();
    return data.status === "success" ? { success: true, message_id: data.batch_id } : { success: false, error: JSON.stringify(data.errors || data) };
  } catch (e) { return { success: false, error: `TextLocal failed: ${(e as Error).message}` }; }
}

async function sendFast2SMS(phone: string, message: string, config: Record<string, string>, credentials: Record<string, string>) {
  const cleanPhone = phone.replace(/^(\+?91)/, "");
  try {
    const resp = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: { Authorization: credentials.api_key || "", "Content-Type": "application/json" },
      body: JSON.stringify({ route: config.route || "dlt", sender_id: config.sender_id, message: config.dlt_template_id, variables_values: message, flash: 0, numbers: cleanPhone }),
    });
    const data = await resp.json();
    return data.return ? { success: true, message_id: data.request_id } : { success: false, error: data.message?.[0] || "Fast2SMS error" };
  } catch (e) { return { success: false, error: `Fast2SMS failed: ${(e as Error).message}` }; }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
