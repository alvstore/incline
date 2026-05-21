// v5.1.0 — Single edge function for the entire contract signing lifecycle.
//   create_link · get_contract · request_otp · fill_fields · sign_contract · get_pdf · regenerate_pdf
// Fields needed to render the full agreement (S/o-D/o, address, witnesses, …)
// are collected through the public /contract-fill page via `fill_fields` and
// persisted on `contracts.contract_variables`. The PDF builder interpolates
// them so the manager never has to retype legal boilerplate.
// OTPs are reused from the shared `otp_verifications` table.
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

type CopyKind = "original" | "employee_copy" | "employer_copy" | "draft";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body?.action;
    if (!action) return json({ error: "Missing action" }, 400);

    switch (action) {
      case "create_link":     return await createSignLink(req, body);
      case "get_contract":    return await getContractByToken(body);
      case "request_otp":     return await requestOtp(body);
      case "fill_fields":     return await fillFields(body);
      case "sign_contract":   return await signContract(req, body);
      case "get_pdf":         return await getOrBuildPdf(req, body, false);
      case "regenerate_pdf":  return await getOrBuildPdf(req, body, true);
      default:                return json({ error: "Invalid action" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

// ── Auth helper ───────────────────────────────────────────────────────────
async function assertStaff(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: json({ error: "Unauthorized" }, 401) };
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return { error: json({ error: "Unauthorized" }, 401) };
  const { data: roleRows } = await supabase
    .from("user_roles").select("role").eq("user_id", u.user.id)
    .in("role", ["owner", "admin", "manager"]).limit(1);
  if (!roleRows || roleRows.length === 0) return { error: json({ error: "Forbidden" }, 403) };
  return { userId: u.user.id };
}

// ── Allowlists per fill role ──────────────────────────────────────────────
const FILL_ALLOWLIST: Record<string, string[]> = {
  employee: [
    "father_or_husband_name", "residential_address",
    "emergency_contact_name", "emergency_contact_phone",
    "pan_or_aadhaar_last4",
  ],
  witness_1: ["witness_1_name", "witness_1_phone"],
  witness_2: ["witness_2_name", "witness_2_phone"],
  hr: [
    "probation_months", "notice_period_days",
    "witness_1_name", "witness_1_phone",
    "witness_2_name", "witness_2_phone",
  ],
};

const REQUIRED_BEFORE_SIGN = [
  "father_or_husband_name", "residential_address",
  "emergency_contact_name", "emergency_contact_phone",
  "witness_1_name", "witness_2_name",
];

function missingRequired(vars: Record<string, unknown> | null | undefined): string[] {
  const v = (vars ?? {}) as Record<string, unknown>;
  return REQUIRED_BEFORE_SIGN.filter((k) => {
    const val = v[k];
    return val === undefined || val === null || String(val).trim() === "";
  });
}

// ── Server-side prefill (mirrors src/lib/hrm/contractPrefill.ts) ──────────
function _nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function _flattenAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== "object") return null;
  const a = addr as Record<string, unknown>;
  const parts = [a.line1, a.line2, a.street, a.area, a.city, a.state, a.country, a.pin || a.postal_code || a.pincode]
    .map(_nonEmpty).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
function _last4(v: unknown): string | null {
  const s = _nonEmpty(v); if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}
async function loadPrefillForContract(contract: any): Promise<Record<string, string>> {
  // contract may carry employees(*)/trainers(*) via the joined select, but we
  // need the *full* rows including jsonb columns — fetch by user_id explicitly.
  const employeeUserId = (contract as any)?.employees?.user_id || null;
  const trainerUserId = (contract as any)?.trainers?.user_id || null;
  const userId = employeeUserId || trainerUserId || null;
  if (!userId) return {};

  const [{ data: emp }, { data: trn }, { data: prof }] = await Promise.all([
    supabase.from("employees")
      .select("father_or_spouse_name, current_address, permanent_address, emergency_contact, pan_number, aadhaar_last4")
      .eq("user_id", userId).maybeSingle(),
    supabase.from("trainers")
      .select("government_id_type, government_id_number")
      .eq("user_id", userId).maybeSingle(),
    supabase.from("profiles")
      .select("address, city, state, country, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number")
      .eq("id", userId).maybeSingle(),
  ]);

  const out: Record<string, string> = {};
  const father = _nonEmpty(emp?.father_or_spouse_name);
  if (father) out.father_or_husband_name = father;

  const addr = _flattenAddress(emp?.current_address) || _flattenAddress(emp?.permanent_address)
    || [prof?.address, prof?.city, prof?.state, prof?.country, prof?.postal_code].map(_nonEmpty).filter(Boolean).join(", ");
  if (addr) out.residential_address = addr;

  const ec = (emp?.emergency_contact ?? {}) as Record<string, unknown>;
  const ecName = _nonEmpty(ec.name) || _nonEmpty(prof?.emergency_contact_name);
  const ecPhone = _nonEmpty(ec.phone) || _nonEmpty(prof?.emergency_contact_phone);
  if (ecName) out.emergency_contact_name = ecName;
  if (ecPhone) out.emergency_contact_phone = ecPhone;

  const idLast4 = _last4(emp?.pan_number) || _nonEmpty(emp?.aadhaar_last4)
    || _last4(prof?.government_id_number) || _last4(trn?.government_id_number);
  if (idLast4) out.pan_or_aadhaar_last4 = idLast4;

  return out;
}
function mergeVarsWithPrefill(cvars: Record<string, unknown> | null | undefined, prefill: Record<string, string>): Record<string, unknown> {
  // contract_variables (HR-entered / employee-corrected) win over prefill defaults.
  return { ...prefill, ...((cvars ?? {}) as Record<string, unknown>) };
}

// ── 1. Create signing link ────────────────────────────────────────────────
async function createSignLink(req: Request, body: any) {
  const contractId = body?.contract_id;
  const role = (body?.role || "employee") as string;
  if (!contractId) return json({ error: "Missing contract_id" }, 400);
  if (!FILL_ALLOWLIST[role]) return json({ error: "Invalid role" }, 400);

  const auth = await assertStaff(req);
  if ("error" in auth) return auth.error;

  const { data: contract, error: contractError } = await supabase
    .from("contracts").select("id, branch_id").eq("id", contractId).single();
  if (contractError || !contract) return json({ error: "Contract not found" }, 404);

  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Revoke any existing open request for this (contract, role) so the unique
  // index doesn't reject us. Audit a separate row for transparency.
  await supabase.from("contract_signature_requests")
    .update({ revoked_at: new Date().toISOString(), status: "expired" })
    .eq("contract_id", contract.id).eq("role", role).is("revoked_at", null)
    .in("status", ["pending", "viewed"]);

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .insert({
      contract_id: contract.id,
      branch_id: contract.branch_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: auth.userId,
      status: "pending",
      role,
    })
    .select("id").single();

  if (requestError || !requestRow) return json({ error: "Failed to create signature request" }, 500);

  if (role === "employee") {
    await supabase.from("contracts")
      .update({ signature_status: "sent", signature_requested_at: new Date().toISOString() })
      .eq("id", contract.id);
  }

  await supabase.from("audit_logs").insert({
    action: "CONTRACT_SIGN_LINK_CREATED",
    table_name: "contracts",
    record_id: contract.id,
    user_id: auth.userId,
    branch_id: contract.branch_id,
    action_description: `Created public ${role} signing/fill link`,
    new_data: { request_id: requestRow.id, role, expires_at: expiresAt },
  });

  const appUrl = Deno.env.get("PUBLIC_APP_URL") ?? req.headers.get("origin") ?? "http://localhost:5173";
  const base = appUrl.replace(/\/$/, "");
  // Employee link defaults to the fill page (which forwards to sign once complete);
  // witness/HR links only need the fill page.
  const path = role === "employee" ? "contract-fill" : "contract-fill";
  const signUrl = `${base}/${path}/${rawToken}`;
  return json({ sign_url: signUrl, role, expires_at: expiresAt });
}

// ── 2. Get contract by signing token ─────────────────────────────────────
async function getContractByToken(body: any) {
  const token = body?.token;
  if (!token) return json({ error: "Missing token" }, 400);

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, branch_id, status, expires_at, role")
    .eq("token_hash", tokenHash).is("revoked_at", null).single();
  if (requestError || !requestRow) return json({ error: "Invalid signing link" }, 404);
  if (requestRow.status === "signed") return json({ error: "This contract is already signed" }, 410);
  if (requestRow.expires_at < now) {
    await supabase.from("contract_signature_requests").update({ status: "expired" })
      .eq("id", requestRow.id).in("status", ["pending", "viewed"]);
    return json({ error: "This signing link has expired" }, 410);
  }

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select(`
      id, contract_type, start_date, end_date, salary, base_salary, commission_percentage,
      terms, status, signature_status, branch_id, contract_variables,
      employees(user_id, employee_code, profiles:employees_user_id_profiles_fkey(full_name, phone, email)),
      trainers(user_id)
    `)
    .eq("id", requestRow.contract_id).single();
  if (contractError || !contract) return json({ error: "Contract not found" }, 404);

  if (requestRow.status === "pending") {
    await supabase.from("contract_signature_requests").update({ status: "viewed" })
      .eq("id", requestRow.id).eq("status", "pending");
    if ((requestRow as any).role === "employee") {
      await supabase.from("contracts").update({ signature_status: "viewed" })
        .eq("id", contract.id).in("signature_status", ["sent", "not_sent"]);
    }
  }

  const { name, phone, email, code } = await resolveRecipient(contract);
  const { data: employer } = await supabase.rpc("get_employer_profile", { _branch_id: contract.branch_id });

  const prefill = await loadPrefillForContract(contract);
  const cvars = (contract as any).contract_variables ?? {};
  const merged = mergeVarsWithPrefill(cvars, prefill);
  return json({
    contract: {
      id: contract.id,
      request_role: (requestRow as any).role || "employee",
      employee_name: name || "Employee",
      employee_code: code || "-",
      employee_phone_masked: maskPhone(phone),
      employee_email_masked: maskEmail(email),
      contract_type: contract.contract_type,
      start_date: contract.start_date,
      end_date: contract.end_date,
      salary: contract.base_salary ?? contract.salary,
      commission_percentage: contract.commission_percentage,
      terms: contract.terms,
      signature_status: contract.signature_status,
      contract_variables: cvars,
      prefill,
      missing_required: missingRequired(merged),
      employer,
    },
  });
}

// ── 2b. Fill role-scoped contract variables ───────────────────────────────
async function fillFields(body: any) {
  const token = body?.token;
  const submitted = (body?.variables ?? {}) as Record<string, unknown>;
  if (!token) return json({ error: "Missing token" }, 400);
  if (!submitted || typeof submitted !== "object") return json({ error: "Missing variables" }, 400);

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: requestRow } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, branch_id, status, expires_at, role")
    .eq("token_hash", tokenHash).is("revoked_at", null).single();
  if (!requestRow) return json({ error: "Invalid link" }, 404);
  if (requestRow.status === "signed") return json({ error: "Already signed" }, 410);
  if (requestRow.expires_at < now) return json({ error: "This link has expired" }, 410);

  const role = ((requestRow as any).role || "employee") as string;
  const allow = FILL_ALLOWLIST[role] || [];

  const clean: Record<string, unknown> = {};
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(submitted, k)) {
      const v = submitted[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        clean[k] = typeof v === "string" ? v.trim() : v;
      }
    }
  }
  const rejected = Object.keys(submitted).filter((k) => !allow.includes(k));

  const { data: existing } = await supabase
    .from("contracts").select(`
      contract_variables,
      employees(user_id), trainers(user_id)
    `)
    .eq("id", requestRow.contract_id).single();
  const merged = { ...((existing as any)?.contract_variables ?? {}), ...clean };

  const { error: upErr } = await supabase
    .from("contracts")
    .update({ contract_variables: merged })
    .eq("id", requestRow.contract_id);
  if (upErr) return json({ error: "Failed to save details: " + upErr.message }, 500);

  await supabase.from("audit_logs").insert({
    action: "CONTRACT_FIELDS_FILLED",
    table_name: "contracts",
    record_id: requestRow.contract_id,
    branch_id: requestRow.branch_id,
    action_description: `Contract details filled by ${role}`,
    new_data: { role, keys: Object.keys(clean), rejected_keys: rejected },
  });

  const prefill = await loadPrefillForContract(existing);
  return json({
    success: true,
    role,
    saved_keys: Object.keys(clean),
    rejected_keys: rejected,
    missing_required: missingRequired(mergeVarsWithPrefill(merged, prefill)),
  });
}

