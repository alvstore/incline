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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body?.action;

    if (!action) {
      return json({ error: "Missing action" }, 400);
    }

    if (action === "create_link") {
      return await createSignLink(req, body);
    }

    if (action === "get_contract") {
      return await getContractByToken(body);
    }

    if (action === "sign_contract") {
      return await signContract(req, body);
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

async function createSignLink(req: Request, body: any) {
  const contractId = body?.contract_id;
  if (!contractId) {
    return json({ error: "Missing contract_id" }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const userId = authData.user.id;

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["owner", "admin", "manager"])
    .limit(1);

  if (roleError || !roleRows || roleRows.length === 0) {
    return json({ error: "Forbidden" }, 403);
  }

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, branch_id")
    .eq("id", contractId)
    .single();

  if (contractError || !contract) {
    return json({ error: "Contract not found" }, 404);
  }

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
    .select("id")
    .single();

  if (requestError || !requestRow) {
    return json({ error: "Failed to create signature request" }, 500);
  }

  await supabase
    .from("contracts")
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
  if (!token) {
    return json({ error: "Missing token" }, 400);
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, status, expires_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .single();

  if (requestError || !requestRow) {
    return json({ error: "Invalid signing link" }, 404);
  }

  if (requestRow.status === "signed") {
    return json({ error: "This contract is already signed" }, 410);
  }

  if (requestRow.expires_at < now) {
    await supabase
      .from("contract_signature_requests")
      .update({ status: "expired" })
      .eq("id", requestRow.id)
      .in("status", ["pending", "viewed"]);

    await supabase
      .from("contracts")
      .update({ signature_status: "expired" })
      .eq("id", requestRow.contract_id)
      .in("signature_status", ["sent", "viewed"]);

    return json({ error: "This signing link has expired" }, 410);
  }

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select(`
      id,
      contract_type,
      start_date,
      end_date,
      salary,
      base_salary,
      commission_percentage,
      terms,
      status,
      signature_status,
      employees(employee_code, profiles:employees_user_id_profiles_fkey(full_name)),
      trainers(user_id)
    `)
    .eq("id", requestRow.contract_id)
    .single();

  if (contractError || !contract) {
    return json({ error: "Contract not found" }, 404);
  }

  if (requestRow.status === "pending") {
    await supabase
      .from("contract_signature_requests")
      .update({ status: "viewed" })
      .eq("id", requestRow.id)
      .eq("status", "pending");

    await supabase
      .from("contracts")
      .update({ signature_status: "viewed" })
      .eq("id", contract.id)
      .in("signature_status", ["sent", "not_sent"]);
  }

  const emp = Array.isArray(contract.employees) ? contract.employees[0] : contract.employees;
  const trn = Array.isArray(contract.trainers) ? contract.trainers[0] : contract.trainers;

  const empProfile = Array.isArray(emp?.profiles) ? emp?.profiles[0] : emp?.profiles;
  let resolvedName = empProfile?.full_name ?? null;
  let resolvedCode = emp?.employee_code ?? null;

  if (!resolvedName && trn?.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", trn.user_id)
      .maybeSingle();

    resolvedName = profile?.full_name ?? "Trainer";
    resolvedCode = "Trainer";
  }

  return json({
    contract: {
      id: contract.id,
      employee_name: resolvedName || "Employee",
      employee_code: resolvedCode || "-",
      contract_type: contract.contract_type,
      start_date: contract.start_date,
      end_date: contract.end_date,
      salary: contract.base_salary ?? contract.salary,
      commission_percentage: contract.commission_percentage,
      terms: contract.terms,
      signature_status: contract.signature_status,
    },
  });
}

// v2.0.0 — adds drawn signature image, geo-location, witness blocks and
// terms-hash verification for evidentiary-grade signing under IT Act 2000.
async function signContract(req: Request, body: any) {
  const token = body?.token;
  const signedName = String(body?.signed_name || "").trim();
  const signerContact = String(body?.signer_contact || "").trim();
  const signatureText = String(body?.signature_text || signedName || "").trim();
  const consent = Boolean(body?.consent);
  const signatureImageBase64: string | null = body?.signature_image_base64 ?? null;
  const geolocation = body?.geolocation ?? null;
  const witness1 = body?.witness_1 ?? null;
  const witness2 = body?.witness_2 ?? null;
  const termsHashAtSign: string | null = body?.terms_hash ?? null;

  if (!token || !signedName || !consent) {
    return json({ error: "Missing required fields for signing" }, 400);
  }

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: requestRow, error: requestError } = await supabase
    .from("contract_signature_requests")
    .select("id, contract_id, branch_id, status, expires_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .single();

  if (requestError || !requestRow) {
    return json({ error: "Invalid signing link" }, 404);
  }

  if (requestRow.status === "signed") {
    return json({ error: "This contract is already signed" }, 410);
  }

  if (requestRow.expires_at < now) {
    return json({ error: "This signing link has expired" }, 410);
  }

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // Optional: verify terms-hash tamper-evidence (only if both sides have it)
  if (termsHashAtSign) {
    const { data: c } = await supabase
      .from("contracts")
      .select("terms_hash")
      .eq("id", requestRow.contract_id)
      .single();
    if (c?.terms_hash && c.terms_hash !== termsHashAtSign) {
      return json({ error: "Terms have changed since this link was issued. Please request a new link." }, 409);
    }
  }

  // Upload drawn signature image to private storage (if provided)
  let signatureImagePath: string | null = null;
  if (signatureImageBase64 && signatureImageBase64.startsWith("data:image/")) {
    try {
      const base64Body = signatureImageBase64.split(",")[1];
      const bytes = Uint8Array.from(atob(base64Body), (c) => c.charCodeAt(0));
      const path = `${requestRow.contract_id}/${requestRow.id}.png`;
      const { error: upErr } = await supabase.storage
        .from("signature-assets")
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (!upErr) signatureImagePath = path;
    } catch (_) {
      // Best-effort; don't fail signing because storage rejected the image
    }
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

  if (insertSignatureError) {
    return json({ error: "Failed to store signature: " + insertSignatureError.message }, 500);
  }

  await supabase
    .from("contract_signature_requests")
    .update({
      status: "signed",
      used_at: now,
      signer_name: signedName,
      signer_contact: signerContact || null,
    })
    .eq("id", requestRow.id);

  await supabase
    .from("contracts")
    .update({
      signature_status: "signed",
      signed_at: now,
      status: "active",
      witness_1: witness1,
      witness_2: witness2,
    })
    .eq("id", requestRow.contract_id);

  await supabase.from("audit_logs").insert({
    action: "CONTRACT_SIGNED",
    table_name: "contracts",
    record_id: requestRow.contract_id,
    branch_id: requestRow.branch_id,
    action_description: `Contract signed by ${signedName}`,
    new_data: {
      signer_name: signedName,
      signer_contact: signerContact || null,
      signed_at: now,
      signature_image_path: signatureImagePath,
      geolocation,
      witness_1: witness1,
      witness_2: witness2,
    },
  });

  return json({ success: true, signed_at: now });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
