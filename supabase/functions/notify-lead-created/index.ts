// v3.1.0 — Resolve the team-alert template by trigger_event='lead_created' first,
//          then fall back to either of the known Meta names (internal_lead_alert,
//          internal_new_lead_alert, lead_alert). Only use the template when the
//          live Meta status is APPROVED and the row is not stale, so a Meta
//          category drift (UTILITY → MARKETING reclassification) does not
//          silently break sends. WhatsApp team alerts are SKIPPED (not failed)
//          when no safe template exists — SMS/email still attempted.
// v3.0.0 — Full SSOT cutover. ALL channels (whatsapp / sms / email) now route
//          through dispatch-communication. Team WhatsApp alerts use an approved
//          Meta template (resolved via templates table by trigger/meta_template_name),
//          eliminating silent drops outside the 24h customer-service window.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Channel = "whatsapp" | "sms" | "email";

interface DispatchSummary {
  channel: Channel;
  recipient: string;
  status: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lead_id, branch_id } = await req.json();
    if (!lead_id || !branch_id) return json({ error: "Missing lead_id or branch_id" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1) Atomic claim so concurrent invocations don't double-send
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
      return json({ success: true, sent: 0, skipped: true, reason: "already_claimed" });
    }
    const lead = claimed;

    // 2) Branch name
    const { data: branch } = await supabase
      .from("branches").select("name").eq("id", branch_id).single();
    const branchName = branch?.name || "Our Gym";

    // 3) Rules (branch override → global)
    const { data: branchRules } = await supabase
      .from("lead_notification_rules").select("*").eq("branch_id", branch_id).maybeSingle();
    let rules: any = branchRules;
    if (!rules) {
      const { data: globalRules } = await supabase
        .from("lead_notification_rules").select("*").is("branch_id", null).maybeSingle();
      rules = globalRules;
    }
    if (!rules) return json({ success: true, sent: 0, message: "No notification rules configured" });

    const anyEnabled =
      rules.sms_to_lead || rules.whatsapp_to_lead || rules.email_to_lead ||
      rules.sms_to_admins || rules.whatsapp_to_admins || rules.email_to_admins ||
      rules.sms_to_managers || rules.whatsapp_to_managers || rules.email_to_managers;
    if (!anyEnabled) return json({ success: true, sent: 0, message: "All notification channels disabled" });

    // 4) Resolve approved team-alert WhatsApp template once.
    //    Strategy: prefer trigger_event='lead_created'; then any of the known
    //    Meta names. Only accept the row when the live Meta status is APPROVED
    //    and not stale — protects against Meta UTILITY→MARKETING drift silently
    //    breaking transactional team alerts.
    let teamWaTemplateId: string | null = null;
    try {
      const { data: candidates } = await supabase
        .from("v_template_with_meta_status")
        .select("id, trigger_event, meta_template_name, approval_status, whatsapp_meta_status, is_stale, send_risk, branch_id")
        .eq("type", "whatsapp")
        .or(
          [
            "trigger_event.eq.lead_created",
            "meta_template_name.eq.internal_lead_alert",
            "meta_template_name.eq.internal_new_lead_alert",
            "meta_template_name.eq.lead_alert",
          ].join(","),
        );
      const ordered = (candidates || []).slice().sort((a: any, b: any) => {
        const score = (r: any) => {
          let s = 0;
          if (r.branch_id === branch_id) s += 100;
          if (r.approval_status === "approved" || r.whatsapp_meta_status === "APPROVED") s += 50;
          if (!r.is_stale) s += 10;
          if (r.send_risk === "ok" || r.send_risk === null) s += 5;
          if (r.trigger_event === "lead_created") s += 3;
          return s;
        };
        return score(b) - score(a);
      });
      const usable = ordered.find((r: any) =>
        (r.approval_status === "approved" || r.whatsapp_meta_status === "APPROVED") &&
        !r.is_stale
      );
      if (usable) {
        teamWaTemplateId = usable.id;
        if (usable.send_risk === "category_drift_to_marketing") {
          console.warn(
            `notify-lead-created: team alert template ${usable.meta_template_name} ` +
            `was reclassified by Meta to MARKETING — sends may be paced (131049).`,
          );
        }
      } else {
        console.warn(
          "notify-lead-created: no APPROVED+fresh team-alert WhatsApp template; " +
          "skipping WhatsApp team alerts (SMS/email still attempted).",
        );
      }
    } catch (e) {
      console.error("notify-lead-created: template resolution failed", e);
    }

    // 5) Variable bag + simple {{token}} renderer for SMS/email bodies
    const vars: Record<string, string> = {
      lead_name: lead.full_name || "Guest",
      lead_phone: lead.phone || "",
      lead_email: lead.email || "",
      lead_source: lead.source || "direct",
      source: lead.source || "direct",
      branch_name: branchName,
    };
    const render = (tpl: string): string =>
      String(tpl || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => vars[k] ?? "");

    const results: DispatchSummary[] = [];

    const dispatch = async (input: {
      channel: Channel;
      category: string;
      recipient: string;
      body: string;
      subject?: string;
      template_id?: string | null;
      dedupe_suffix: string;
      use_branded_template?: boolean;
    }) => {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/dispatch-communication`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            branch_id,
            channel: input.channel,
            category: input.category,
            recipient: input.recipient,
            template_id: input.template_id ?? null,
            payload: {
              subject: input.subject,
              body: input.body,
              variables: vars,
              use_branded_template: input.use_branded_template ?? true,
            },
            dedupe_key: `lead:${lead.id}:${input.channel}:${input.dedupe_suffix}`,
            force: true, // lead notifications are transactional team ops
          }),
        });
        const data = await resp.json().catch(() => ({}));
        results.push({
          channel: input.channel,
          recipient: input.recipient,
          status: data?.status || (resp.ok ? "sent" : "failed"),
          reason: data?.reason,
        });
      } catch (e) {
        results.push({
          channel: input.channel,
          recipient: input.recipient,
          status: "failed",
          reason: (e as Error).message,
        });
      }
    };

    // 6) Lead-facing welcome messages (lead is in-window → freeform OK)
    if (rules.sms_to_lead && lead.phone) {
      await dispatch({
        channel: "sms",
        category: "transactional",
        recipient: lead.phone,
        body: render(rules.lead_welcome_sms),
        dedupe_suffix: `welcome:${lead.phone}`,
      });
    }
    if (rules.whatsapp_to_lead && lead.phone) {
      await dispatch({
        channel: "whatsapp",
        category: "transactional",
        recipient: lead.phone,
        body: render(rules.lead_welcome_whatsapp),
        dedupe_suffix: `welcome:${lead.phone}`,
      });
    }
    if (rules.email_to_lead && lead.email) {
      await dispatch({
        channel: "email",
        category: "transactional",
        recipient: lead.email,
        subject: render(rules.lead_welcome_email_subject || "Welcome to {{branch_name}}"),
        body: render(rules.lead_welcome_email_body || ""),
        dedupe_suffix: `welcome:${lead.email}`,
      });
    }

    // 7) Helper: send team-alert bundle to one user profile (honours per-user prefs)
    const teamAlertSmsBody = render(rules.team_alert_sms);
    const teamAlertWaFreeformBody = render(rules.team_alert_whatsapp); // fallback if no template
    const teamAlertEmailSubject = render(rules.team_alert_email_subject || "New Lead: {{lead_name}}");
    const teamAlertEmailBody = render(rules.team_alert_email_body || "");

    const sendTeamBundle = async (
      profile: { id?: string; phone: string | null; email?: string | null },
      pref: { whatsapp_enabled: boolean; sms_enabled: boolean; email_enabled: boolean },
      audience: "admin" | "manager",
    ) => {
      const tag = `${audience}:${profile.id || profile.phone || profile.email}`;

      if (rules[`sms_to_${audience}s`] && pref.sms_enabled && profile.phone) {
        await dispatch({
          channel: "sms",
          category: "new_lead",
          recipient: profile.phone,
          body: teamAlertSmsBody,
          dedupe_suffix: `team:${tag}`,
        });
      }
      if (rules[`whatsapp_to_${audience}s`] && pref.whatsapp_enabled && profile.phone) {
        if (!teamWaTemplateId) {
          // No safe template available — record a clean skip instead of attempting
          // a freeform send that hits Meta 131047 outside the 24h window.
          results.push({
            channel: "whatsapp",
            recipient: profile.phone,
            status: "skipped",
            reason: "no_approved_team_alert_template",
          });
        } else {
          await dispatch({
            channel: "whatsapp",
            category: "new_lead",
            recipient: profile.phone,
            template_id: teamWaTemplateId,
            body: teamAlertWaFreeformBody,
            dedupe_suffix: `team:${tag}`,
          });
        }
      }
      if (rules[`email_to_${audience}s`] && pref.email_enabled && profile.email) {
        await dispatch({
          channel: "email",
          category: "new_lead",
          recipient: profile.email,
          subject: teamAlertEmailSubject,
          body: teamAlertEmailBody,
          dedupe_suffix: `team:${tag}`,
        });
      }
    };

    // 8) Admins (owners + admins) — per-admin opt-out
    if (rules.sms_to_admins || rules.whatsapp_to_admins || rules.email_to_admins) {
      const { data: roleRows } = await supabase
        .from("user_roles").select("user_id").in("role", ["owner", "admin"]);
      const adminIds = Array.from(new Set((roleRows || []).map((r: any) => r.user_id)));

      if (adminIds.length) {
        const [{ data: profiles }, { data: prefRows }] = await Promise.all([
          supabase.from("profiles").select("id, phone, email").in("id", adminIds),
          supabase
            .from("lead_notification_admin_prefs")
            .select("user_id, whatsapp_enabled, sms_enabled, email_enabled")
            .in("user_id", adminIds),
        ]);
        const prefMap = new Map<string, any>();
        for (const p of prefRows || []) prefMap.set(p.user_id, p);

        for (const profile of profiles || []) {
          const pref = prefMap.get(profile.id) ?? {
            whatsapp_enabled: true, sms_enabled: true, email_enabled: true,
          };
          await sendTeamBundle(profile, pref, "admin");
        }
      }
    }

    // 9) Branch managers (no per-manager prefs table yet — all opt-in)
    if (rules.sms_to_managers || rules.whatsapp_to_managers || rules.email_to_managers) {
      const { data: managers } = await supabase
        .from("branch_managers").select("user_id").eq("branch_id", branch_id);
      const mgrIds = (managers || []).map((m: any) => m.user_id);

      if (mgrIds.length) {
        const { data: profiles } = await supabase
          .from("profiles").select("id, phone, email").in("id", mgrIds);
        for (const profile of profiles || []) {
          await sendTeamBundle(
            profile,
            { whatsapp_enabled: true, sms_enabled: true, email_enabled: true },
            "manager",
          );
        }
      }
    }

    const sent = results.filter((r) => r.status === "sent" || r.status === "queued").length;
    const failed = results.filter((r) => r.status === "failed").length;
    console.log(`Lead ${lead_id}: ${sent} sent/queued, ${failed} failed of ${results.length}`);

    return json({ success: true, sent, failed, total: results.length, results });
  } catch (error) {
    console.error("notify-lead-created error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
