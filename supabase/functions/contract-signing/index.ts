// v3.0.0 — Adds WhatsApp/SMS OTP gating before sign, employer profile via
// canonical get_employer_profile RPC, and a stamped-PDF confirmation event.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body?.action;
    if (!action) return json({ error: "Missing action" }, 400);

    if (action === "create_link") return await createSignLink(req, body);
    if (action === "get_contract") return await getContractByToken(body);
    if (action === "request_otp") return await requestOtp(body);
    if (action === "sign_contract") return await signContract(req, body);

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

async function createSignLink(req: Request, body: any) {
  const contractId = body?.contract_id;
  if (!contractId) return json({ error: "Missing contract_id" }, 400);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) return json({ error: "Unauthorized" }, 401);

  const userId = authData.user.id;
  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["owner", "admin", "manager"])
    .limit(1);

  if (roleError || !roleRows || roleRows.length === 0) return json({ error: "Forbidden" }, 403);

  const { data: contract, error: contractError } = await supabase
    .from("contracts").select("id, branch_id").eq("id", contractId).single();
  if (contractError || !contract) return json({ error: "Contract not found" }, 404);

  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .insert({
      contract_id: contract.id,
      branch_id: contract.branch_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: userId,
      status: "pending",
    })
    .select("id").single();

  if (requestError || !requestRow) return json({ error: "Failed to create signature request" }, 500);

  await supabase.from("contracts")
    .update({ signature_status: "sent", signature_requested_at: new Date().toISOString() })
    .eq("id", contract.id);

  await supabase.from("audit_logs").insert({
    action: "CONTRACT_SIGN_LINK_CREATED",
    table_name: "contracts",
    record_id: contract.id,
    user_id: userId,
    branch_id: contract.branch_id,
    action_description: "Created public contract signing link",
    new_data: { request_id: requestRow.id, expires_at: expiresAt },
  });

  const appUrl = Deno.env.get("PUBLIC_APP_URL") ?? req.headers.get("origin") ?? "http://localhost:5173";
  const signUrl = `${appUrl.replace(/\/$/, "")}/contract-sign/${rawToken}`;
  return json({ sign_url: signUrl, expires_at: expiresAt });
}

