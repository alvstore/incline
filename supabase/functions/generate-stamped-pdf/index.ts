// v1.0.0 — Generate a branded, print-ready stamped PDF copy of a signed
// employment contract using pdf-lib (no Chromium needed). Stores the file in
// the private `contract-pdfs` bucket and returns a short-lived signed URL.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type CopyKind = "original" | "employee_copy" | "employer_copy";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id)
      .in("role", ["owner", "admin", "manager"])
      .limit(1);
    if (!roleRows || roleRows.length === 0) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const contractId = body?.contract_id;
    const copy: CopyKind = (body?.copy as CopyKind) ?? "employee_copy";
    if (!contractId) return json({ error: "Missing contract_id" }, 400);

    // Load contract + signature + employer/employee resolution
    const { data: contract, error: cErr } = await supabase
      .from("contracts")
      .select(`
        id, contract_type, start_date, end_date,
        salary, base_salary, commission_percentage, terms,
        signature_status, signed_at, witness_1, witness_2,
        governing_jurisdiction, arbitration_seat, notice_period_days,
        branch_id,
        employees(employee_code, profiles:employees_user_id_profiles_fkey(full_name, email, phone)),
        trainers(user_id)
      `)
      .eq("id", contractId)
      .single();
    if (cErr || !contract) return json({ error: "Contract not found" }, 404);

    const { data: signature } = await supabase
      .from("contract_signatures")
      .select("*")
      .eq("contract_id", contractId)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch employer/HR settings (branch first, then global)
    let { data: hrSettings } = await supabase
      .from("hr_settings")
      .select("*")
      .eq("branch_id", contract.branch_id)
      .maybeSingle();
    if (!hrSettings) {
      const { data: g } = await supabase
        .from("hr_settings")
        .select("*")
        .is("branch_id", null)
        .maybeSingle();
      hrSettings = g ?? null;
    }

    const emp: any = Array.isArray(contract.employees) ? contract.employees[0] : contract.employees;
    const empProfile: any = Array.isArray(emp?.profiles) ? emp?.profiles[0] : emp?.profiles;
    const employeeName = empProfile?.full_name || "Employee";
    const employeeCode = emp?.employee_code || "-";

    // Build PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const copyLabel = copy === "original" ? "ORIGINAL" : copy === "employer_copy" ? "EMPLOYER COPY" : "EMPLOYEE COPY";

    const pageWidth = PageSizes.A4[0];
    const pageHeight = PageSizes.A4[1];
    const marginX = 50;
    const marginY = 60;

    let page = pdfDoc.addPage(PageSizes.A4);
    let y = pageHeight - marginY;
    const lineHeight = 13;

    function drawHeader(p: any) {
      p.drawText("The Incline Life by Incline", { x: marginX, y: pageHeight - 40, size: 12, font: fontBold, color: rgb(0.18, 0.16, 0.42) });
      p.drawText(hrSettings?.employer_registered_address || "Sector 14, Udaipur, Rajasthan, India", { x: marginX, y: pageHeight - 55, size: 8, font, color: rgb(0.4, 0.4, 0.5) });
      if (hrSettings?.employer_gstin) {
        p.drawText(`GSTIN: ${hrSettings.employer_gstin}`, { x: pageWidth - marginX - 150, y: pageHeight - 55, size: 8, font, color: rgb(0.4, 0.4, 0.5) });
      }
      // Watermark (rotated text)
      p.drawText(copyLabel, {
        x: pageWidth / 2 - 100, y: pageHeight / 2,
        size: 60, font: fontBold, color: rgb(0.93, 0.93, 0.97),
        opacity: 0.6, rotate: { type: "degrees", angle: 35 } as any,
      });
    }

    function drawFooter(p: any, pageNum: number, totalPages: number) {
      p.drawText(`Contract ${contractId.slice(0, 8)} · Page ${pageNum} of ${totalPages}`, { x: marginX, y: 30, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
      p.drawText(`Verify: /verify/contract/${contractId.slice(0, 8)}`, { x: pageWidth - marginX - 140, y: 30, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
    }

    drawHeader(page);

    function newPageIfNeeded(needed = lineHeight) {
      if (y - needed < marginY + 40) {
        page = pdfDoc.addPage(PageSizes.A4);
        drawHeader(page);
        y = pageHeight - marginY - 30;
      }
    }

    function writeLine(text: string, opts: { bold?: boolean; size?: number; color?: any } = {}) {
      const size = opts.size ?? 9;
      const f = opts.bold ? fontBold : font;
      const color = opts.color ?? rgb(0.1, 0.1, 0.15);
      // Word-wrap
      const maxWidth = pageWidth - marginX * 2;
      const words = text.split(/\s+/);
      let line = "";
      for (const w of words) {
        const candidate = line ? line + " " + w : w;
        if (f.widthOfTextAtSize(candidate, size) > maxWidth) {
          newPageIfNeeded(lineHeight);
          page.drawText(line, { x: marginX, y, size, font: f, color });
          y -= lineHeight;
          line = w;
        } else {
          line = candidate;
        }
      }
      if (line) {
        newPageIfNeeded(lineHeight);
        page.drawText(line, { x: marginX, y, size, font: f, color });
        y -= lineHeight;
      }
    }

    function spacer(n = 6) {
      y -= n;
    }

    // Title
    y -= 20;
    writeLine("EMPLOYMENT AGREEMENT", { bold: true, size: 16, color: rgb(0.18, 0.16, 0.42) });
    spacer(8);

    // Body — render the terms text line by line
    const termsRaw = typeof contract.terms === "string"
      ? contract.terms
      : contract.terms?.conditions ?? JSON.stringify(contract.terms ?? {}, null, 2);

    const lines = termsRaw.split("\n");
    for (const ln of lines) {
      const trimmed = ln.replace(/^#+\s*/, "");
      const isHeading = /^#{1,3}\s/.test(ln);
      writeLine(trimmed || " ", { bold: isHeading });
      if (isHeading) spacer(2);
    }

    // Signature panel
    spacer(20);
    newPageIfNeeded(120);
    writeLine("Signatures", { bold: true, size: 12 });
    spacer(4);

    // Embed drawn signature image if present
    if (signature?.signature_image_path) {
      const { data: imgBlob } = await supabase.storage
        .from("signature-assets")
        .download(signature.signature_image_path);
      if (imgBlob) {
        try {
          const bytes = new Uint8Array(await imgBlob.arrayBuffer());
          const img = await pdfDoc.embedPng(bytes);
          const scale = Math.min(150 / img.width, 60 / img.height);
          page.drawImage(img, { x: marginX, y: y - 60, width: img.width * scale, height: img.height * scale });
          y -= 70;
        } catch (_) {
          // fall back to typed text below
        }
      }
    }
    writeLine(`Employee: ${signature?.signed_name || employeeName} (${employeeCode})`);
    writeLine(`Signed at: ${signature?.signed_at || contract.signed_at || "—"}  ·  IP: ${signature?.ip_address || "—"}`);
    if (signature?.geolocation) writeLine(`Geo: ${JSON.stringify(signature.geolocation)}`);

    spacer(10);
    writeLine(`For ${hrSettings?.employer_legal_name || "Incline"}`);
    writeLine(`Proprietor: ${hrSettings?.employer_proprietor_name || "Yogita Lekhari"}`);

    // Witnesses
    if (contract.witness_1 || contract.witness_2) {
      spacer(14);
      writeLine("Witnesses", { bold: true, size: 11 });
      if (contract.witness_1) writeLine(`1. ${(contract.witness_1 as any).name || "-"}  ·  ${(contract.witness_1 as any).phone || "-"}`);
      if (contract.witness_2) writeLine(`2. ${(contract.witness_2 as any).name || "-"}  ·  ${(contract.witness_2 as any).phone || "-"}`);
    }

    // Audit trail
    spacer(14);
    writeLine("Audit trail", { bold: true, size: 11 });
    writeLine(`Electronic signature recorded under Section 10A of the Information Technology Act, 2000.`);
    writeLine(`Terms hash at sign: ${signature?.terms_hash_at_sign || "—"}`);

    // Footer on all pages
    const pages = pdfDoc.getPages();
    pages.forEach((p, i) => drawFooter(p, i + 1, pages.length));

    const pdfBytes = await pdfDoc.save();
    const path = `${contractId}/${copy}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("contract-pdfs")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ error: "Failed to store PDF: " + upErr.message }, 500);

    // Hash + persist
    const hashBuf = await crypto.subtle.digest("SHA-256", pdfBytes);
    const signedPdfHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    await supabase
      .from("contracts")
      .update({ stamped_pdf_path: path, signed_pdf_hash: signedPdfHash })
      .eq("id", contractId);

    const { data: signedUrl, error: urlErr } = await supabase.storage
      .from("contract-pdfs")
      .createSignedUrl(path, 60);
    if (urlErr) return json({ error: "Failed to create signed URL: " + urlErr.message }, 500);

    return json({ success: true, path, signed_url: signedUrl?.signedUrl, hash: signedPdfHash, copy });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
