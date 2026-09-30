// v2.2.0 — Preserve original HOWBODY PDFs and dispatch every external channel centrally.
// Triggered fire-and-forget by howbody-body-webhook / howbody-posture-webhook after a row is upserted.
// Idempotent on (report_id, kind): repeated invocations skip already-sent channels.
// 2.2.0: generated fallback PDF redesigned (Incline branding, healthy-range
//        indicators, coaching targets, AI "your scan, explained" note).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildScanPdf, type MetricGroup } from "../_shared/scan-report-pdf.ts";
import { callAI } from "../_shared/ai-dispatcher.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Kind = "body" | "posture";

function jr(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("+")) return digits;
  return digits ? `+${digits}` : null;
}

const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Gender-aware healthy reference bands used for the range indicators. */
function bodyGroups(r: any, sex: "male" | "female"): MetricGroup[] {
  const female = sex === "female";
  return [
    {
      title: "Body composition",
      metrics: [
        { label: "Weight", value: num(r.weight), suffix: "kg" },
        { label: "Skeletal muscle mass", value: num(r.smm), suffix: "kg", hint: "Higher is generally better" },
        { label: "Total body water", value: num(r.tbw), suffix: "kg" },
        { label: "Intracellular fluid", value: num(r.icf), suffix: "L" },
        { label: "Extracellular fluid", value: num(r.ecf), suffix: "L" },
      ],
    },
    {
      title: "Obesity analysis",
      metrics: [
        { label: "BMI", value: num(r.bmi), band: { low: 18.5, high: 24.9 } },
        {
          label: "Body fat",
          value: num(r.pbf),
          suffix: "%",
          band: female ? { low: 21, high: 33 } : { low: 10, high: 20 },
        },
        { label: "Visceral fat rating", value: num(r.vfr), band: { low: 1, high: 9 } },
        {
          label: "Waist-to-hip ratio",
          value: num(r.whr),
          band: female ? { low: 0.65, high: 0.85 } : { low: 0.7, high: 0.9 },
        },
      ],
    },
    {
      title: "Metabolism",
      metrics: [
        { label: "Basal metabolic rate", value: num(r.bmr), suffix: "kcal", hint: "Daily calories at rest" },
        { label: "Metabolic age", value: num(r.metabolic_age), hint: "Compared with your actual age" },
      ],
    },
    {
      title: "Coaching targets",
      metrics: [
        { label: "Target weight", value: num(r.target_weight), suffix: "kg" },
        { label: "Weight to adjust", value: num(r.weight_control), suffix: "kg" },
        { label: "Fat to adjust", value: num(r.fat_control), suffix: "kg", hint: "Negative means reduce" },
        { label: "Muscle to adjust", value: num(r.muscle_control), suffix: "kg", hint: "Positive means build" },
      ],
    },
  ];
}

function postureGroups(r: any): MetricGroup[] {
  return [
    {
      title: "Alignment overview",
      metrics: [
        { label: "Body slope", value: num(r.body_slope) },
        { label: "Head forward", value: num(r.head_forward) },
        { label: "Head slant", value: num(r.head_slant) },
        { label: "High / low shoulder", value: num(r.high_low_shoulder) },
        { label: "Pelvis forward", value: num(r.pelvis_forward) },
      ],
    },
  ];
}

function posturePlainRows(r: any): Array<[string, string]> {
  const v = (x: any) => (x === null || x === undefined || x === "" ? "-" : String(x));
  return [
    ["Posture type", v(r.posture_type)],
    ["Body shape profile", v(r.body_shape_profile)],
    ["Knee (left / right)", `${v(r.knee_left)} / ${v(r.knee_right)}`],
    ["Leg (left / right)", `${v(r.leg_left)} / ${v(r.leg_right)}`],
    ["Thigh (left / right)", `${v(r.left_thigh)} / ${v(r.right_thigh)}`],
    ["Calf (left / right)", `${v(r.calf_left)} / ${v(r.calf_right)}`],
    ["Bust", v(r.bust)],
    ["Waist", v(r.waist)],
    ["Hip", v(r.hip)],
  ];
}

