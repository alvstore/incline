// v1.0.0 — Public self-registration with WhatsApp OTP and onboarding waiver.
// Two modes:
//   { mode: 'send_otp', phone }
//   { mode: 'verify_and_register', phone, code, registration:{...}, par_q, consents, signature_data_url }
//
// Reuses existing dispatch-communication, send-whatsapp + send-sms fallback,
// phoneVariants() identity helper, captureEdgeError, and signMemberDocument.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { phoneVariants, normalizePhone } from "../_shared/phone.ts";

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

  await Promise.allSettled(deliveries);

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

  const draw = (text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    ensure(size + 6);
    page.drawText(text, {
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
    const words = String(text).split(/\s+/).filter(Boolean);
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

  draw("THE INCLINE LIFE BY INCLINE", { size: 14, bold: true });
  draw("Membership Registration, Waiver & Consent", { size: 12, bold: true });
  draw(`Branch: ${input.branch_name}   |   Document: REG-${input.member_code}`, { size: 9 });

  section("Member Information");
  field("Full Name", input.full_name);
  field("Member Code", input.member_code);
  field("Email", input.email);
  field("Phone", input.phone);
  field("Gender", reg.gender);
  field("Date of Birth", reg.date_of_birth);
  field("Address", [reg.address, reg.city, reg.state, reg.postal_code].filter(Boolean).join(", "));

  section("Government ID");
  field("ID Type", reg.government_id_type ? reg.government_id_type.toUpperCase() : null);
  field("ID Number", reg.government_id_number);

  section("Emergency Contact");
  field("Name", reg.emergency_contact_name);
  field("Phone", reg.emergency_contact_phone);

  section("Health & Fitness");
  field("Primary Fitness Goal", reg.fitness_goals);
  field("Health Conditions / Injuries", reg.health_conditions || "None declared");

  section("Assumption of Risk & Release");
  const waiverLines = [
    "I acknowledge that physical exercise and use of gym facilities involve",
    "inherent risk of injury. I voluntarily assume all such risks and agree to",
    "follow all gym rules, trainer instructions, and equipment guidelines. I",
    "release The Incline Life by Incline, its staff and contractors from",
    "liability for any injury, loss, or damage arising from my participation,",
    "except in cases of gross negligence.",
  ];
  for (const l of waiverLines) draw(l);

  section("PAR-Q Health Declaration");
  let qi = 1;
  for (const [q, a] of Object.entries(input.par_q)) {
    drawWrapped(`${qi}. ${q} — ${String(a).toUpperCase()}`, { size: 9 });
    qi++;
  }

  if (input.custom_terms && input.custom_terms.trim()) {
    section("Additional Terms");
    drawWrapped(input.custom_terms.trim(), { size: 9 });
  }

  section("Consents (DPDP Act 2023)");
  for (const [k, v] of Object.entries(input.consents)) {
    draw(`• ${k}: ${v ? "GRANTED" : "DECLINED"}`, { size: 9 });
  }

  section("Declaration & Signature");
  drawWrapped(
    "I confirm that the information provided above is true and complete to the best of my knowledge, and that I have read and accepted the waiver, terms and consents recorded in this document.",
    { size: 9 },
  );
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

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateWaiverPdf({
      member_code: member.member_code ?? member.id,
      full_name: reg.full_name,
      email: reg.email,
      phone,
      branch_name: branch.name,
      registration: reg,
      custom_terms: customTerms,
      par_q,
      consents,
      ip,
      ua,
      signed_at: signedAt,
      signature_png_bytes: signatureBytes,
    });
  } catch (e) {
    await captureEdgeError("register-member", e, { route: "pdf_render" });
    return json(500, { error: "pdf_render_failed" });
  }

  const { error: pdfUpErr } = await admin.storage
    .from("member-onboarding")
    .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (pdfUpErr) {
    await captureEdgeError("register-member", pdfUpErr, { route: "pdf_upload" });
    return json(500, { error: "pdf_upload_failed", detail: pdfUpErr.message });
  }

  // 8) Insert signature row
  const { error: sigRowErr } = await admin.from("member_onboarding_signatures").insert({
    member_id: member.id,
    signature_path: sigPath,
    waiver_pdf_path: pdfPath,
    par_q,
    consents,
    signer_ip: ip,
    signer_user_agent: ua,
    signed_at: signedAt,
  });
  if (sigRowErr) await captureEdgeError("register-member", sigRowErr, { route: "sig_row_insert" });

  // 9) Mark OTP consumed
  await admin.from("otp_verifications").update({ consumed_at: signedAt }).eq("id", otp.id);

  // 10) Sign in to get session tokens
  const { data: session, error: sessErr } = await admin.auth.signInWithPassword({
    email: reg.email,
    password: tempPassword,
  });
  if (sessErr) await captureEdgeError("register-member", sessErr, { route: "session_signin" });

  // 11) Fire-and-forget staff notification
  try {
    await admin.functions.invoke("notify-staff-handoff", {
      body: {
        kind: "member_self_registered",
        member_id: member.id,
        branch_id: reg.branch_id,
        full_name: reg.full_name,
        phone,
      },
    });
  } catch (e) {
    await captureEdgeError("register-member", e, { route: "notify_staff" });
  }

  // 12) Fire-and-forget welcome. The dispatcher handles ONE channel per call,
  // so we dispatch WhatsApp, SMS and Email as independent invocations to
  // guarantee the member gets a welcome even if one template isn't authored.
  // Every message carries the member code AND the portal login link.
  const LOGIN_URL = "https://theincline.in/auth";
  const welcomeVars = {
    name: reg.full_name,
    member_name: reg.full_name,
    member_code: member.member_code ?? "",
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

  for (const c of welcomeChannels) {
    try {
      await admin.functions.invoke("dispatch-communication", {
        body: {
          event: "member_created",
          channel: c.channel,
          member_id: member.id,
          branch_id: reg.branch_id,
          recipient: c.recipient,
          dedupe_key: `member_created:${member.id}:${c.channel}`,
          variables: welcomeVars,
          ...(c.channel === "email"
            ? {
                payload: {
                  subject: `Welcome to The Incline Life, ${reg.full_name}!`,
                  body: welcomeFallback,
                  use_branded_template: true,
                },
              }
            : {}),
          fallback_body: welcomeFallback,
        },
      });
    } catch (e) {
      await captureEdgeError("register-member", e, { route: `welcome_dispatch_${c.channel}` });
    }
  }


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
