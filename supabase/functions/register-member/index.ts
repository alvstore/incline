// v1.2.0 — Public self-registration with WhatsApp OTP and onboarding waiver.
// Two modes:
//   { mode: 'send_otp', phone }
//   { mode: 'verify_and_register', phone, code, registration:{...}, par_q, consents, signature_data_url }
//
// Latency: OTP delivery, waiver PDF render/upload, staff handoff and welcome
// messages all run as background tasks (EdgeRuntime.waitUntil) so the member
// never waits on them. Everything their account depends on stays inline.
// Reuses existing dispatch-communication, send-whatsapp + send-sms fallback,
// phoneVariants() identity helper, captureEdgeError, and signMemberDocument.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { phoneVariants, normalizePhone } from "../_shared/phone.ts";
import { FACILITY_TERMS, TERMS_VERSION } from "../_shared/terms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Keeps the isolate alive for post-response work without blocking the caller. */
function backgroundTask(p: Promise<unknown>) {
  const safe = p.catch((e) => captureEdgeError("register-member", e, { route: "background_task" }));
  try {
    (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil?.(safe);
  } catch {
    /* runtime without waitUntil — the promise still runs best-effort */
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function genOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}

function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
}

interface RegistrationPayload {
  full_name: string;
  email: string;
  phone: string;
  branch_id: string;
  date_of_birth?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  fitness_goals?: string | null;
  health_conditions?: string | null;
  government_id_type?: string | null;
  government_id_number?: string | null;
}

function validateRegistration(p: unknown): { ok: true; data: RegistrationPayload } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "invalid_payload" };
  const r = p as Record<string, unknown>;
  const required = ["full_name", "email", "phone", "branch_id"] as const;
  for (const k of required) {
    if (!r[k] || typeof r[k] !== "string" || !(r[k] as string).trim()) {
      return { ok: false, error: `missing_${k}` };
    }
  }
  const email = String(r.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid_email" };
  const phone = normalizePhone(String(r.phone));
  if (!/^\+\d{10,15}$/.test(phone)) return { ok: false, error: "invalid_phone" };
  return {
    ok: true,
    data: {
      full_name: String(r.full_name).trim().slice(0, 120),
      email,
      phone,
      branch_id: String(r.branch_id),
      date_of_birth: r.date_of_birth ? String(r.date_of_birth) : null,
      gender: r.gender ? String(r.gender) : null,
      address: r.address ? String(r.address).slice(0, 500) : null,
      city: r.city ? String(r.city).slice(0, 80) : null,
      state: r.state ? String(r.state).slice(0, 80) : null,
      postal_code: r.postal_code ? String(r.postal_code).slice(0, 20) : null,
      emergency_contact_name: r.emergency_contact_name ? String(r.emergency_contact_name).slice(0, 120) : null,
      emergency_contact_phone: r.emergency_contact_phone ? normalizePhone(String(r.emergency_contact_phone)) : null,
      fitness_goals: r.fitness_goals ? String(r.fitness_goals).slice(0, 1000) : null,
      health_conditions: r.health_conditions ? String(r.health_conditions).slice(0, 1000) : null,
      government_id_type: r.government_id_type ? String(r.government_id_type).slice(0, 30) : null,
      government_id_number: r.government_id_number ? String(r.government_id_number).slice(0, 30) : null,
    },
  };
}

async function isExistingMember(phone: string): Promise<boolean> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return false;
  const { data } = await admin
    .from("profiles")
    .select("id, members:members!inner(id)")
    .in("phone", variants)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function rateLimitOtp(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await admin
    .from("otp_verifications")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", since);
  return (count ?? 0) >= 3;
}