// ── 3. Request OTP (reuses shared otp_verifications + otp_verification template) ──
async function requestOtp(body: any) {
  const token = body?.token;
  const channel = (body?.channel || "whatsapp") as "whatsapp" | "sms" | "email";
  if (!token) return json({ error: "Missing token" }, 400);
  if (!["whatsapp", "sms", "email"].includes(channel)) return json({ error: "Invalid channel" }, 400);

  const tokenHash = await sha256(token);
  const { data: requestRow } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, branch_id, status, expires_at")
    .eq("token_hash", tokenHash).is("revoked_at", null).single();
  if (!requestRow) return json({ error: "Invalid signing link" }, 404);
  if (requestRow.status === "signed") return json({ error: "Already signed" }, 410);

  const { data: contract } = await supabase
    .from("contracts")
    .select(`branch_id,
      employees(employee_code, profiles:employees_user_id_profiles_fkey(full_name, phone, email)),
      trainers(user_id)`)
    .eq("id", requestRow.contract_id).single();

  const { name, phone, email } = await resolveRecipient(contract);
  const recipient = channel === "email" ? email : phone;
  if (!recipient) return json({ error: `No ${channel} address on file for this employee` }, 422);

  // Throttle: max 3 OTPs per 10 minutes per request — scoped via purpose+context_id.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recent } = await supabase
    .from("otp_verifications")
    .select("id", { count: "exact", head: true })
    .eq("purpose", "contract_sign")
    .eq("context_id", requestRow.id)
    .gte("created_at", tenMinAgo);
  if ((recent || 0) >= 3) return json({ error: "Too many OTP requests. Please try again in a few minutes." }, 429);

  const codeStr = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(codeStr);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase.from("otp_verifications").insert({
    phone: recipient,            // existing column — works for sms/wa/email recipient
    code_hash: codeHash,
    expires_at: expiresAt,
    purpose: "contract_sign",
    context_id: requestRow.id,
  });

  const { data: employer } = await supabase.rpc("get_employer_profile", { _branch_id: requestRow.branch_id });
  const employerName = (employer as any)?.legal_name || "Incline";

  // Reuse the existing, Meta-approved `otp_verification` template — variables {{code}}, {{name}}.
  const dispatchRes = await supabase.functions.invoke("dispatch-communication", {
    body: {
      branch_id: requestRow.branch_id,
      channel,
      category: "transactional",
      recipient,
      event: "otp_verification",
      payload: {
        subject: `${employerName} — Verification code`,
        body: `Your one-time code is ${codeStr}. It expires in 10 minutes. Do not share this code with anyone.`,
        variables: { code: codeStr, name: name || "there", otp: codeStr, expires_in: "10 minutes", employer_name: employerName },
        use_branded_template: channel === "email",
      },
      dedupe_key: `contract_sign_otp:${requestRow.id}:${Date.now()}:${channel}`,
      force: true,
    },
  });
  if (dispatchRes.error) return json({ error: "Could not send OTP: " + dispatchRes.error.message }, 500);

  return json({
    success: true,
    channel,
    recipient_masked: channel === "email" ? maskEmail(recipient) : maskPhone(recipient),
    expires_at: expiresAt,
  });
}