/**
 * Short, plain-language interpretation of the scan.
 * Best-effort: never blocks or fails delivery.
 */
async function buildAiNote(
  supabase: any,
  kind: Kind,
  memberName: string,
  facts: string,
): Promise<string | null> {
  try {
    const { content } = await callAI({
      scope: "all",
      supabase,
      temperature: 0.4,
      max_tokens: 320,
      messages: [
        {
          role: "system",
          content:
            "You are a fitness coach at Incline, a premium gym in Udaipur. Explain a member's " +
            "in-club body scan in warm, plain English. Rules: 90-120 words, one short paragraph. " +
            "Mention two things going well and two focus areas, then one practical next step in the gym " +
            "(training, recovery or nutrition habit). Never diagnose, never mention illness, medication " +
            "or medical conditions, never quote prices. Use only the numbers provided. Plain text only, " +
            "no markdown, no bullet characters, no emoji.",
        },
        {
          role: "user",
          content: `Member: ${memberName}. Scan type: ${kind === "body" ? "body composition" : "posture"}.\n${facts}`,
        },
      ],
    });
    const out = String(content || "").replace(/\s+/g, " ").trim();
    return out.length > 40 ? out.slice(0, 1200) : null;
  } catch (e) {
    console.warn("scan AI note failed:", e instanceof Error ? e.message : e);
    return null;
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { report_id, kind, resend, channels } = await req.json();
    if (!report_id || !kind || (kind !== "body" && kind !== "posture")) {
      return jr({ error: "Missing or invalid report_id/kind" }, 400);
    }
    // Staff-triggered re-send: explicit channels bypass the "already sent" guard.
    const forcedChannels: string[] = Array.isArray(channels)
      ? channels.filter((c: unknown) => c === "email" || c === "whatsapp")
      : [];
    const isResend = Boolean(resend) && forcedChannels.length > 0;
    const attemptSuffix = isResend ? `:r${Date.now()}` : "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // A re-send pushes a fresh message to the member, so it needs an
    // authenticated staff caller with owner/admin/manager/staff rights.
    if (isResend) {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userRes } = await supabase.auth.getUser(token);
      const uid = userRes?.user?.id;
      if (!uid) return jr({ error: "Unauthorized" }, 401);
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const allowed = (roleRows || []).some((r: { role: string }) =>
        ["owner", "admin", "manager", "staff"].includes(r.role)
      );
      if (!allowed) return jr({ error: "Not allowed to re-send reports" }, 403);
    }

    // Idempotency: if delivery row exists with success on all channels, skip.
    const { data: existing } = await supabase
      .from("scan_report_deliveries")
      .select("id, email_status, whatsapp_status, inapp_status, pdf_url, original_pdf_path, pdf_source")
      .eq("report_id", report_id)
      .eq("kind", kind)
      .maybeSingle();
    if (
      !isResend &&
      existing &&
      existing.email_status === "sent" &&
      ["sent", "delivered", "read"].includes(existing.whatsapp_status || "") &&
      existing.inapp_status === "sent"
    ) {
      return jr({ skipped: true, reason: "already_delivered" });
    }

    // Load report
    const table = (kind as Kind) === "body" ? "howbody_body_reports" : "howbody_posture_reports";
    const { data: report, error: rErr } = await supabase
      .from(table)
      .select("*")
      .eq("id", report_id)
      .single();
    if (rErr || !report) return jr({ error: "Report not found" }, 404);

    // Member + branch + trainer
    const { data: member } = await supabase
      .from("members")
      .select("id, member_code, branch_id, assigned_trainer_id, user_id, profiles:user_id (full_name, phone, email, gender, date_of_birth)")
      .eq("id", report.member_id)
      .single();
    if (!member) return jr({ error: "Member not found" }, 404);

    const memberProfile: any = member.profiles;
    const memberName = memberProfile?.full_name || "Member";
    const memberPhone = normalisePhone(memberProfile?.phone);
    const memberEmail = memberProfile?.email || null;

    const { data: branch } = await supabase
      .from("branches").select("id,name").eq("id", member.branch_id).single();
    const branchName = branch?.name || "Incline";

    // PDF — original vendor report wins. The generated summary exists only as a
    // recovery fallback when HOWBODY did not provide a source PDF.
    const title = kind === "body" ? "Body Composition Report" : "Posture Analysis Report";
    const rows = kind === "body" ? bodyRows(report) : postureRows(report);
    const scanDateLabel = fmtDate(report.test_time || report.created_at);
    const originalPath = existing?.original_pdf_path || null;
    const path = originalPath || `scans/${member.id}/${kind}-${report_id}.pdf`;
    if (!originalPath) {
      const pdfBytes = await buildPdf({ title, memberName, branchName, scanDateLabel, rows });
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);
    }

    const { data: signed } = await supabase.storage
      .from("attachments")
      .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 days
    const pdfUrl = signed?.signedUrl || null;
    if (!pdfUrl) throw new Error("Could not prepare a secure report link");

    // Upsert delivery row early so idempotency works on partial failure
    const { data: delivery } = await supabase
      .from("scan_report_deliveries")
      .upsert({
        report_id,
        kind,
        member_id: member.id,
        branch_id: member.branch_id,
        pdf_url: pdfUrl,
        original_pdf_path: originalPath,
        pdf_source: originalPath ? "howbody_original" : "generated_fallback",
      }, { onConflict: "report_id,kind" })
      .select("id")
      .single();
    const deliveryId = delivery?.id;

    // Build human-readable summary + template variables
    let summaryLines: string[] = [];
    const templateVars: Record<string, string> = {
      member_name: memberName,
      member_code: member.member_code || "",
      branch_name: branchName,
      report_url: pdfUrl || "",
      scan_type: kind === "body" ? "body" : "posture",
    };
    if (kind === "body") {
      summaryLines = [
        `Weight: ${report.weight ?? "—"} kg`,
        `BMI: ${report.bmi ?? "—"}`,
        `Body Fat: ${report.pbf ?? "—"}%`,
        `Health Score: ${report.health_score ?? "—"}`,
      ];
      Object.assign(templateVars, {
        weight: String(report.weight ?? "—"),
        bmi: String(report.bmi ?? "—"),
        body_fat: String(report.pbf ?? "—"),
        health_score: String(report.health_score ?? "—"),
      });
    } else {
      summaryLines = [
        `Posture Score: ${report.score ?? "—"}`,
        `Body Slope: ${report.body_slope ?? "—"}`,
      ];
      Object.assign(templateVars, {
        posture_score: String(report.score ?? "—"),
        body_slope: String(report.body_slope ?? "—"),
      });
    }
    templateVars.summary = summaryLines.join(" · ");

    const triggerEvent = kind === "body" ? "body_scan_ready" : "posture_scan_ready";

    // Pull member-facing templates by trigger_event + branch
    const { data: memberTemplates } = await supabase
      .from("templates")
      .select("id, type, subject, content")
      .eq("branch_id", member.branch_id)
      .eq("trigger_event", triggerEvent)
      .eq("is_active", true);

    const renderTpl = (s: string | null | undefined) =>
      (s || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
        if (/^\d+$/.test(String(k))) return String(k) === "1" ? memberName : "";
        return templateVars[k] ?? "";
      });

    const emailTpl = memberTemplates?.find((t: any) => t.type === "email");
    const waTpl = memberTemplates?.find((t: any) => t.type === "whatsapp");

    const subject = emailTpl
      ? renderTpl(emailTpl.subject) || (kind === "body" ? `Your Body Scan Report — ${branchName}` : `Your Posture Scan Report — ${branchName}`)
      : (kind === "body" ? `Your Body Scan Report — ${branchName}` : `Your Posture Scan Report — ${branchName}`);

    const greetingHtml = emailTpl
      ? renderTpl(emailTpl.content)
      : `<h2>Hi ${memberName},</h2><p>Your ${kind === "body" ? "body composition" : "posture"} scan from <strong>${branchName}</strong> is ready.</p><ul>${summaryLines.map((s) => `<li>${s}</li>`).join("")}</ul>${pdfUrl ? `<p><a href="${pdfUrl}">Download Full Report (PDF)</a></p>` : ""}`;

    const captionWa = waTpl
      ? renderTpl(waTpl.content)
      : [`Hi ${memberName}, your ${kind === "body" ? "body scan" : "posture scan"} from ${branchName} is ready.`, ...summaryLines, pdfUrl ? `\nReport: ${pdfUrl}` : ""].filter(Boolean).join("\n");

    type DispatchResult = {
      status?: "sent" | "queued" | "deduped" | "suppressed" | "failed";
      log_id?: string;
      reason?: string;
      provider_message_id?: string;
    };
    const dispatch = async (channel: "email" | "whatsapp", recipient: string, body: string, templateId?: string | null) => {
      const response = await supabase.functions.invoke("dispatch-communication", {
        body: {
          branch_id: member.branch_id,
          channel,
          category: "transactional",
          recipient,
          member_id: member.id,
          template_id: templateId || undefined,
          payload: {
            subject: channel === "email" ? subject : undefined,
            body,
            variables: { ...templateVars, event_key: triggerEvent, recipient_name: memberName },
            use_branded_template: true,
          },
          attachment: { url: pdfUrl, filename: `${kind}-scan-${member.member_code || report_id.slice(0, 8)}.pdf`, content_type: "application/pdf", kind: "document" },
          dedupe_key: `scan-report:${kind}:${report_id}:${channel}:v2${attemptSuffix}`,
          ttl_seconds: 31536000,
          force: true,
          source_caller: "deliver-scan-report",
          source_type: "system",
          skip_notification: true,
        },
      });
      if (response.error) throw new Error(response.error.message || String(response.error));
      return (response.data || {}) as DispatchResult;
    };

    // ── Member Email ────────────────────────────────────────────────
    let emailStatus = "skipped";
    let emailError: string | null = null;
    let emailLogId: string | null = null;
    if (memberEmail && (isResend ? forcedChannels.includes("email") : (existing?.email_status !== "sent" && existing?.email_status !== "delivered"))) {
      try {
        const result = await dispatch("email", memberEmail, greetingHtml, emailTpl?.id);
        emailStatus = result.status || "failed";
        emailError = result.reason || null;
        emailLogId = result.log_id || null;
      } catch (e) {
        emailStatus = "failed"; emailError = String(e);
      }
    }

    // ── Member WhatsApp (document) ───────────────────────────────────
    let waStatus = "skipped";
    let waError: string | null = null;
    let waLogId: string | null = null;
    let waProviderMessageId: string | null = null;
    if (memberPhone && pdfUrl && (isResend ? forcedChannels.includes("whatsapp") : !["sent", "delivered", "read"].includes(existing?.whatsapp_status || ""))) {
      try {
        const result = await dispatch("whatsapp", memberPhone, captionWa, waTpl?.id);
        waStatus = result.status || "failed";
        waError = result.reason || null;
        waLogId = result.log_id || null;
        waProviderMessageId = result.provider_message_id || null;
      } catch (e) {
        waStatus = "failed"; waError = String(e);
      }
    }

    // ── In-app notifications (member, trainer, managers, admins/owner) ──
    const notifTitle = kind === "body" ? "Body Scan Ready" : "Posture Scan Ready";
    const notifMessageMember = `Your ${kind === "body" ? "body composition" : "posture"} scan from ${branchName} is ready. ${summaryLines.join(" · ")}`;
    const internalTitle = `New ${kind === "body" ? "Body" : "Posture"} Scan: ${memberName}`;
    const internalMessage = `${memberName} (${member.member_code || ""}) at ${branchName} — ${summaryLines.join(" · ")}`;
    const memberActionUrl = "/my-progress";
    const staffActionUrl = `/members/${member.id}`;

    const notifRows: any[] = [];

    // Member
    if (member.user_id && !isResend && existing?.inapp_status !== "sent") {
      notifRows.push({
        user_id: member.user_id,
        branch_id: member.branch_id,
        title: notifTitle,
        message: notifMessageMember,
        type: "success",
        category: "scan",
        action_url: memberActionUrl,
        metadata: { report_id, kind, pdf_url: pdfUrl },
      });
    }

    // Assigned trainer → resolve user_id via trainers table
    if (member.assigned_trainer_id) {
      const { data: trainer } = await supabase
        .from("trainers")
        .select("user_id")
        .eq("id", member.assigned_trainer_id)
        .maybeSingle();
      if (trainer?.user_id) {
        notifRows.push({
          user_id: trainer.user_id,
          branch_id: member.branch_id,
          title: internalTitle,
          message: internalMessage,
          type: "info",
          category: "scan",
          action_url: staffActionUrl,
          metadata: { report_id, kind, member_id: member.id },
        });
      }
    }

    // Branch managers + admins/owners (deduped via Set)
    const recipientUserIds = new Set<string>();
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["owner", "admin", "manager"]);
    // Resolve manager → branch via employees table
    const managerCandidates = (roleRows || [])
      .filter((r: any) => r.role === "manager")
      .map((r: any) => r.user_id);
    let managersInBranch = new Set<string>();
    if (managerCandidates.length) {
      const { data: emps } = await supabase
        .from("employees")
        .select("user_id, branch_id")
        .in("user_id", managerCandidates)
        .eq("branch_id", member.branch_id);
      managersInBranch = new Set((emps || []).map((e: any) => e.user_id));
    }
    for (const rr of roleRows || []) {
      if (rr.role === "owner" || rr.role === "admin") {
        recipientUserIds.add(rr.user_id);
      } else if (rr.role === "manager" && managersInBranch.has(rr.user_id)) {
        recipientUserIds.add(rr.user_id);
      }
    }
    // Avoid double-notifying the trainer/member if they are also staff
    if (member.user_id) recipientUserIds.delete(member.user_id);
    for (const uid of recipientUserIds) {
      notifRows.push({
        user_id: uid,
        branch_id: member.branch_id,
        title: internalTitle,
        message: internalMessage,
        type: "info",
        category: "scan",
        action_url: staffActionUrl,
        metadata: { report_id, kind, member_id: member.id },
      });
    }

    let inappStatus = "skipped";
    if (notifRows.length) {
      const { error: notifErr } = await supabase.from("notifications").insert(notifRows);
      inappStatus = notifErr ? "failed" : "sent";
      if (notifErr) console.error("notifications insert failed:", notifErr.message);
    }

    // Final delivery status update
    if (deliveryId) {
      await supabase
        .from("scan_report_deliveries")
        .update({
          email_status: emailStatus,
          email_error: emailError,
          email_communication_log_id: emailLogId,
          whatsapp_status: waStatus,
          whatsapp_error: waError,
          whatsapp_communication_log_id: waLogId,
          whatsapp_provider_message_id: waProviderMessageId,
          whatsapp_accepted_at: waStatus === "sent" ? new Date().toISOString() : null,
          inapp_status: inappStatus,
        })
        .eq("id", deliveryId);
    }

    return jr({
      success: true,
      report_id,
      kind,
      pdf_url: pdfUrl,
      email: emailStatus,
      whatsapp: waStatus,
      inapp: inappStatus,
      notifications_sent: notifRows.length,
    });
  } catch (e) {
    console.error("deliver-scan-report error:", e);
    return jr({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
