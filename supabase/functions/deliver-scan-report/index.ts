// v2.0.0 — Preserve original HOWBODY PDFs and dispatch every external channel centrally.
// Triggered fire-and-forget by howbody-body-webhook / howbody-posture-webhook after a row is upserted.
// Idempotent on (report_id, kind): repeated invocations skip already-sent channels.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

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

async function buildPdf(opts: {
  title: string;
  memberName: string;
  branchName: string;
  scanDateLabel: string;
  rows: Array<[string, string]>;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const PAGE: [number, number] = [595.28, 841.89]; // A4
  let page = pdf.addPage(PAGE);
  const { width } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const win = (x: unknown): string =>
    String(x ?? "")
      .replace(/\u20b9/g, "Rs.")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");

  const teal = rgb(0, 0.72, 0.61);
  const slate = rgb(0.39, 0.45, 0.55);
  const dark = rgb(0.06, 0.09, 0.16);

  const drawFooter = (p: typeof page) => {
    p.drawText(
      "Generated from your body scan. Wellness reference only - not medical advice.",
      { x: 40, y: 40, size: 9, font, color: slate },
    );
  };

  // Header (first page only)
  page.drawText("The Incline Life by Incline", { x: 40, y: 800, size: 14, font: bold, color: teal });
  page.drawText(win(opts.title), { x: 40, y: 778, size: 18, font: bold, color: dark });
  page.drawText(win(`${opts.memberName} · ${opts.branchName}`), { x: 40, y: 758, size: 11, font, color: slate });
  page.drawText(win(`Scan: ${opts.scanDateLabel}`), { x: 40, y: 744, size: 10, font, color: slate });
  page.drawLine({ start: { x: 40, y: 730 }, end: { x: width - 40, y: 730 }, thickness: 1.5, color: teal });

  // Rows — paginate onto fresh pages instead of clipping.
  let y = 700;
  const lh = 22;
  for (const [label, value] of opts.rows) {
    if (y < 80) {
      drawFooter(page);
      page = pdf.addPage(PAGE);
      page.drawText(win(`${opts.title} (continued)`), { x: 40, y: 800, size: 12, font: bold, color: teal });
      page.drawLine({ start: { x: 40, y: 788 }, end: { x: width - 40, y: 788 }, thickness: 1, color: teal });
      y = 760;
    }
    page.drawText(win(label), { x: 50, y, size: 11, font, color: slate });
    page.drawText(win(value ?? "-"), { x: 280, y, size: 11, font: bold, color: dark });
    y -= lh;
  }

  drawFooter(page);

  return await pdf.save();
}

function bodyRows(r: any): Array<[string, string]> {
  const v = (x: any, suffix = "") => (x === null || x === undefined || x === "" ? "—" : `${x}${suffix}`);
  return [
    ["Health Score", v(r.health_score)],
    ["Weight", v(r.weight, " kg")],
    ["BMI", v(r.bmi)],
    ["Body Fat %", v(r.pbf, " %")],
    ["Skeletal Muscle Mass", v(r.smm, " kg")],
    ["Total Body Water", v(r.tbw, " kg")],
    ["Visceral Fat Rating", v(r.vfr)],
    ["BMR", v(r.bmr, " kcal")],
    ["Metabolic Age", v(r.metabolic_age)],
    ["Target Weight", v(r.target_weight, " kg")],
    ["Weight to Adjust", v(r.weight_control, " kg")],
    ["Fat to Adjust", v(r.fat_control, " kg")],
    ["Muscle to Adjust", v(r.muscle_control, " kg")],
    ["Waist-to-Hip Ratio", v(r.whr)],
  ];
}

function postureRows(r: any): Array<[string, string]> {
  const v = (x: any, suffix = "") => (x === null || x === undefined || x === "" ? "—" : `${x}${suffix}`);
  return [
    ["Posture Score", v(r.score)],
    ["Body Slope", v(r.body_slope)],
    ["Head Forward", v(r.head_forward)],
    ["Head Slant", v(r.head_slant)],
    ["High/Low Shoulder", v(r.high_low_shoulder)],
    ["Pelvis Forward", v(r.pelvis_forward)],
    ["Knee (L/R)", `${v(r.knee_left)} / ${v(r.knee_right)}`],
    ["Leg (L/R)", `${v(r.leg_left)} / ${v(r.leg_right)}`],
    ["Bust", v(r.bust)],
    ["Waist", v(r.waist)],
    ["Hip", v(r.hip)],
    ["Thigh (L/R)", `${v(r.left_thigh)} / ${v(r.right_thigh)}`],
    ["Calf (L/R)", `${v(r.calf_left)} / ${v(r.calf_right)}`],
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { report_id, kind } = await req.json();
    if (!report_id || !kind || (kind !== "body" && kind !== "posture")) {
      return jr({ error: "Missing or invalid report_id/kind" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Idempotency: if delivery row exists with success on all channels, skip.
    const { data: existing } = await supabase
      .from("scan_report_deliveries")
      .select("id, email_status, whatsapp_status, inapp_status, pdf_url, original_pdf_path, pdf_source")
      .eq("report_id", report_id)
      .eq("kind", kind)
      .maybeSingle();
    if (
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
      .select("id, member_code, branch_id, assigned_trainer_id, user_id, profiles:user_id (full_name, phone, email)")
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
          dedupe_key: `scan-report:${kind}:${report_id}:${channel}:v2`,
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
    if (memberEmail && existing?.email_status !== "sent" && existing?.email_status !== "delivered") {
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
    if (memberPhone && pdfUrl && !["sent", "delivered", "read"].includes(existing?.whatsapp_status || "")) {
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
    if (member.user_id && existing?.inapp_status !== "sent") {
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
