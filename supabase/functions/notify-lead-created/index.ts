// v3.4.0 — Staff WhatsApp alerts throttled to 1/15min per staff member;
//          in-app notification always fires.
// v3.3.0 — Per-recipient staff_name variable for team alerts (fixes 132018
//          template_param_empty on internal_lead_alert). Profile queries now
//          select full_name; dispatch() accepts varsOverride merged over the
//          shared vars bag.
// v3.2.0 — Enriched team-alert variables (plan_interest, fitness_goal, goals,

//          budget, preferred_time, fitness_experience, expected_start_date,
//          temperature, score, notes, utm_*, landing_page, referrer_url,
//          campaign_name, ad_id, preferred_contact_channel, captured_at,
//          lead_url). When the configured team_alert_email_body is blank we
//          now auto-render a clean HTML summary listing every non-empty field
//          so the email is never missing context.
// v3.1.0 — Resolve team-alert template by trigger_event='lead_created' first.
// v3.0.0 — Full SSOT cutover — all channels route via dispatch-communication.
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
      .select(
        "id, full_name, phone, email, source, branch_id, created_at, " +
        "plan_interest, fitness_goal, goals, budget, preferred_time, " +
        "fitness_experience, expected_start_date, temperature, score, notes, " +
        "preferred_contact_channel, utm_source, utm_medium, utm_campaign, " +
        "utm_content, utm_term, landing_page, referrer_url, campaign_name, ad_id",
      )
      .maybeSingle();

    if (claimErr) {
      console.error("Lead claim error:", claimErr);
      return json({ error: "Lead claim failed" }, 500);
    }
    if (!claimed) {
      return json({ success: true, sent: 0, skipped: true, reason: "already_claimed" });
    }
    const lead: any = claimed;

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
    const appBase =
      Deno.env.get("APP_BASE_URL") ||
      Deno.env.get("PUBLIC_APP_URL") ||
      "https://incline.lovable.app";
    const capturedAtIso = lead.created_at || new Date().toISOString();
    let capturedAtHuman = capturedAtIso;
    try {
      capturedAtHuman = new Date(capturedAtIso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (_) { /* ignore */ }

    const fitnessGoalCombined = [lead.fitness_goal, lead.goals]
      .filter((v: any) => v && String(v).trim()).join(" • ");

    const vars: Record<string, string> = {
      lead_name: lead.full_name || "Guest",
      member_name: lead.full_name || "Guest",
      name: lead.full_name || "Guest",
      full_name: lead.full_name || "Guest",
      lead_phone: lead.phone || "",
      phone: lead.phone || "",
      lead_email: lead.email || "",
      email: lead.email || "",
      lead_source: lead.source || "direct",
      source: lead.source || "direct",
      branch_name: branchName,
      branch: branchName,
      plan_interest: lead.plan_interest || "",
      interest: lead.plan_interest || "",
      plan: lead.plan_interest || "",
      fitness_goal: fitnessGoalCombined,
      goals: lead.goals || "",
      budget: lead.budget || "",
      preferred_time: lead.preferred_time || "",
      fitness_experience: lead.fitness_experience || "",
      expected_start_date: lead.expected_start_date || "",
      temperature: lead.temperature || "",
      score: lead.score != null ? String(lead.score) : "",
      notes: lead.notes || "",
      preferred_contact_channel: lead.preferred_contact_channel || "",
      utm_source: lead.utm_source || "",
      utm_medium: lead.utm_medium || "",
      utm_campaign: lead.utm_campaign || "",
      utm_content: lead.utm_content || "",
      utm_term: lead.utm_term || "",
      landing_page: lead.landing_page || "",
      referrer_url: lead.referrer_url || "",
      campaign_name: lead.campaign_name || "",
      ad_id: lead.ad_id || "",
      captured_at: capturedAtHuman,
      lead_url: `${appBase}/leads/${lead.id}`,
    };
    const render = (tpl: string): string =>
      String(tpl || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => vars[k] ?? "");

    // Auto-render a rich HTML email body when the configured body is blank,
    // so admins/managers never receive a context-less alert.
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const buildAutoEmailBody = (): string => {
      const rows: Array<[string, string]> = [
        ["Name", vars.lead_name],
        ["Phone", vars.lead_phone],
        ["Email", vars.lead_email],
        ["Source", vars.lead_source],
        ["Branch", vars.branch_name],
        ["Plan Interest", vars.plan_interest],
        ["Fitness Goal", vars.fitness_goal],
        ["Budget", vars.budget],
        ["Preferred Time", vars.preferred_time],
        ["Fitness Experience", vars.fitness_experience],
        ["Expected Start", vars.expected_start_date],
        ["Preferred Channel", vars.preferred_contact_channel],
        ["Temperature", vars.temperature],
        ["Score", vars.score],
        ["Campaign", vars.campaign_name],
        ["UTM Source", vars.utm_source],
        ["UTM Medium", vars.utm_medium],
        ["UTM Campaign", vars.utm_campaign],
        ["UTM Content", vars.utm_content],
        ["UTM Term", vars.utm_term],
        ["Ad ID", vars.ad_id],
        ["Landing Page", vars.landing_page],
        ["Referrer", vars.referrer_url],
        ["Notes", vars.notes],
        ["Captured At", vars.captured_at],
      ].filter(([, v]) => v && v.trim().length);

      const tableRows = rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;font-weight:500;word-break:break-word">${esc(v)}</td></tr>`,
        )
        .join("");

      return `
<div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
  <p style="font-size:15px;line-height:1.55;margin:0 0 16px">
    A new lead was captured. Please follow up at the earliest.
  </p>
  <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:12px;overflow:hidden">
    ${tableRows}
  </table>
  <p style="margin:20px 0 0">
    <a href="${esc(vars.lead_url)}"
       style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">
      Open lead in CRM →
    </a>
  </p>
</div>`.trim();
    };



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
      varsOverride?: Record<string, string>;
    }) => {
      try {
        const mergedVars = input.varsOverride
          ? { ...vars, ...input.varsOverride }
          : vars;
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
              variables: mergedVars,
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
    const teamAlertEmailSubject = render(
      rules.team_alert_email_subject ||
        "New Lead: {{lead_name}}{{plan_interest}} — {{lead_source}}",
    ).replace(/\s+—\s+$/, "").replace(/:\s+—/, ":");
    const configuredEmailBody = (rules.team_alert_email_body || "").trim();
    const teamAlertEmailBody = configuredEmailBody
      ? render(configuredEmailBody)
      : buildAutoEmailBody();

    const sendTeamBundle = async (
      profile: { id?: string; full_name?: string | null; phone: string | null; email?: string | null },
      pref: { whatsapp_enabled: boolean; sms_enabled: boolean; email_enabled: boolean },
      audience: "admin" | "manager",
    ) => {
      const tag = `${audience}:${profile.id || profile.phone || profile.email}`;
      const staffName = (profile.full_name || "").trim() || "Team";
      const staffFirstName = staffName.split(/\s+/)[0] || staffName;
      const perRecipientVars: Record<string, string> = {
        staff_name: staffFirstName,
        team_member_name: staffFirstName,
        recipient_name: staffFirstName,
      };

      if (rules[`sms_to_${audience}s`] && pref.sms_enabled && profile.phone) {
        await dispatch({
          channel: "sms",
          category: "new_lead",
          recipient: profile.phone,
          body: teamAlertSmsBody,
          dedupe_suffix: `team:${tag}`,
          varsOverride: perRecipientVars,
        });
      }
      // v3.4.0: staff WhatsApp alerts are rate-limited to ONE per 15 minutes per
      // staff member. Every lead still reaches them in-app and by email; this
      // stops Meta seeing the same operational alert dozens of times a day
      // (the behaviour behind the 131049 pacing failures).
      let waThrottled = false;
      if (profile.phone) {
        const digits = String(profile.phone).replace(/\D/g, '').slice(-10);
        const { count } = await supabase
          .from("communication_logs")
          .select("id", { count: "exact", head: true })
          .eq("type", "whatsapp")
          .eq("category", "new_lead")
          .ilike("recipient", `%${digits}`)
          .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
        waThrottled = (count ?? 0) > 0;
      }

      // In-app notification always fires, regardless of WhatsApp throttling.
      if (profile.id) {
        await supabase.rpc("create_system_notification", {
          p_user_id: profile.id,
          p_title: "New lead",
          p_message: `${vars.lead_name || "A new lead"} — ${vars.lead_source || "website"}`,
          p_type: "lead",
          p_linked_entity_id: String(lead.id),
        }).then(() => {}, () => {});
      }

      if (rules[`whatsapp_to_${audience}s`] && pref.whatsapp_enabled && profile.phone && waThrottled) {
        results.push({
          channel: "whatsapp",
          recipient: profile.phone,
          status: "skipped",
          reason: "staff_alert_throttled_15m",
        });
      } else if (rules[`whatsapp_to_${audience}s`] && pref.whatsapp_enabled && profile.phone) {
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
            varsOverride: perRecipientVars,
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
          varsOverride: perRecipientVars,
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
          supabase.from("profiles").select("id, full_name, phone, email").in("id", adminIds),
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
          .from("profiles").select("id, full_name, phone, email").in("id", mgrIds);
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