// ── 4. Sign contract (OTP gated) ──────────────────────────────────────────
async function signContract(req: Request, body: any) {
  const token = body?.token;
  const otp = String(body?.otp || "").trim();
  const signedName = String(body?.signed_name || "").trim();
  const signerContact = String(body?.signer_contact || "").trim();
  const signatureText = String(body?.signature_text || signedName || "").trim();
  const consent = Boolean(body?.consent);
  const signatureImageBase64: string | null = body?.signature_image_base64 ?? null;
  const geolocation = body?.geolocation ?? null;
  const witness1 = body?.witness_1 ?? null;
  const witness2 = body?.witness_2 ?? null;
  const termsHashAtSign: string | null = body?.terms_hash ?? null;

  if (!token || !signedName || !consent) return json({ error: "Missing required fields for signing" }, 400);
  if (!/^\d{6}$/.test(otp)) return json({ error: "Enter the 6-digit code sent to you" }, 400);

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, branch_id, status, expires_at, role")
    .eq("token_hash", tokenHash).is("revoked_at", null).single();
  if (requestError || !requestRow) return json({ error: "Invalid signing link" }, 404);
  if (requestRow.status === "signed") return json({ error: "This contract is already signed" }, 410);
  if (requestRow.expires_at < now) return json({ error: "This signing link has expired" }, 410);
  if (((requestRow as any).role || "employee") !== "employee") {
    return json({ error: "This link can only fill details, not sign. Ask HR for a signing link." }, 403);
  }

  // Gate signing on required fields being collected — but merge with prefill
  // sourced from employees/profiles so contracts whose details already live
  // on the staff record don't need a redundant /fill round-trip.
  const { data: cv } = await supabase.from("contracts").select(`
      contract_variables,
      employees(user_id), trainers(user_id)
    `)
    .eq("id", requestRow.contract_id).single();
  const prefill = await loadPrefillForContract(cv);
  const merged = mergeVarsWithPrefill((cv as any)?.contract_variables, prefill);
  const missing = missingRequired(merged);
  if (missing.length > 0) {
    return json({ error: "fields_incomplete", missing_required: missing }, 409);
  }


  // Verify OTP from shared table (purpose+context_id scope)
  const { data: otpRow } = await supabase
    .from("otp_verifications")
    .select("id, code_hash, expires_at, attempts, consumed_at")
    .eq("purpose", "contract_sign").eq("context_id", requestRow.id).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!otpRow) return json({ error: "Please request an OTP first" }, 400);
  if (otpRow.expires_at < now) return json({ error: "OTP expired. Please request a new code." }, 410);
  if ((otpRow.attempts ?? 0) >= 5) return json({ error: "Too many invalid attempts. Request a new OTP." }, 429);

  const submittedHash = await sha256(otp);
  if (submittedHash !== otpRow.code_hash) {
    await supabase.from("otp_verifications")
      .update({ attempts: (otpRow.attempts ?? 0) + 1 }).eq("id", otpRow.id);
    return json({ error: "Incorrect OTP. Please try again." }, 401);
  }
  await supabase.from("otp_verifications").update({ consumed_at: now }).eq("id", otpRow.id);

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // Tamper-evidence check
  if (termsHashAtSign) {
    const { data: c } = await supabase.from("contracts").select("terms_hash")
      .eq("id", requestRow.contract_id).single();
    if (c?.terms_hash && c.terms_hash !== termsHashAtSign) {
      return json({ error: "Terms have changed since this link was issued. Please request a new link." }, 409);
    }
  }

  // Upload drawn signature
  let signatureImagePath: string | null = null;
  if (signatureImageBase64 && signatureImageBase64.startsWith("data:image/")) {
    try {
      const base64Body = signatureImageBase64.split(",")[1];
      const bytes = Uint8Array.from(atob(base64Body), (c) => c.charCodeAt(0));
      const path = `${requestRow.contract_id}/${requestRow.id}.png`;
      const { error: upErr } = await supabase.storage
        .from("signature-assets").upload(path, bytes, { contentType: "image/png", upsert: true });
      if (!upErr) signatureImagePath = path;
    } catch (_) { /* best-effort */ }
  }

  const { error: insertSignatureError } = await supabase
    .from("contract_signatures")
    .insert({
      contract_id: requestRow.contract_id,
      request_id: requestRow.id,
      signed_name: signedName,
      signer_contact: signerContact || null,
      signature_text: signatureText,
      ip_address: ipAddress,
      user_agent: userAgent,
      signature_image_path: signatureImagePath,
      geolocation,
      terms_hash_at_sign: termsHashAtSign,
    });
  if (insertSignatureError) return json({ error: "Failed to store signature: " + insertSignatureError.message }, 500);

  await supabase.from("contract_signature_requests").update({
    status: "signed", used_at: now, signer_name: signedName, signer_contact: signerContact || null,
  }).eq("id", requestRow.id);

  await supabase.from("contracts").update({
    signature_status: "signed", signed_at: now, status: "active",
    witness_1: witness1, witness_2: witness2,
  }).eq("id", requestRow.contract_id);

  await supabase.from("audit_logs").insert({
    action: "CONTRACT_SIGNED",
    table_name: "contracts",
    record_id: requestRow.contract_id,
    branch_id: requestRow.branch_id,
    action_description: `Contract signed by ${signedName}`,
    new_data: {
      signer_name: signedName, signer_contact: signerContact || null,
      signed_at: now, signature_image_path: signatureImagePath,
      geolocation, witness_1: witness1, witness_2: witness2,
      otp_verified: true,
    },
  });

  return json({ success: true, signed_at: now });
}