async function sendOtpHandler(req: Request, body: Record<string, unknown>): Promise<Response> {
  const phone = normalizePhone(String(body.phone || ""));
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  if (!/^\+\d{10,15}$/.test(phone)) return json(400, { error: "invalid_phone" });

  if (await isExistingMember(phone)) {
    return json(200, { status: "already_member", message: "This number is already registered. Please log in." });
  }
  if (await rateLimitOtp(phone)) {
    return json(429, { status: "rate_limited", message: "Too many requests. Try again in 10 minutes." });
  }

  const code = genOtp();
  const code_hash = await sha256Hex(code);
  const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

  const { error: insErr } = await admin
    .from("otp_verifications")
    .insert({ phone, code_hash, expires_at });
  if (insErr) {
    await captureEdgeError("register-member", insErr, { route: "send_otp" });
    return json(500, { error: "otp_persist_failed" });
  }

  // Resolve a branch_id and the approved AUTHENTICATION otp_verification template.
  const { data: branchRow } = await admin
    .from("branches")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const branch_id = branchRow?.id;
  if (!branch_id) return json(500, { error: "no_active_branch" });

  const { data: otpTpl } = await admin
    .from("templates")
    .select("id, content")
    .eq("type", "whatsapp")
    .eq("trigger_event", "otp_verification")
    .eq("meta_template_status", "APPROVED")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const dedupe_key = `otp:${phone}:${Date.now()}`;
  const fallbackBody = `Your Incline verification code is *${code}*. It expires in 5 minutes. Do not share this code.`;

  const deliveries: Promise<unknown>[] = [];
  // 1) WhatsApp via approved authentication template (so Meta accepts it
  //    outside the 24h customer-care window).
  deliveries.push(admin.functions.invoke("dispatch-communication", {
    body: {
      branch_id,
      channel: "whatsapp",
      category: "transactional",
      recipient: phone,
      template_id: otpTpl?.id ?? null,
      payload: {
        body: otpTpl?.content || fallbackBody,
        variables: { code, otp: code, expires_in: "5", "1": code },
      },
      dedupe_key,
      force: true,
    },
  }).catch((e) => captureEdgeError("register-member", e, { route: "send_otp_whatsapp" })));

  // 2) Email fallback when caller supplies an email — gives the user a
  //    second channel if WhatsApp is blocked / not on their phone.
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    deliveries.push(admin.functions.invoke("dispatch-communication", {
      body: {
        branch_id,
        channel: "email",
        category: "transactional",
        recipient: email,
        payload: {
          subject: "Your Incline verification code",
          body: `<p>Hi,</p><p>Your verification code is <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>It expires in 5 minutes. Do not share this code.</p>`,
          variables: { code },
        },
        dedupe_key: `${dedupe_key}:email`,
        force: true,
      },
    }).catch((e) => captureEdgeError("register-member", e, { route: "send_otp_email" })));
  }

  // Don't make the member wait on WhatsApp/email delivery — respond as soon as
  // the code is persisted and let dispatch finish in the background.
  backgroundTask(Promise.allSettled(deliveries));

  return json(200, {
    status: "sent",
    expires_in_seconds: 300,
    channels: email ? ["whatsapp", "email"] : ["whatsapp"],
    template_used: !!otpTpl?.id,
  });
}

