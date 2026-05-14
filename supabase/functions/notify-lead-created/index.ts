// v1.2.0 — Atomic claim against duplicate sends + per-admin opt-in (lead_notification_admin_prefs).
// Called after lead creation from any source (manual, capture-lead, webhook-lead-capture)
// Reads lead_notification_rules + integration_settings to send SMS/WhatsApp to lead + team
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { META_API_BASE } from "../_shared/meta-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotificationResult {
  channel: string;
  recipient: string;
  success: boolean;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lead_id, branch_id } = await req.json();

    if (!lead_id || !branch_id) {
      return json({ error: "Missing lead_id or branch_id" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Atomic claim: only the first caller for this lead proceeds.
    // Concurrent invocations (DB trigger + edge fetch) are serialized by Postgres;
    // the loser gets 0 rows back and exits without sending.
    const { data: claimed, error: claimErr } = await supabase
      .from("leads")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", lead_id)
      .is("notified_at", null)
      .select("id, full_name, phone, email, source, branch_id")
      .maybeSingle();

    if (claimErr) {
      console.error("Lead claim error:", claimErr);
      return json({ error: "Lead claim failed" }, 500);
    }

    if (!claimed) {
      console.log(`Lead ${lead_id} already claimed by another invocation, skipping`);
      return json({ success: true, sent: 0, skipped: true, reason: "already_claimed" });
    }

    const lead = claimed;

    // 2. Fetch branch name
    const { data: branch } = await supabase
      .from("branches")
      .select("name")
      .eq("id", branch_id)
      .single();

    const branchName = branch?.name || "Our Gym";

    // 3. Fetch notification rules: branch-specific first, then global fallback
    let rules: any = null;
    const { data: branchRules } = await supabase
      .from("lead_notification_rules")
      .select("*")
      .eq("branch_id", branch_id)
      .maybeSingle();

    if (branchRules) {
      rules = branchRules;
    } else {
      const { data: globalRules } = await supabase
        .from("lead_notification_rules")
        .select("*")
        .is("branch_id", null)
        .maybeSingle();
      rules = globalRules;
    }

    if (!rules) {
      console.log("No lead notification rules configured, skipping notifications");
      return json({ success: true, sent: 0, message: "No notification rules configured" });
    }

    // Check if any channel is enabled
    const anyEnabled =
      rules.sms_to_lead || rules.whatsapp_to_lead ||
      rules.sms_to_admins || rules.whatsapp_to_admins ||
      rules.sms_to_managers || rules.whatsapp_to_managers;

    if (!anyEnabled) {
      return json({ success: true, sent: 0, message: "All notification channels disabled" });
    }

    // 4. Template placeholders
    const replacePlaceholders = (template: string): string => {
      return template
        .replace(/\{\{lead_name\}\}/g, lead.full_name || "Guest")
        .replace(/\{\{lead_phone\}\}/g, lead.phone || "")
        .replace(/\{\{lead_source\}\}/g, lead.source || "direct")
        .replace(/\{\{branch_name\}\}/g, branchName);
    };

    const results: NotificationResult[] = [];

    // 5. Resolve integrations
    const smsIntegration = await getActiveIntegration(supabase, "sms", branch_id);
    const whatsappIntegration = await getActiveIntegration(supabase, "whatsapp", branch_id);

    // 6. Send to lead
    if (rules.sms_to_lead && lead.phone && smsIntegration) {
      const msg = replacePlaceholders(rules.lead_welcome_sms);
      const r = await sendSMS(smsIntegration, lead.phone, msg);
      results.push({ channel: "sms", recipient: lead.phone, ...r });
      await logCommunication(supabase, branch_id, "sms", lead.phone, msg, r.success ? "sent" : "failed");
    }

    if (rules.whatsapp_to_lead && lead.phone && whatsappIntegration) {
      const msg = replacePlaceholders(rules.lead_welcome_whatsapp);
      const r = await sendWhatsApp(whatsappIntegration, lead.phone, msg);
      results.push({ channel: "whatsapp", recipient: lead.phone, ...r });
      await logCommunication(supabase, branch_id, "whatsapp", lead.phone, msg, r.success ? "sent" : "failed");
    }

    // 7. Send to admins (owners + admins)
    if (rules.sms_to_admins || rules.whatsapp_to_admins) {
      const { data: adminProfiles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["owner", "admin"]);

      if (adminProfiles?.length) {
        const adminUserIds = adminProfiles.map((r: any) => r.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, phone")
          .in("id", adminUserIds)
          .not("phone", "is", null);

        for (const profile of profiles || []) {
          if (rules.sms_to_admins && profile.phone && smsIntegration) {
            const msg = replacePlaceholders(rules.team_alert_sms);
            const r = await sendSMS(smsIntegration, profile.phone, msg);
            results.push({ channel: "sms", recipient: profile.phone, ...r });
            await logCommunication(supabase, branch_id, "sms", profile.phone, msg, r.success ? "sent" : "failed");
          }
          if (rules.whatsapp_to_admins && profile.phone && whatsappIntegration) {
            const msg = replacePlaceholders(rules.team_alert_whatsapp);
            const r = await sendWhatsApp(whatsappIntegration, profile.phone, msg);
            results.push({ channel: "whatsapp", recipient: profile.phone, ...r });
            await logCommunication(supabase, branch_id, "whatsapp", profile.phone, msg, r.success ? "sent" : "failed");
          }
        }
      }
    }

    // 8. Send to branch managers
    if (rules.sms_to_managers || rules.whatsapp_to_managers) {
      const { data: managers } = await supabase
        .from("branch_managers")
        .select("user_id")
        .eq("branch_id", branch_id);

      if (managers?.length) {
        const managerIds = managers.map((m: any) => m.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, phone")
          .in("id", managerIds)
          .not("phone", "is", null);

        for (const profile of profiles || []) {
          if (rules.sms_to_managers && profile.phone && smsIntegration) {
            const msg = replacePlaceholders(rules.team_alert_sms);
            const r = await sendSMS(smsIntegration, profile.phone, msg);
            results.push({ channel: "sms", recipient: profile.phone, ...r });
            await logCommunication(supabase, branch_id, "sms", profile.phone, msg, r.success ? "sent" : "failed");
          }
          if (rules.whatsapp_to_managers && profile.phone && whatsappIntegration) {
            const msg = replacePlaceholders(rules.team_alert_whatsapp);
            const r = await sendWhatsApp(whatsappIntegration, profile.phone, msg);
            results.push({ channel: "whatsapp", recipient: profile.phone, ...r });
            await logCommunication(supabase, branch_id, "whatsapp", profile.phone, msg, r.success ? "sent" : "failed");
          }
        }
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`Lead ${lead_id}: ${sent} sent, ${failed} failed out of ${results.length} notifications`);

    // Mark lead as notified so trigger / fallbacks won't fire again
    try {
      await supabase
        .from("leads")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", lead_id);
    } catch (e) {
      console.error("Failed to set notified_at:", e);
    }

    return json({ success: true, sent, failed, total: results.length });
  } catch (error) {
    console.error("notify-lead-created error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

// === Integration resolution: branch-specific > global fallback ===
async function getActiveIntegration(supabase: any, type: string, branchId: string) {
  // Try branch-specific first
  const { data: branchInt } = await supabase
    .from("integration_settings")
    .select("*")
    .eq("integration_type", type)
    .eq("is_active", true)
    .eq("branch_id", branchId)
    .limit(1)
    .maybeSingle();

  if (branchInt) return branchInt;

  // Fallback: global (null branch_id) or any active
  const { data: globalInt } = await supabase
    .from("integration_settings")
    .select("*")
    .eq("integration_type", type)
    .eq("is_active", true)
    .or("branch_id.is.null")
    .limit(1)
    .maybeSingle();

  if (globalInt) return globalInt;

  // Last fallback: any active integration of this type
  const { data: anyInt } = await supabase
    .from("integration_settings")
    .select("*")
    .eq("integration_type", type)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return anyInt || null;
}

// === SMS sending (mirrors send-sms logic, reads from integration_settings) ===
async function sendSMS(integration: any, phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  const config = integration.config || {};
  const credentials = integration.credentials || {};
  const provider = integration.provider;

  try {
    switch (provider) {
      case "roundsms": {
        const cleanPhone = phone.replace(/^(\+?91)/, "");
        const base = config.api_base_url || config.api_url || "http://voice.roundsms.co/api";
        const endpoint = config.send_endpoint || "/sendmsg.php";
        const auth = `user=${encodeURIComponent(credentials.username || "")}&pass=${encodeURIComponent(credentials.password || "")}`;
        const url = `${base}${endpoint}?${auth}&sender=${encodeURIComponent(config.sender_id || "")}&phone=${cleanPhone}&text=${encodeURIComponent(message)}&priority=${config.priority || "ndnd"}&stype=${config.stype || "normal"}`;
        const resp = await fetch(url);
        const text = await resp.text();
        return text.startsWith("S.") ? { success: true } : { success: false, error: `RoundSMS: ${text.trim()}` };
      }
      case "msg91": {
        const cleanPhone = phone.replace(/^(\+?91)/, "");
        const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
          method: "POST",
          headers: { "Content-Type": "application/json", authkey: credentials.auth_key || "" },
          body: JSON.stringify({ sender: config.sender_id, route: config.route || "4", DLT_TE_ID: config.dlt_template_id, mobiles: `91${cleanPhone}`, message }),
        });
        const data = await resp.json();
        return data.type === "success" ? { success: true } : { success: false, error: data.message || "MSG91 error" };
      }
      case "twilio": {
        const sid = credentials.account_sid;
        const token = credentials.auth_token;
        const to = phone.startsWith("+") ? phone : `+91${phone.replace(/^91/, "")}`;
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: to, From: config.from_number || "", Body: message }),
        });
        const data = await resp.json();
        return data.sid ? { success: true } : { success: false, error: data.message || "Twilio error" };
      }
      case "textlocal": {
        const cleanPhone = phone.replace(/^(\+?91)/, "");
        const resp = await fetch("https://api.textlocal.in/send/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ apikey: credentials.api_key || "", numbers: `91${cleanPhone}`, message }),
        });
        const data = await resp.json();
        return data.status === "success" ? { success: true } : { success: false, error: JSON.stringify(data.errors || data) };
      }
      case "fast2sms": {
        const cleanPhone = phone.replace(/^(\+?91)/, "");
        const resp = await fetch("https://www.fast2sms.com/dev/bulkV2", {
          method: "POST",
          headers: { Authorization: credentials.api_key || "", "Content-Type": "application/json" },
          body: JSON.stringify({ route: config.route || "dlt", sender_id: config.sender_id, message: config.dlt_template_id, variables_values: message, flash: 0, numbers: cleanPhone }),
        });
        const data = await resp.json();
        return data.return ? { success: true } : { success: false, error: data.message?.[0] || "Fast2SMS error" };
      }
      default:
        return { success: false, error: `Unsupported SMS provider: ${provider}` };
    }
  } catch (e) {
    return { success: false, error: `SMS send error: ${(e as Error).message}` };
  }
}

