// v1.1.0 — Incline indigo branding to match the delivered PDF report.
// v1.0.1 — Generate a printable HOWBODY report (auth required, returns HTML)
// Escapes member-supplied strings to prevent stored XSS in generated reports.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function row(label: string, value: any, suffix = "") {
  if (value === null || value === undefined || value === "") return "";
  return `<tr><td style="padding:6px 12px;color:#64748b;font-size:12px">${escapeHtml(label)}</td>
  <td style="padding:6px 12px;font-weight:600">${escapeHtml(value)}${suffix ? ` <span style="color:#94a3b8;font-weight:400">${escapeHtml(suffix)}</span>` : ""}</td></tr>`;
}

function renderBody(r: any, name: string) {
  const dt = new Date(r.test_time || r.created_at).toLocaleString("en-IN");
  return `
  <h2 style="margin:0 0 4px">Body Composition Report</h2>
  <p style="margin:0 0 16px;color:#64748b">${escapeHtml(name)} · ${escapeHtml(dt)}</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    ${row("Health Score", r.health_score)}
    ${row("Weight", r.weight, "kg")}
    ${row("BMI", r.bmi)}
    ${row("Body Fat %", r.pbf, "%")}
    ${row("Skeletal Muscle Mass", r.smm, "kg")}
    ${row("Total Body Water", r.tbw, "kg")}
    ${row("Visceral Fat Rating", r.vfr)}
    ${row("BMR", r.bmr, "kcal")}
    ${row("Metabolic Age", r.metabolic_age)}
    ${row("Target Weight", r.target_weight, "kg")}
    ${row("Weight to Adjust", r.weight_control, "kg")}
    ${row("Fat to Adjust", r.fat_control, "kg")}
    ${row("Muscle to Adjust", r.muscle_control, "kg")}
    ${row("Intracellular Fluid", r.icf, "L")}
    ${row("Extracellular Fluid", r.ecf, "L")}
    ${row("Waist-to-Hip Ratio", r.whr)}
  </table>`;
}

function renderPosture(r: any, name: string) {
  const dt = new Date(r.test_time || r.created_at).toLocaleString("en-IN");
  return `
  <h2 style="margin:0 0 4px">Posture Analysis Report</h2>
  <p style="margin:0 0 16px;color:#64748b">${escapeHtml(name)} · ${escapeHtml(dt)}</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    ${row("Posture Type", r.posture_type)}
    ${row("Body Shape Profile", r.body_shape_profile)}
    ${row("Body Slope", r.body_slope)}
  </table>`;
}

function shell(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#0f172a;max-width:800px;margin:24px auto;padding:0 24px}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #4f46e5;padding-bottom:12px;margin-bottom:18px}
header h1{margin:0;font-size:18px;color:#4f46e5;letter-spacing:.02em}
header span{font-size:11px;color:#64748b}
table tr:nth-child(odd){background:#f8fafc}
@media print{header{break-after:avoid}}
</style></head><body>
<header>
  <h1>The Incline Life by Incline</h1>
  <span>Body Scan Health Report</span>
</header>
${body}
<p style="margin-top:24px;font-size:11px;color:#94a3b8;text-align:center">
This report is generated from your body scan and is intended as a wellness reference, not medical advice.
</p>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const sbAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await sbAuth.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);

    const { dataKey, reportType } = await req.json().catch(() => ({}));
    if (!dataKey || !["body", "posture"].includes(reportType)) {
      return json({ ok: false, error: "dataKey & reportType required" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const table = reportType === "body" ? "howbody_body_reports" : "howbody_posture_reports";
    const { data: report } = await sb.from(table).select("*").eq("data_key", dataKey).maybeSingle();
    if (!report) return json({ ok: false, error: "Report not found" }, 404);

    // Authorize: requester must own this member row (or be staff)
    const { data: member } = await sb
      .from("members")
      .select("id, user_id, profiles:user_id(full_name)")
      .eq("id", report.member_id)
      .maybeSingle();
    if (!member) return json({ ok: false, error: "Member not found" }, 404);

    if (member.user_id !== userId) {
      // allow staff: check user_roles
      const { data: roleRow } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["admin", "manager", "owner", "trainer"])
        .maybeSingle();
      if (!roleRow) return json({ ok: false, error: "Forbidden" }, 403);
    }

    const memberName = (member.profiles as any)?.full_name || "Member";
    const html = shell(
      reportType === "body" ? "Body Composition Report" : "Posture Analysis Report",
      reportType === "body" ? renderBody(report, memberName) : renderPosture(report, memberName),
    );

    return json({ ok: true, html });
  } catch (e) {
    console.error("howbody-report-pdf error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
