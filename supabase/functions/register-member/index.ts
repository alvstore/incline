// v1.4.0 — Public self-registration with WhatsApp OTP and the unified agreement.
// 1.4.0: the agreement PDF is rendered by the ONE shared renderer
//        (_shared/membershipAgreementPdf.ts) — same document as the staff
//        drawer, prints and downloads. No local PDF code, no version branding.
// 1.3.0: every mandatory acknowledgement (REQUIRED_ACKNOWLEDGEMENT_KEYS) is
//        enforced server-side, not just dpdp/whatsapp/waiver.
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
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import { renderMembershipAgreementPdf } from "../_shared/membershipAgreementPdf.ts";
import { phoneVariants, normalizePhone } from "../_shared/phone.ts";
import {
  AGREEMENT_ACKNOWLEDGEMENTS,
  AGREEMENT_VERSION,
  REQUIRED_ACKNOWLEDGEMENT_KEYS,
} from "../_shared/agreement.ts";

/** Must match `membership-agreement` so its self-heal check recognises fresh documents. */
const AGREEMENT_RENDERER = "membershipAgreementPdf/1.0.0";
const AGREEMENT_BUCKET = "member-onboarding";

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
    // Same response as a fresh code so the endpoint never reveals registration status.
    return json(200, { status: "sent", expires_in_seconds: 300, channels: ["whatsapp"], template_used: true });
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

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = dataUrl.match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/);
  if (!m) throw new Error("invalid_signature_data_url");
  if (m[1].length > 700_000) throw new Error("signature_too_large");
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
  const termsVersion = body.terms_version ? String(body.terms_version).slice(0, 64) : AGREEMENT_VERSION;
  // Every mandatory acknowledgement is a condition of membership; the /register
  // page blocks submission without them, and the server must agree.
  const missingRequired = REQUIRED_ACKNOWLEDGEMENT_KEYS.filter((k) => consents[k] !== true);
  if (missingRequired.length) {
    return json(400, { error: "required_consents_missing", missing: missingRequired });
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
    .select("id, name, phone, email")
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
    const msg = String(authErr?.message || "");
    // Already-registered email/phone is a user-input problem, not a server fault.
    if (/already been registered|already registered|already exists|duplicate/i.test(msg)) {
      return json(409, {
        error: "account_exists",
        detail:
          "An account already exists with this email or phone number. Please sign in, or use 'Forgot password' to regain access.",
      });
    }
    await captureEdgeError("register-member", authErr, { route: "create_user" });
    return json(500, { error: "user_creation_failed", detail: msg });
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
  const pdfPath = `${member.id}/membership-agreement.pdf`;

  const { error: sigUpErr } = await admin.storage
    .from(AGREEMENT_BUCKET)
    .upload(sigPath, signatureBytes, { contentType: "image/png", upsert: true });
  if (sigUpErr) {
    await captureEdgeError("register-member", sigUpErr, { route: "sig_upload" });
    return json(500, { error: "signature_upload_failed", detail: sigUpErr.message });
  }

  // 8) Insert the consent/signature row immediately — it is the legal record.
  //    The waiver PDF is rendered and uploaded in the background right after.
  const pendingPlan = (reg as unknown as { pending_plan?: string | null }).pending_plan ?? null;
  const acks: Record<string, boolean> = Object.fromEntries(
    AGREEMENT_ACKNOWLEDGEMENTS.map((a) => [a.key, consents[a.key] === true]),
  );
  const { error: sigRowErr } = await admin.from("member_onboarding_signatures").insert({
    member_id: member.id,
    signature_path: sigPath,
    waiver_pdf_path: pdfPath,
    par_q,
    consents: {
      ...acks,
      source: "self_register",
      pdf_bucket: AGREEMENT_BUCKET,
      pending_plan: pendingPlan,
      agreement_renderer: AGREEMENT_RENDERER,
      agreement_rendered_at: signedAt,
    },
    custom_terms: customTerms,
    terms_version: termsVersion,
    signer_ip: ip,
    signer_user_agent: ua,
    signed_at: signedAt,
  });
  if (sigRowErr) await captureEdgeError("register-member", sigRowErr, { route: "sig_row_insert" });

  backgroundTask((async () => {
    const pdfBytes = await renderMembershipAgreementPdf({
      member: {
        name: reg.full_name,
        code: member.member_code ?? null,
        memberId: member.id,
        email: reg.email,
        phone,
        gender: reg.gender,
        dateOfBirth: reg.date_of_birth,
        address: reg.address,
        city: reg.city,
        state: reg.state,
        postalCode: reg.postal_code,
        emergencyContactName: reg.emergency_contact_name,
        emergencyContactPhone: reg.emergency_contact_phone,
        governmentIdType: reg.government_id_type,
        governmentIdNumber: reg.government_id_number,
        fitnessGoals: reg.fitness_goals,
        healthConditions: reg.health_conditions,
      },
      membership: { planInterest: pendingPlan, registeredOn: signedAt },
      branch: { name: branch.name, phone: branch.phone, email: branch.email },
      parq: par_q,
      acknowledgements: acks,
      customTerms,
      signature: { pngBytes: signatureBytes, signedAt, ip },
    });
    const { error: pdfUpErr } = await admin.storage
      .from(AGREEMENT_BUCKET)
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (pdfUpErr) {
      await captureEdgeError("register-member", pdfUpErr, { route: "pdf_upload" });
      return;
    }
    // Document vault entry — the ONE "Membership Agreement" per member.
    const { error: docErr } = await admin.from("member_documents").insert({
      member_id: member.id,
      document_type: "registration_form",
      file_url: "",
      storage_path: pdfPath,
      file_name: `Membership-Agreement-${(member.member_code ?? member.id.slice(0, 8)).replace(/[^A-Za-z0-9-]/g, "")}.pdf`,
    });
    if (docErr) await captureEdgeError("register-member", docErr, { route: "doc_row_insert" });
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