// === WhatsApp sending (mirrors send-whatsapp logic) ===
async function sendWhatsApp(integration: any, phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  const config = integration.config || {};
  const credentials = integration.credentials || {};
  const provider = integration.provider;

  try {
    const accessToken = credentials.access_token || credentials.api_token || credentials.api_key;
    const phoneNumberId = config.phone_number_id;

    if (!accessToken) return { success: false, error: "No WhatsApp access token configured" };

    switch (provider) {
      case "meta_cloud":
      case "custom": {
        if (!phoneNumberId) return { success: false, error: "No phone_number_id configured" };
        const cleanPhone = phone.replace(/[\s\-\+]/g, "");
        const resp = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: cleanPhone, type: "text", text: { body: message } }),
        });
        const data = await resp.json();
        return resp.ok ? { success: true } : { success: false, error: data?.error?.message || "Meta API error" };
      }
      case "wati": {
        const endpoint = config.api_endpoint_url;
        if (!endpoint) return { success: false, error: "No WATI API endpoint configured" };
        const cleanPhone = phone.replace(/[\s\-\+]/g, "");
        const resp = await fetch(`${endpoint}/api/v1/sendSessionMessage/${cleanPhone}?messageText=${encodeURIComponent(message)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await resp.json();
        return data.result ? { success: true } : { success: false, error: data.info || "WATI error" };
      }
      default:
        // For gupshup, interakt, aisensy — attempt Meta-style as fallback
        if (phoneNumberId) {
          const cleanPhone = phone.replace(/[\s\-\+]/g, "");
          const resp = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: cleanPhone, type: "text", text: { body: message } }),
          });
          const data = await resp.json();
          return resp.ok ? { success: true } : { success: false, error: data?.error?.message || "WhatsApp API error" };
        }
        return { success: false, error: `WhatsApp provider ${provider} not fully supported for text messages` };
    }
  } catch (e) {
    return { success: false, error: `WhatsApp send error: ${(e as Error).message}` };
  }
}

// === Communication logging ===
async function logCommunication(supabase: any, branchId: string, type: string, recipient: string, content: string, status: string) {
  try {
    await supabase.from("communication_logs").insert({
      branch_id: branchId,
      type,
      recipient,
      content: content.slice(0, 500),
      status,
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log communication:", e);
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
