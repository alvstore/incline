// upload-scan-original-pdf v1.0.0
// Stores the official HOWBODY PDF exported from the scanner console against an
// existing body/posture report, so every future view/download/re-send uses the
// vendor document instead of our generated telemetry summary.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_BYTES = 15 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userRes } = await supabase.auth.getUser(token);
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);

    const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    const allowed = (roleRows || []).some((r: { role: string }) =>
      ["owner", "admin", "manager", "staff"].includes(r.role)
    );
    if (!allowed) return json({ error: "Not allowed to upload reports" }, 403);

    const body = await req.json().catch(() => null);
    const report_id = typeof body?.report_id === "string" ? body.report_id : "";
    const kind = body?.kind === "body" || body?.kind === "posture" ? body.kind : "";
    const file_base64 = typeof body?.file_base64 === "string" ? body.file_base64 : "";
    if (!report_id || !kind || !file_base64) {
      return json({ error: "report_id, kind and file_base64 are required" }, 400);
    }

    const raw = file_base64.includes(",") ? file_base64.split(",").pop()! : file_base64;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "The file could not be read" }, 400);
    }
    if (bytes.length === 0) return json({ error: "The file is empty" }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: "The file is larger than 15 MB" }, 400);
    // PDF magic number guard — %PDF
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return json({ error: "Only PDF files can be uploaded" }, 400);
    }

    const table = kind === "body" ? "howbody_body_reports" : "howbody_posture_reports";
    const { data: report } = await supabase
      .from(table)
      .select("id, member_id")
      .eq("id", report_id)
      .maybeSingle();
    if (!report) return json({ error: "Report not found" }, 404);

    const { data: member } = await supabase
      .from("members")
      .select("id, branch_id")
      .eq("id", report.member_id)
      .maybeSingle();

    const path = `scans/${report.member_id}/original/${kind}-${report_id}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("attachments")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    const { data: signed } = await supabase.storage
      .from("attachments")
      .createSignedUrl(path, 60 * 60 * 24 * 30);

    const { error: dErr } = await supabase
      .from("scan_report_deliveries")
      .upsert({
        report_id,
        kind,
        member_id: report.member_id,
        branch_id: member?.branch_id ?? null,
        original_pdf_path: path,
        pdf_source: "howbody_original",
        pdf_url: signed?.signedUrl ?? null,
      }, { onConflict: "report_id,kind" });
    if (dErr) return json({ error: dErr.message }, 500);

    return json({ ok: true, pdf_url: signed?.signedUrl ?? null, original_pdf_path: path });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