// ── 5. Get/regenerate stamped PDF ─────────────────────────────────────────
async function getOrBuildPdf(req: Request, body: any, forceRebuild: boolean) {
  const auth = await assertStaff(req);
  if ("error" in auth) return auth.error;

  const contractId = body?.contract_id;
  const copy: CopyKind = (body?.copy as CopyKind) ?? "employee_copy";
  if (!contractId) return json({ error: "Missing contract_id" }, 400);

  // Draft previews are always built fresh (not cached) and skip the signature block.
  if (copy !== "draft" && !forceRebuild) {
    const { data: existing } = await supabase
      .from("contracts").select("stamped_pdf_path, signed_pdf_hash")
      .eq("id", contractId).maybeSingle();
    if (existing?.stamped_pdf_path) {
      const { data: signedUrl } = await supabase.storage
        .from("contract-pdfs").createSignedUrl(existing.stamped_pdf_path, 60);
      if (signedUrl?.signedUrl) {
        return json({ success: true, path: existing.stamped_pdf_path, signed_url: signedUrl.signedUrl, hash: existing.signed_pdf_hash, copy, cached: true });
      }
    }
  }

  return await buildStampedPdf(contractId, copy);
}

async function buildStampedPdf(contractId: string, copy: CopyKind) {
  const { data: contract, error: cErr } = await supabase
    .from("contracts")
    .select(`
      id, contract_type, start_date, end_date,
      salary, base_salary, commission_percentage, terms,
      signature_status, signed_at, witness_1, witness_2, contract_variables,
      governing_jurisdiction, arbitration_seat, notice_period_days,
      branch_id,
      employees(employee_code, profiles:employees_user_id_profiles_fkey(full_name, email, phone)),
      trainers(user_id)
    `)
    .eq("id", contractId).single();
  if (cErr || !contract) return json({ error: "Contract not found" }, 404);

  const { data: signature } = await supabase
    .from("contract_signatures").select("*")
    .eq("contract_id", contractId).order("signed_at", { ascending: false }).limit(1).maybeSingle();

  const { data: employerData } = await supabase.rpc("get_employer_profile", { _branch_id: contract.branch_id });
  const employer: any = employerData || {};

  const { name: employeeName, code: employeeCode } = await resolveRecipient(contract);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const copyLabel = copy === "original" ? "ORIGINAL" : copy === "employer_copy" ? "EMPLOYER COPY" : copy === "draft" ? "DRAFT — NOT YET SIGNED" : "EMPLOYEE COPY";
  const isDraft = copy === "draft";
  const pageWidth = PageSizes.A4[0];
  const pageHeight = PageSizes.A4[1];
  const marginX = 50;
  const marginY = 60;

  let page = pdfDoc.addPage(PageSizes.A4);
  let y = pageHeight - marginY;
  const lineHeight = 13;

  const headerLegal = `${employer.legal_name || "Incline"} — The Incline Life by Incline`;
  const headerAddr = employer.full_address || [employer.city, employer.state].filter(Boolean).join(", ");
  const headerContact = [employer.phone, employer.email].filter(Boolean).join("  ·  ");

  function drawHeader(p: any) {
    p.drawText(headerLegal, { x: marginX, y: pageHeight - 38, size: 11, font: fontBold, color: rgb(0.18, 0.16, 0.42) });
    if (headerAddr) p.drawText(headerAddr, { x: marginX, y: pageHeight - 52, size: 7.5, font, color: rgb(0.4, 0.4, 0.5) });
    if (headerContact) p.drawText(headerContact, { x: marginX, y: pageHeight - 63, size: 7.5, font, color: rgb(0.4, 0.4, 0.5) });
    const idRight: string[] = [];
    if (employer.gstin) idRight.push(`GSTIN: ${employer.gstin}`);
    if (employer.pan) idRight.push(`PAN: ${employer.pan}`);
    if (employer.firm_registration_no) idRight.push(`Reg: ${employer.firm_registration_no}`);
    idRight.forEach((t, i) => {
      const w = font.widthOfTextAtSize(t, 7.5);
      p.drawText(t, { x: pageWidth - marginX - w, y: pageHeight - 38 - i * 11, size: 7.5, font, color: rgb(0.4, 0.4, 0.5) });
    });
    p.drawText(copyLabel, {
      x: pageWidth / 2 - 100, y: pageHeight / 2,
      size: 60, font: fontBold, color: rgb(0.93, 0.93, 0.97),
      opacity: 0.6, rotate: { type: "degrees", angle: 35 } as any,
    });
  }

  function drawFooter(p: any, pageNum: number, totalPages: number) {
    const refLine = `Contract Ref: ${contractId.slice(0, 8).toUpperCase()}  ·  Page ${pageNum} of ${totalPages}`;
    p.drawText(refLine, { x: marginX, y: 30, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
    const verify = `Verify: /verify/contract/${contractId.slice(0, 8)}`;
    const vw = font.widthOfTextAtSize(verify, 7);
    p.drawText(verify, { x: pageWidth - marginX - vw, y: 30, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
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

  function spacer(n = 6) { y -= n; }

  y -= 20;
  writeLine("EMPLOYMENT AGREEMENT", { bold: true, size: 16, color: rgb(0.18, 0.16, 0.42) });
  spacer(8);

  const termsRaw = typeof contract.terms === "string"
    ? contract.terms
    : (contract.terms as any)?.conditions ?? JSON.stringify(contract.terms ?? {}, null, 2);

  for (const ln of termsRaw.split("\n")) {
    const trimmed = ln.replace(/^#+\s*/, "");
    const isHeading = /^#{1,3}\s/.test(ln);
    writeLine(trimmed || " ", { bold: isHeading });
    if (isHeading) spacer(2);
  }

  spacer(14);
  newPageIfNeeded(160);

  // ── Filled details (captured via /contract-fill) ──────────────────────
  const cvars = ((contract as any).contract_variables ?? {}) as Record<string, any>;
  const detailRows: [string, any][] = [
    ["S/o · D/o · W/o",        cvars.father_or_husband_name],
    ["Residential address",    cvars.residential_address],
    ["Emergency contact",      cvars.emergency_contact_name && cvars.emergency_contact_phone
                                  ? `${cvars.emergency_contact_name} — ${cvars.emergency_contact_phone}`
                                  : (cvars.emergency_contact_name || cvars.emergency_contact_phone)],
    ["PAN / Aadhaar (last 4)", cvars.pan_or_aadhaar_last4],
    ["Witness 1",              cvars.witness_1_name && cvars.witness_1_phone
                                  ? `${cvars.witness_1_name} — ${cvars.witness_1_phone}` : cvars.witness_1_name],
    ["Witness 2",              cvars.witness_2_name && cvars.witness_2_phone
                                  ? `${cvars.witness_2_name} — ${cvars.witness_2_phone}` : cvars.witness_2_name],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");

  if (detailRows.length > 0) {
    writeLine("Filled details", { bold: true, size: 12 });
    spacer(4);
    for (const [label, value] of detailRows) writeLine(`${label}: ${value}`);
    spacer(14);
    newPageIfNeeded(120);
  }

  writeLine(isDraft ? "Signatures (pending)" : "Signatures", { bold: true, size: 12 });
  spacer(4);

  if (!isDraft && signature?.signature_image_path) {
    const { data: imgBlob } = await supabase.storage
      .from("signature-assets").download(signature.signature_image_path);
    if (imgBlob) {
      try {
        const bytes = new Uint8Array(await imgBlob.arrayBuffer());
        const img = await pdfDoc.embedPng(bytes);
        const scale = Math.min(150 / img.width, 60 / img.height);
        page.drawImage(img, { x: marginX, y: y - 60, width: img.width * scale, height: img.height * scale });
        y -= 70;
      } catch (_) { /* fall back to typed text */ }
    }
  }
  if (isDraft) {
    writeLine(`Employee: ${employeeName} (${employeeCode})  —  signature pending`);
  } else {
    writeLine(`Employee: ${signature?.signed_name || employeeName} (${employeeCode})`);
    writeLine(`Signed at: ${signature?.signed_at || contract.signed_at || "—"}  ·  IP: ${signature?.ip_address || "—"}`);
    if (signature?.geolocation) writeLine(`Geo: ${JSON.stringify(signature.geolocation)}`);
  }

  spacer(10);
  writeLine(`For ${employer.legal_name || "Incline"}`);
  if (employer.proprietor_name) writeLine(`Proprietor: ${employer.proprietor_name}`);
  if (employer.governing_jurisdiction) writeLine(`Governing jurisdiction: ${employer.governing_jurisdiction}`);
  if (employer.arbitration_seat) writeLine(`Arbitration seat: ${employer.arbitration_seat}`);

  if (contract.witness_1 || contract.witness_2) {
    spacer(14);
    writeLine("Witnesses", { bold: true, size: 11 });
    if (contract.witness_1) writeLine(`1. ${(contract.witness_1 as any).name || "-"}  ·  ${(contract.witness_1 as any).phone || "-"}`);
    if (contract.witness_2) writeLine(`2. ${(contract.witness_2 as any).name || "-"}  ·  ${(contract.witness_2 as any).phone || "-"}`);
  }

  if (!isDraft) {
    spacer(14);
    writeLine("Audit trail", { bold: true, size: 11 });
    writeLine(`Electronic signature recorded under Section 10A of the Information Technology Act, 2000.`);
    writeLine(`Terms hash at sign: ${signature?.terms_hash_at_sign || "—"}`);
  }

  const pages = pdfDoc.getPages();
  pages.forEach((p, i) => drawFooter(p, i + 1, pages.length));

  const pdfBytes = await pdfDoc.save();
  const path = `${contractId}/${copy}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contract-pdfs").upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) return json({ error: "Failed to store PDF: " + upErr.message }, 500);

  const hashBuf = await crypto.subtle.digest("SHA-256", pdfBytes);
  const signedPdfHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Don't persist draft path as the canonical stamped PDF.
  if (!isDraft) {
    await supabase.from("contracts")
      .update({ stamped_pdf_path: path, signed_pdf_hash: signedPdfHash }).eq("id", contractId);
  }

  const { data: signedUrl, error: urlErr } = await supabase.storage
    .from("contract-pdfs").createSignedUrl(path, 60);
  if (urlErr) return json({ error: "Failed to create signed URL: " + urlErr.message }, 500);

  return json({ success: true, path, signed_url: signedUrl?.signedUrl, hash: signedPdfHash, copy, draft: isDraft });
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function resolveRecipient(contract: any): Promise<{ name: string | null; phone: string | null; email: string | null; code: string | null }> {
  const emp = Array.isArray(contract?.employees) ? contract.employees[0] : contract?.employees;
  const trn = Array.isArray(contract?.trainers) ? contract.trainers[0] : contract?.trainers;
  let profile: any = Array.isArray(emp?.profiles) ? emp?.profiles[0] : emp?.profiles;
  let code = emp?.employee_code ?? null;
  if (!profile?.phone && !profile?.email && trn?.user_id) {
    const { data: p } = await supabase
      .from("profiles").select("full_name, phone, email").eq("id", trn.user_id).maybeSingle();
    profile = p;
    if (!code) code = "Trainer";
  }
  return {
    name: profile?.full_name ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    code,
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function maskPhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 4) return p;
  return digits.slice(0, 2) + "****" + digits.slice(-2);
}
function maskEmail(e?: string | null): string | null {
  if (!e || !e.includes("@")) return e || null;
  const [u, d] = e.split("@");
  return (u.slice(0, 2) + "***@" + d);
}