async function generateWaiverPdf(input: {
  member_code: string;
  full_name: string;
  email: string;
  phone: string;
  branch_name: string;
  registration: RegistrationPayload;
  custom_terms?: string | null;
  terms_version?: string | null;
  par_q: Record<string, string>;
  consents: Record<string, boolean>;
  ip: string | null;
  ua: string | null;
  signed_at: string;
  signature_png_bytes: Uint8Array;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const pageW = 595, pageH = 842; // A4
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - 42;

  const ensure = (needed: number) => {
    if (y - needed < 60) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - 42;
    }
  };

  // pdf-lib standard fonts are WinAnsi-only: "₹" and other non-Latin-1 glyphs throw.
  const win = (s: unknown): string =>
    String(s ?? "")
      .replace(/\u20b9/g, "Rs.")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");

  const draw = (text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    ensure(size + 6);
    page.drawText(win(text), {
      x: margin + (opts.indent ?? 0),
      y,
      size,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? rgb(0.1, 0.1, 0.15),
    });
    y -= size + 4;
  };

  // Word-wrap helper so long addresses / custom terms never overflow the page.
  const drawWrapped = (text: string, opts: { size?: number; bold?: boolean; indent?: number } = {}) => {
    const size = opts.size ?? 9;
    const f = opts.bold ? fontBold : font;
    const maxW = pageW - margin * 2 - (opts.indent ?? 0);
    const words = win(text).split(/\s+/).filter(Boolean);

    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(candidate, size) > maxW) {
        if (line) draw(line, { ...opts, size });
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) draw(line, { ...opts, size });
  };

  const section = (title: string) => {
    ensure(26);
    y -= 6;
    draw(title.toUpperCase(), { size: 11, bold: true, color: rgb(0.28, 0.24, 0.72) });
  };

  const field = (label: string, value?: string | null) => {
    drawWrapped(`${label}: ${value && String(value).trim() ? value : "—"}`, { size: 9 });
  };

  const reg = input.registration;

  // ---- Branded header band (mirrors the in-app branded PDF chrome) --------
  page.drawRectangle({ x: 0, y: pageH - 92, width: pageW, height: 92, color: rgb(0.31, 0.27, 0.9) });
  page.drawText(win("THE INCLINE LIFE BY INCLINE"), {
    x: margin, y: pageH - 40, size: 16, font: fontBold, color: rgb(1, 1, 1),
  });
  page.drawText(win(AGREEMENT_TITLE), {
    x: margin, y: pageH - 58, size: 12, font: fontBold, color: rgb(0.92, 0.94, 1),
  });
  page.drawText(
    win(`${input.branch_name}  |  AGR-${input.member_code}  |  v${input.terms_version || AGREEMENT_VERSION}`),
    { x: margin, y: pageH - 74, size: 9, font, color: rgb(0.88, 0.9, 1) },
  );
  y = pageH - 110;

  const partHeading = (id: string, title: string, intro?: string) => {
    section(`Part ${id} — ${title}`);
    if (intro) drawWrapped(intro, { size: 8 });
  };

  const acksForPart = (id: string) => {
    const items = AGREEMENT_ACKNOWLEDGEMENTS.filter((a) => a.part === id);
    for (const a of items) {
      const granted = input.consents[a.key] === true;
      drawWrapped(`[${granted ? "X" : " "}] ${a.label}`, { size: 8.5 });
    }
  };

  for (const part of AGREEMENT_PARTS) {
    partHeading(part.id, part.title, part.intro);

    if (part.id === "A") {
      field("Full Name", input.full_name);
      field("Member Code", input.member_code);
      field("Email", input.email);
      field("Phone", input.phone);
      field("Gender", reg.gender);
      field("Date of Birth", reg.date_of_birth);
      field("Address", [reg.address, reg.city, reg.state, reg.postal_code].filter(Boolean).join(", "));
      field(
        "Government ID",
        [reg.government_id_type ? reg.government_id_type.toUpperCase() : null, reg.government_id_number]
          .filter(Boolean).join(" / "),
      );
      field(
        "Emergency Contact",
        [reg.emergency_contact_name, reg.emergency_contact_phone].filter(Boolean).join(" / "),
      );
    }

    if (part.id === "B") {
      field("Branch", input.branch_name);
      field("Plan Interest", (reg as unknown as { pending_plan?: string }).pending_plan ?? null);
      field("Registered On", input.signed_at);
    }

    if (part.id === "C") {
      field("Primary Fitness Goal", reg.fitness_goals);
      field("Health Conditions / Injuries", reg.health_conditions || "None declared");
      let qi = 1;
      for (const [q, a] of Object.entries(input.par_q)) {
        drawWrapped(`${qi}. ${q} — ${String(a).toUpperCase()}`, { size: 9 });
        qi++;
      }
    }

    let ci = 1;
    for (const clause of part.clauses) {
      drawWrapped(`${ci}. ${clause.title}`, { size: 9, bold: true });
      drawWrapped(clause.body, { size: 8 });
      ci++;
    }

    if (part.id === "E" && input.custom_terms && input.custom_terms.trim()) {
      drawWrapped("Member-Specific Addendum", { size: 9, bold: true });
      drawWrapped(input.custom_terms.trim(), { size: 8 });
    }

    acksForPart(part.id);
  }

  drawWrapped(FINAL_DECLARATION, { size: 9 });

  try {
    const sigImg = await pdf.embedPng(input.signature_png_bytes);
    const sigDims = sigImg.scale(0.4);
    const sigW = Math.min(sigDims.width, 240);
    const sigH = (sigW / sigDims.width) * sigDims.height;
    ensure(sigH + 30);
    y -= sigH;
    page.drawImage(sigImg, { x: margin, y, width: sigW, height: sigH });
    y -= 8;
  } catch {
    draw("(signature image unavailable)");
  }

  draw(`Signed by: ${input.full_name}`, { size: 9 });
  draw(`Signed at: ${input.signed_at}`, { size: 9 });
  draw(`IP: ${input.ip ?? "unknown"}   UA: ${(input.ua ?? "unknown").slice(0, 90)}`, { size: 8 });

  return await pdf.save();
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = dataUrl.match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/);
  if (!m) throw new Error("invalid_signature_data_url");
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyAndRegisterHandler(req: Request, body: Record<string, unknown>): Promise<Response> {
  const phone = normalizePhone(String(body.phone || ""));
  const code = String(body.code || "").trim();
  if (!/^\d{6}$/.test(code)) return json(400, { error: "invalid_code_format" });

  const validated = validateRegistration(body.registration);
  if (!validated.ok) return json(400, { error: validated.error });
  const reg = validated.data;
  if (normalizePhone(reg.phone) !== phone) return json(400, { error: "phone_mismatch" });

  const sigDataUrl = String(body.signature_data_url || "");
  if (!sigDataUrl) return json(400, { error: "missing_signature" });

  const par_q = (body.par_q && typeof body.par_q === "object" ? body.par_q : {}) as Record<string, string>;
  const consents = (body.consents && typeof body.consents === "object" ? body.consents : {}) as Record<string, boolean>;
  // Optional branch/campaign-specific terms shown on /register — printed on the
  // contract and persisted so staff reprints match exactly.
  const customTerms = body.custom_terms ? String(body.custom_terms).slice(0, 4000) : null;
  const termsVersion = body.terms_version ? String(body.terms_version).slice(0, 64) : TERMS_VERSION;
  if (!consents.dpdp || !consents.whatsapp || !consents.waiver) {
    return json(400, { error: "required_consents_missing" });
  }

  // 1) Find latest unconsumed OTP
  const { data: otp, error: otpErr } = await admin
    .from("otp_verifications")
    .select("id, code_hash, attempts, expires_at, consumed_at")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpErr) {
    await captureEdgeError("register-member", otpErr, { route: "verify_lookup" });
    return json(500, { error: "otp_lookup_failed" });
  }
  if (!otp) return json(400, { error: "otp_not_found" });
  if (new Date(otp.expires_at).getTime() < Date.now()) return json(400, { error: "otp_expired" });
  if (otp.attempts >= 5) return json(429, { error: "too_many_attempts" });

  const codeHash = await sha256Hex(code);
  if (codeHash !== otp.code_hash) {
    await admin.from("otp_verifications").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
    return json(400, { error: "otp_invalid" });
  }

  // 2) Re-check that phone hasn't been claimed since the OTP was sent
  if (await isExistingMember(phone)) {
    await admin.from("otp_verifications").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);
    return json(409, { error: "already_member" });
  }

  // 3) Validate branch
  const { data: branch } = await admin
    .from("branches")
    .select("id, name")
    .eq("id", reg.branch_id)
    .eq("is_active", true)
    .maybeSingle();
  if (!branch) return json(400, { error: "invalid_branch" });

  // 4) Create auth user
  const tempPassword = crypto.randomUUID() + crypto.randomUUID().slice(0, 8) + "!Aa1";
  const { data: authRes, error: authErr } = await admin.auth.admin.createUser({
    email: reg.email,
    phone: phone.replace(/^\+/, ""), // Supabase phone is digits-only
    password: tempPassword,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { full_name: reg.full_name, source: "self_register" },
  });
  if (authErr || !authRes?.user) {
    await captureEdgeError("register-member", authErr, { route: "create_user" });
    return json(500, { error: "user_creation_failed", detail: authErr?.message });
  }
  const userId = authRes.user.id;

  // 5) Upsert profile
  const { error: profErr } = await admin.from("profiles").upsert({
    id: userId,
    email: reg.email,
    full_name: reg.full_name,
    phone,
    date_of_birth: reg.date_of_birth,
    gender: reg.gender,
    address: reg.address,
    city: reg.city,
    state: reg.state,
    postal_code: reg.postal_code,
    emergency_contact_name: reg.emergency_contact_name,
    emergency_contact_phone: reg.emergency_contact_phone,
    government_id_type: reg.government_id_type,
    government_id_number: reg.government_id_number,
    must_set_password: true,
  });
  if (profErr) {
    await captureEdgeError("register-member", profErr, { route: "profile_insert" });
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: "profile_insert_failed", detail: profErr.message });
  }

  // 6) Insert member
  const { data: member, error: memErr } = await admin
    .from("members")
    .insert({
      user_id: userId,
      branch_id: reg.branch_id,
      status: "active",
      source: "self_register",
      lifecycle_state: "pending_plan",
      fitness_goals: reg.fitness_goals,
      health_conditions: reg.health_conditions,
    })
    .select("id, member_code")
    .single();
  if (memErr || !member) {
    await captureEdgeError("register-member", memErr, { route: "member_insert" });
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: "member_insert_failed", detail: memErr?.message });
  }

  // 7) Render PDF + upload artefacts
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = dataUrlToBytes(sigDataUrl);
  } catch (e) {
    await captureEdgeError("register-member", e, { route: "decode_signature" });
    return json(400, { error: "invalid_signature" });
  }

  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");
  const signedAt = new Date().toISOString();

  const sigPath = `${member.id}/signature.png`;
  const pdfPath = `${member.id}/onboarding-waiver.pdf`;

  const { error: sigUpErr } = await admin.storage
    .from("member-onboarding")
    .upload(sigPath, signatureBytes, { contentType: "image/png", upsert: true });
  if (sigUpErr) {
    await captureEdgeError("register-member", sigUpErr, { route: "sig_upload" });
    return json(500, { error: "signature_upload_failed", detail: sigUpErr.message });
  }

  // 8) Insert the consent/signature row immediately — it is the legal record.
  //    The waiver PDF is rendered and uploaded in the background right after.
  const { error: sigRowErr } = await admin.from("member_onboarding_signatures").insert({
    member_id: member.id,
    signature_path: sigPath,
    waiver_pdf_path: pdfPath,
    par_q,
    consents,
    custom_terms: customTerms,
    terms_version: termsVersion,
    signer_ip: ip,
    signer_user_agent: ua,
    signed_at: signedAt,
  });
  if (sigRowErr) await captureEdgeError("register-member", sigRowErr, { route: "sig_row_insert" });

  backgroundTask((async () => {
    const pdfBytes = await generateWaiverPdf({
      member_code: member.member_code ?? member.id,
      full_name: reg.full_name,
      email: reg.email,
      phone,
      branch_name: branch.name,
      registration: reg,
      custom_terms: customTerms,
      terms_version: termsVersion,
      par_q,
      consents,
      ip,
      ua,
      signed_at: signedAt,
      signature_png_bytes: signatureBytes,
    });
    const { error: pdfUpErr } = await admin.storage
      .from("member-onboarding")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (pdfUpErr) await captureEdgeError("register-member", pdfUpErr, { route: "pdf_upload" });
  })());


  // 9) Mark OTP consumed
  await admin.from("otp_verifications").update({ consumed_at: signedAt }).eq("id", otp.id);

  // 10) Sign in to get session tokens
  const { data: session, error: sessErr } = await admin.auth.signInWithPassword({
    email: reg.email,
    password: tempPassword,
  });
  if (sessErr) await captureEdgeError("register-member", sessErr, { route: "session_signin" });

  // 11) Staff notification — background.
  // notify-staff-handoff requires `member_phone` + `reason`; sending `phone`
  // made every self-registration log a 400 from this background task.
  backgroundTask(admin.functions.invoke("notify-staff-handoff", {
    body: {
      member_phone: phone,
      branch_id: reg.branch_id,
      reason: `New self-registration: ${reg.full_name}`,
    },
  }).then((r) => {
    if ((r as { error?: unknown })?.error) {
      return captureEdgeError("register-member", (r as { error: unknown }).error, { route: "notify_staff" });
    }
  }));

  // 12) Welcome messages — background, all channels in parallel. The dispatcher
  // handles ONE channel per call, so WhatsApp, SMS and Email go out as separate
  // invocations. Every message carries the member code AND the portal login link.
  const LOGIN_URL = "https://theincline.in/auth";
  // v1.4.0: the approved welcome templates carry a `{{membership_plan}}` slot.
  // It used to be omitted, so Meta filled it positionally with the member name
  // ("Your <name> membership is now active"). Registration happens BEFORE a
  // plan is bought, so we send an honest value instead of a false claim.
  const welcomeVars = {
    name: reg.full_name,
    member_name: reg.full_name,
    member_code: member.member_code ?? "",
    membership_plan: "Incline",
    plan_name: "Incline",
    branch_name: branch.name,
    login_url: LOGIN_URL,
    login_link: LOGIN_URL,
  };

  const welcomeFallback =
    `Hi ${reg.full_name}, welcome to The Incline Life by Incline! ` +
    `Your member code is ${member.member_code ?? ""}. ` +
    `Log in to your member portal at ${LOGIN_URL} — use "Forgot password" the first time to set your password. ` +
    `Visit reception to activate your plan.`;

  const welcomeChannels: Array<{ channel: "whatsapp" | "sms" | "email"; recipient: string }> = [];
  if (phone) welcomeChannels.push({ channel: "whatsapp", recipient: phone });
  if (phone) welcomeChannels.push({ channel: "sms", recipient: phone });
  if (reg.email) welcomeChannels.push({ channel: "email", recipient: reg.email });

  // The dispatcher contract requires `category` + `payload.body`; anything else
  // is rejected 400 before a log row is written (this is why welcome messages
  // never appeared). Event resolution happens via payload.variables.event_key.
  // Any channel that fails is written into communication_retry_queue so the
  // 5-minute worker retries it instead of the send being lost.
  backgroundTask(Promise.allSettled(welcomeChannels.map(async (c) => {
    const body = {
      branch_id: reg.branch_id,
      channel: c.channel,
      category: "transactional",
      recipient: c.recipient,
      member_id: member.id,
      dedupe_key: `member_created:${member.id}:${c.channel}`,
      force: true,
      source_caller: "register-member",
      payload: {
        ...(c.channel === "email"
          ? {
              subject: `Welcome to The Incline Life, ${reg.full_name}!`,
              use_branded_template: true,
            }
          : {}),
        body: welcomeFallback,
        variables: { ...welcomeVars, event_key: "member_created" },
      },
    };
    let reason = "";
    try {
      const r = await admin.functions.invoke("dispatch-communication", { body });
      const status = (r as { data?: { status?: string; reason?: string } })?.data?.status;
      const err = (r as { error?: unknown })?.error;
      if (!err && (status === "sent" || status === "queued" || status === "deduped")) return;
      if (status === "suppressed") return; // preference / kill-switch — terminal
      reason = String(
        (r as { data?: { reason?: string } })?.data?.reason ??
          (err instanceof Error ? err.message : err ?? "dispatch_failed"),
      );
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    await captureEdgeError("register-member", new Error(reason), {
      route: `welcome_dispatch_${c.channel}`,
    });
    await admin.from("communication_retry_queue").insert({
      branch_id: reg.branch_id,
      member_id: member.id,
      type: c.channel,
      recipient: c.recipient,
      subject: c.channel === "email" ? `Welcome to The Incline Life, ${reg.full_name}!` : null,
      content: welcomeFallback,
      status: "pending",
      retry_count: 0,
      max_retries: 3,
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      last_error: reason.slice(0, 500),
      metadata: {
        category: "transactional",
        event_key: "member_created",
        source: "register-member",
        // Replayed verbatim by process-comm-retry-queue v2.4.0 so the retry
        // resolves the same approved template as the first attempt.
        variables: { ...welcomeVars, event_key: "member_created" },
      },

    });
  })));




  return json(200, {
    status: "ok",
    member_id: member.id,
    member_code: member.member_code,
    user_id: userId,
    access_token: session?.session?.access_token ?? null,
    refresh_token: session?.session?.refresh_token ?? null,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const mode = String(body.mode || "");
    if (mode === "send_otp") return await sendOtpHandler(req, body);
    if (mode === "verify_and_register") return await verifyAndRegisterHandler(req, body);
    return json(400, { error: "invalid_mode" });
  } catch (e) {
    await captureEdgeError("register-member", e, { route: "top_level" });
    return json(500, { error: "internal_error", detail: e instanceof Error ? e.message : String(e) });
  }
});