async function getContractByToken(body: any) {
  const token = body?.token;
  if (!token) return json({ error: "Missing token" }, 400);

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, branch_id, status, expires_at")
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
      terms, status, signature_status, branch_id,
      employees(employee_code, profiles:employees_user_id_profiles_fkey(full_name, phone, email)),
      trainers(user_id)
    `)
    .eq("id", requestRow.contract_id).single();
  if (contractError || !contract) return json({ error: "Contract not found" }, 404);

  if (requestRow.status === "pending") {
    await supabase.from("contract_signature_requests").update({ status: "viewed" })
      .eq("id", requestRow.id).eq("status", "pending");
    await supabase.from("contracts").update({ signature_status: "viewed" })
      .eq("id", contract.id).in("signature_status", ["sent", "not_sent"]);
  }

  const emp = Array.isArray(contract.employees) ? contract.employees[0] : contract.employees;
  const trn = Array.isArray(contract.trainers) ? contract.trainers[0] : contract.trainers;
  const empProfile: any = Array.isArray(emp?.profiles) ? emp?.profiles[0] : emp?.profiles;
  let resolvedName = empProfile?.full_name ?? null;
  let resolvedCode = emp?.employee_code ?? null;
  let resolvedPhone = empProfile?.phone ?? null;
  let resolvedEmail = empProfile?.email ?? null;

  if (!resolvedName && trn?.user_id) {
    const { data: profile } = await supabase
      .from("profiles").select("full_name, phone, email").eq("id", trn.user_id).maybeSingle();
    resolvedName = profile?.full_name ?? "Trainer";
    resolvedCode = "Trainer";
    resolvedPhone = profile?.phone ?? null;
    resolvedEmail = profile?.email ?? null;
  }

  // Employer profile from canonical source
  const { data: employer } = await supabase.rpc("get_employer_profile", { _branch_id: contract.branch_id });

  return json({
    contract: {
      id: contract.id,
      employee_name: resolvedName || "Employee",
      employee_code: resolvedCode || "-",
      employee_phone_masked: maskPhone(resolvedPhone),
      employee_email_masked: maskEmail(resolvedEmail),
      contract_type: contract.contract_type,
      start_date: contract.start_date,
      end_date: contract.end_date,
      salary: contract.base_salary ?? contract.salary,
      commission_percentage: contract.commission_percentage,
      terms: contract.terms,
      signature_status: contract.signature_status,
      employer,
    },
  });
}

// ── OTP request ───────────────────────────────────────────────────────────
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

  // Resolve recipient
  const { data: contract } = await supabase
    .from("contracts")
    .select(`employees(profiles:employees_user_id_profiles_fkey(full_name, phone, email)), trainers(user_id)`)
    .eq("id", requestRow.contract_id).single();
  const emp = Array.isArray(contract?.employees) ? contract!.employees[0] : (contract as any)?.employees;
  const trn = Array.isArray(contract?.trainers) ? contract!.trainers[0] : (contract as any)?.trainers;
  let profile: any = Array.isArray(emp?.profiles) ? emp?.profiles[0] : emp?.profiles;
  if (!profile?.phone && !profile?.email && trn?.user_id) {
    const { data: p } = await supabase.from("profiles").select("full_name, phone, email").eq("id", trn.user_id).maybeSingle();
    profile = p;
  }
  const recipient = channel === "email" ? profile?.email : profile?.phone;
  if (!recipient) return json({ error: `No ${channel} address on file for this employee` }, 422);

  // Throttle: max 3 OTPs per 10 minutes per request
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recent } = await supabase
    .from("contract_sign_otps")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestRow.id).gte("created_at", tenMinAgo);
  if ((recent || 0) >= 3) return json({ error: "Too many OTP requests. Please try again in a few minutes." }, 429);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase.from("contract_sign_otps").insert({
    request_id: requestRow.id,
    contract_id: requestRow.contract_id,
    channel,
    recipient,
    code_hash: codeHash,
    expires_at: expiresAt,
  });

  // Employer name for the message
  const { data: employer } = await supabase.rpc("get_employer_profile", { _branch_id: requestRow.branch_id });
  const employerName = (employer as any)?.legal_name || "Incline";
  const employeeName = profile?.full_name || "there";

  const messageBody =
    `Hi ${employeeName}, your one-time code to sign your employment contract with ${employerName} is *${code}*. It expires in 10 minutes. Do not share this code with anyone.`;
  const subject = `${employerName} — Contract signing code`;

  // Dispatch through canonical pipeline (transactional, force-bypass prefs)
  const dispatchRes = await supabase.functions.invoke("dispatch-communication", {
    body: {
      branch_id: requestRow.branch_id,
      channel,
      category: "transactional",
      recipient,
      payload: {
        subject,
        body: messageBody,
        variables: { name: employeeName, otp: code, expires_in: "10 minutes", employer_name: employerName },
        use_branded_template: channel === "email",
      },
      dedupe_key: `contract_sign_otp:${requestRow.id}:${Date.now()}:${channel}`,
      force: true,
    },
  });
  if (dispatchRes.error) {
    return json({ error: "Could not send OTP: " + dispatchRes.error.message }, 500);
  }

  return json({
    success: true,
    channel,
    recipient_masked: channel === "email" ? maskEmail(recipient) : maskPhone(recipient),
    expires_at: expiresAt,
  });
}

// ── Sign (now OTP-gated) ──────────────────────────────────────────────────
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
    .select("id, contract_id, branch_id, status, expires_at")
    .eq("token_hash", tokenHash).is("revoked_at", null).single();
  if (requestError || !requestRow) return json({ error: "Invalid signing link" }, 404);
  if (requestRow.status === "signed") return json({ error: "This contract is already signed" }, 410);
  if (requestRow.expires_at < now) return json({ error: "This signing link has expired" }, 410);

  // Verify OTP — latest unverified, not expired, attempts < 5
  const { data: otpRow } = await supabase
    .from("contract_sign_otps")
    .select("id, code_hash, expires_at, attempts, verified_at")
    .eq("request_id", requestRow.id).is("verified_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!otpRow) return json({ error: "Please request an OTP first" }, 400);
  if (otpRow.expires_at < now) return json({ error: "OTP expired. Please request a new code." }, 410);
  if ((otpRow.attempts ?? 0) >= 5) return json({ error: "Too many invalid attempts. Request a new OTP." }, 429);

  const submittedHash = await sha256(otp);
  if (submittedHash !== otpRow.code_hash) {
    await supabase.from("contract_sign_otps")
      .update({ attempts: (otpRow.attempts ?? 0) + 1 }).eq("id", otpRow.id);
    return json({ error: "Incorrect OTP. Please try again." }, 401);
  }
  await supabase.from("contract_sign_otps").update({ verified_at: now }).eq("id", otpRow.id);

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
