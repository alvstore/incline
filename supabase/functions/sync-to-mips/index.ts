import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PERMANENT_END = "2099-12-31 23:59:59";
const MAX_PHOTO_BYTES = 400 * 1024; // 400KB per MIPS manual

let cachedToken: string | null = null;
let tokenExpiry = 0;

function getBaseUrl(overrideUrl?: string): string {
  return (overrideUrl || Deno.env.get("MIPS_SERVER_URL")!).replace(/\/+$/, "");
}

function stripHyphens(code: string): string {
  return code.replace(/-/g, "");
}

function formatDate(dateStr: string | null, fallback: string): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return fallback;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function getRuoYiToken(baseUrl?: string, username?: string, password?: string): Promise<string> {
  const url = baseUrl || getBaseUrl();
  const user = username || Deno.env.get("MIPS_USERNAME")!;
  const pass = password || Deno.env.get("MIPS_PASSWORD")!;
  const cacheKey = `${url}:${user}`;
  
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`${url}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch {
    throw new Error(`RuoYi login non-JSON: ${text.substring(0, 300)}`);
  }
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(`RuoYi login failed: ${json.msg || JSON.stringify(json)}`);
  }
  cachedToken = json.token || json.data?.token;
  if (!cachedToken) throw new Error("No token in login response");
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken!;
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "TENANT-ID": "1",
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function lookupPerson(baseUrl: string, token: string, personSn: string): Promise<any | null> {
  const res = await fetch(
    `${baseUrl}/personInfo/person/list?personSn=${personSn}&pageNum=1&pageSize=5`,
    { method: "GET", headers: authHeaders(token) }
  );
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { return null; }
  const rows = json?.rows || json?.data;
  if (!Array.isArray(rows)) return null;
  return rows.find((r: any) => r.personSn === personSn) || null;
}

async function upsertPerson(
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>,
  existingPerson: any | null
): Promise<{ success: boolean; personId: number | null; response: any }> {
  const isUpdate = existingPerson !== null;
  const method = isUpdate ? "PUT" : "POST";

  let body: Record<string, unknown>;
  if (isUpdate) {
    body = { ...existingPerson, ...payload, personId: existingPerson.personId };
  } else {
    body = { ...payload };
  }

  delete body.personPhotoUrl;
  delete body.photoUrl;

  console.log(`${method} /personInfo/person — personSn=${body.personSn}, isUpdate=${isUpdate}`);

  const res = await fetch(`${baseUrl}/personInfo/person`, {
    method,
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`Person ${method} response: ${text.substring(0, 500)}`);

  let json: any;
  try { json = JSON.parse(text); } catch {
    return { success: false, personId: null, response: { raw: text } };
  }

  const success = json.code === 200 || json.code === 0;
  if (!success) {
    return { success: false, personId: isUpdate ? existingPerson.personId : null, response: json };
  }

  if (!isUpdate) {
    const found = await lookupPerson(baseUrl, token, String(body.personSn));
    return { success: true, personId: found?.personId || null, response: json };
  }

  return { success: true, personId: existingPerson.personId, response: json };
}

/**
 * Two-step photo upload:
 * 1. POST /common/uploadHeadPhoto (multipart) → get fileName
 * 2. PUT /personInfo/person with full person object + photoUri = fileName
 * 
 * MIPS rules: JPG only, max 400KB
 */
async function uploadPhoto(
  baseUrl: string,
  token: string,
  personSn: string,
  photoUrl: string
): Promise<{ success: boolean; message: string; fileName?: string }> {
  if (!photoUrl) return { success: false, message: "No photo URL" };

  try {
    let url = photoUrl;
    if (!url.startsWith("http")) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      url = `${supabaseUrl}/storage/v1/object/public/${url}`;
    }

    console.log(`Fetching photo from: ${url}`);
    const photoRes = await fetch(url);
    if (!photoRes.ok) {
      return { success: false, message: `Photo fetch failed: ${photoRes.status}` };
    }

    const photoBytes = new Uint8Array(await photoRes.arrayBuffer());
    const sizeKB = Math.round(photoBytes.length / 1024);

    if (photoBytes.length > MAX_PHOTO_BYTES) {
      return { success: false, message: `Photo too large: ${sizeKB}KB (max 400KB). Please compress before uploading.` };
    }

    console.log(`Photo fetched: ${sizeKB}KB`);

    // Step 1: Upload to /common/uploadHeadPhoto — always as JPG
    const boundary = `----FormBoundary${Date.now()}`;
    const fileName = `${personSn}.jpg`;

    const preamble = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
      `Content-Type: image/jpeg`,
      "",
      "",
    ].join("\r\n");

    const postamble = `\r\n--${boundary}--\r\n`;
    const preambleBytes = new TextEncoder().encode(preamble);
    const postambleBytes = new TextEncoder().encode(postamble);

    const body = new Uint8Array(preambleBytes.length + photoBytes.length + postambleBytes.length);
    body.set(preambleBytes, 0);
    body.set(photoBytes, preambleBytes.length);
    body.set(postambleBytes, preambleBytes.length + photoBytes.length);

    const uploadRes = await fetch(`${baseUrl}/common/uploadHeadPhoto`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "TENANT-ID": "1",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });

    const uploadText = await uploadRes.text();
    console.log(`Upload response: ${uploadText.substring(0, 300)}`);

    let uploadJson: any;
    try { uploadJson = JSON.parse(uploadText); } catch {
      return { success: false, message: `Upload non-JSON: ${uploadText.substring(0, 100)}` };
    }

    if (uploadJson.code !== 200 && uploadJson.code !== 0) {
      return { success: false, message: uploadJson.msg || "Upload failed" };
    }

    const filePath = uploadJson.fileName || uploadJson.url;
    if (!filePath) {
      return { success: false, message: "Upload succeeded but no fileName returned" };
    }

    console.log(`Photo uploaded: ${filePath}`);

    // Step 2: PUT the full person record with photoUri set
    const existing = await lookupPerson(baseUrl, token, personSn);
    if (existing) {
      existing.photoUri = filePath;
      const putRes = await fetch(`${baseUrl}/personInfo/person`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify(existing),
      });
      const putText = await putRes.text();
      console.log(`Photo PUT response: ${putText.substring(0, 200)}`);
    }

    return { success: true, message: "Photo uploaded and assigned", fileName: filePath };
  } catch (e) {
    console.warn("Photo upload error:", e);
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Multi-device dispatch: send personnel to ALL active devices for the branch
 * Falls back to MIPS device list if no access_devices configured
 */
async function dispatchToDevices(
  baseUrl: string,
  token: string,
  personId: number,
  supabase: any,
  branchId?: string
): Promise<{ results: any[]; deviceIds: number[] }> {
  // 1. Try to get device IDs from access_devices table
  let deviceIds: number[] = [];

  try {
    let query = supabase
      .from("access_devices")
      .select("mips_device_id, device_name, serial_number")
      .eq("is_online", true);
    if (branchId) query = query.eq("branch_id", branchId);
    const { data: devices } = await query;

    if (devices && devices.length > 0) {
      deviceIds = devices
        .map((d: any) => d.mips_device_id)
        .filter((id: any) => id && !isNaN(Number(id)));
    }
  } catch (e) {
    console.warn("Error fetching access_devices:", e);
  }

  // 2. Fallback: fetch from MIPS device list
  if (deviceIds.length === 0) {
    try {
      const res = await fetch(`${baseUrl}/through/device/list`, {
        method: "GET",
        headers: authHeaders(token),
      });
      const text = await res.text();
      const json = JSON.parse(text);
      const rows = json?.rows || json?.data;
      if (Array.isArray(rows)) {
        deviceIds = rows
          .filter((d: any) => d.onlineFlag === 1 || d.status === 1)
          .map((d: any) => d.id)
          .filter((id: any) => !isNaN(Number(id)));
      }
    } catch (e) {
      console.warn("Error fetching MIPS device list:", e);
    }
  }

  if (deviceIds.length === 0) {
    console.warn("No devices found for dispatch");
    return { results: [], deviceIds: [] };
  }

  // 3. Dispatch to all devices in a single call (API supports deviceIds array)
  console.log(`Dispatching personId=${personId} to devices: [${deviceIds.join(",")}]`);
  const res = await fetch(`${baseUrl}/through/device/syncPerson`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      personId: personId,
      deviceIds: deviceIds,
      deviceNumType: "4",
    }),
  });
  const text = await res.text();
  console.log(`Dispatch response: ${text.substring(0, 300)}`);
  let result: any;
  try { result = JSON.parse(text); } catch { result = { raw: text }; }

  return { results: [result], deviceIds };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  // ---- AUTH GATE (v1.1.0) ----
  // Allow internal service-role callers (payment-webhook, automation-brain) OR staff-role JWTs.
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  const isService = bearer && bearer === SERVICE_KEY;
  if (!isService) {
    if (!bearer) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userRes } = await supabase.auth.getUser(bearer);
    const uid = userRes?.user?.id;
    if (!uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", uid);
    const allowed = new Set(["owner", "admin", "manager", "staff"]);
    const hasRole = (roles || []).some((r: any) => allowed.has(r.role));
    if (!hasRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }



  try {
    const body = await req.json();
    const { person_type, person_id, branch_id, verify_only, person_no } = body as {
      person_type: "member" | "employee" | "trainer";
      person_id: string;
      branch_id?: string;
      verify_only?: boolean;
      person_no?: string;
    };

    // Look up per-branch MIPS connection (fall back to env vars)
    let mipsBaseUrl: string | undefined;
    let mipsUsername: string | undefined;
    let mipsPassword: string | undefined;
    if (branch_id) {
      const { data: conn } = await supabase
        .from("mips_connections")
        .select("server_url, username, password")
        .eq("branch_id", branch_id)
        .eq("is_active", true)
        .maybeSingle();
      if (conn) {
        mipsBaseUrl = conn.server_url;
        mipsUsername = conn.username;
        mipsPassword = conn.password;
      }
    }

    const baseUrl = getBaseUrl(mipsBaseUrl);
    const token = await getRuoYiToken(mipsBaseUrl, mipsUsername, mipsPassword);

    // ── Verify-only mode ──
    if (verify_only && person_no) {
      const stripped = stripHyphens(person_no);
      const found = await lookupPerson(baseUrl, token, stripped);
      return new Response(JSON.stringify({
        verified: !!found,
        mips_person: found || null,
        person_no_searched: stripped,
        has_photo: !!(found?.photoUri || found?.havePhoto),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Full sync mode ──
    if (!person_id || !person_type) {
      return new Response(JSON.stringify({ error: "Missing person_id or person_type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Fetch CRM data based on person type
    let name = "Unknown";
    let personNo = "";
    let phone = "";
    let email = "";
    let photoUrl = "";
    let validTimeBegin = formatDate(new Date().toISOString(), "2024-01-01 00:00:00");
    let validTimeEnd = PERMANENT_END;
    let tableName: string;
    let deptId = 100;
    let effectiveBranchId = branch_id;

    if (person_type === "member") {
      tableName = "members";
      deptId = 100;
      const { data: member, error } = await supabase
        .from("members")
        .select("*, profiles:user_id(full_name, phone, avatar_url, email)")
        .eq("id", person_id)
        .maybeSingle();
      if (error) throw new Error(`Member query error: ${error.message}`);
      if (!member) throw new Error(`Member not found with id: ${person_id}`);

      const profile = member.profiles as any;
      name = profile?.full_name || "Unknown";
      personNo = member.member_code || person_id.substring(0, 8);
      phone = profile?.phone || "";
      email = profile?.email || "";
      photoUrl = member.biometric_photo_url || profile?.avatar_url || "";
      effectiveBranchId = effectiveBranchId || member.branch_id;

      // Members get validity from membership dates
      const { data: membership } = await supabase
        .from("memberships")
        .select("start_date, end_date")
        .eq("member_id", person_id)
        .eq("status", "active")
        .order("end_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membership) {
        validTimeBegin = formatDate(membership.start_date + "T00:00:00", validTimeBegin);
        validTimeEnd = formatDate(membership.end_date + "T23:59:59", validTimeEnd);
      }
    } else if (person_type === "employee") {
      tableName = "employees";
      deptId = 101;
      const { data: emp, error } = await supabase
        .from("employees")
        .select("*, profiles:user_id(full_name, phone, avatar_url, email)")
        .eq("id", person_id)
        .maybeSingle();
      if (error) throw new Error(`Employee query error: ${error.message}`);
      if (!emp) throw new Error(`Employee not found with id: ${person_id}`);

      const profile = emp.profiles as any;
      name = profile?.full_name || "Unknown";
      personNo = emp.employee_code || person_id.substring(0, 8);
      phone = profile?.phone || "";
      email = profile?.email || "";
      photoUrl = emp.biometric_photo_url || profile?.avatar_url || "";
      effectiveBranchId = effectiveBranchId || emp.branch_id;
      validTimeEnd = PERMANENT_END;
    } else if (person_type === "trainer") {
      tableName = "trainers";
      deptId = 101;
      const { data: trainer, error } = await supabase
        .from("trainers")
        .select("id, branch_id, biometric_photo_url, is_active, user_id, mips_sync_status, mips_person_id")
        .eq("id", person_id)
        .maybeSingle();
      if (error) throw new Error(`Trainer query error: ${error.message}`);
      if (!trainer) throw new Error(`Trainer not found with id: ${person_id}`);

      // Fetch profile separately to avoid join coercion errors when user_id is null
      let profile: any = null;
      if (trainer.user_id) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("full_name, phone, avatar_url, email")
          .eq("id", trainer.user_id)
          .maybeSingle();
        profile = profileData;
      }

      name = profile?.full_name || "Unknown";
      phone = profile?.phone || "";
      email = profile?.email || "";
      photoUrl = (trainer as any).biometric_photo_url || profile?.avatar_url || "";
      effectiveBranchId = effectiveBranchId || trainer.branch_id;
      validTimeEnd = PERMANENT_END;

      // Generate trainer code: TRN-{first4chars} (consistent with UI)
      personNo = `TRN-${person_id.substring(0, 4).toUpperCase()}`;
    } else {
      return new Response(JSON.stringify({ error: `Unknown person_type: ${person_type}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mipsPersonSn = stripHyphens(personNo);
    console.log(`Syncing ${person_type}: ${name} (${personNo} → ${mipsPersonSn})`);

    // Step 2: Check if person already exists in MIPS
    const existing = await lookupPerson(baseUrl, token, mipsPersonSn);
    console.log(`MIPS lookup: ${existing ? `found personId=${existing.personId}` : "not found"}`);

    // Step 3: Create or update person
    const personPayload: Record<string, unknown> = {
      personSn: mipsPersonSn,
      personType: 1,
      deptId,
      name,
      mobile: phone,
      email: email || undefined,
      gender: "M",
      attendance: "1",
      holiday: "1",
      validTimeBegin,
      validTimeEnd,
      remark: person_type === "member" ? "Gym Member" : person_type === "trainer" ? "Trainer" : "Staff",
    };

    const { success, personId, response: mipsResponse } = await upsertPerson(
      baseUrl, token, personPayload, existing
    );

    if (!success) {
      console.error(`MIPS upsert FAILED: ${JSON.stringify(mipsResponse)}`);
      await supabase.from(tableName).update({
        mips_sync_status: "failed",
        mips_person_id: null,
      }).eq("id", person_id);

      return new Response(JSON.stringify({
        success: false,
        error: mipsResponse?.msg || "MIPS person create/update failed",
        mips_response: mipsResponse,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!personId) {
      console.error("Person created but personId not found in lookup");
      await supabase.from(tableName).update({
        mips_sync_status: "failed",
        mips_person_id: null,
      }).eq("id", person_id);

      return new Response(JSON.stringify({
        success: false,
        error: "Person created but personId not retrievable",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`MIPS person ${existing ? "updated" : "created"}: personId=${personId}`);

    // Step 4: Upload photo (two-step: upload file → PUT photoUri on person)
    // Photo upload is non-blocking — sync succeeds even if photo fails
    let photoResult = { success: false, message: "No photo available" } as any;
    if (photoUrl) {
      try {
        photoResult = await uploadPhoto(baseUrl, token, mipsPersonSn, photoUrl);
        console.log(`Photo upload: ${photoResult.success ? "✓" : "✗"} ${photoResult.message}`);
      } catch (photoErr) {
        console.warn("Photo upload failed (non-fatal):", photoErr);
        photoResult = { success: false, message: `Photo upload error: ${photoErr instanceof Error ? photoErr.message : String(photoErr)}` };
      }
    } else {
      console.log("No photo URL provided, skipping photo upload");
    }

    // Step 5: Dispatch to ALL active devices (multi-device)
    let dispatchResult: any = null;
    try {
      dispatchResult = await dispatchToDevices(baseUrl, token, personId, supabase, effectiveBranchId);
    } catch (e) {
      console.error("Dispatch error:", e);
      dispatchResult = { error: String(e) };
    }

    // Step 6: Update CRM database with real personId AND mips_person_sn
    await supabase.from(tableName).update({
      mips_sync_status: "synced",
      mips_person_id: String(personId),
      mips_person_sn: mipsPersonSn,
    }).eq("id", person_id);
    console.log(`CRM updated: mips_person_id=${personId}, mips_person_sn=${mipsPersonSn}`);

    return new Response(JSON.stringify({
      success: true,
      mips_person_id: personId,
      action: existing ? "updated" : "created",
      photo_result: photoResult,
      dispatch_result: dispatchResult,
      validity: { validTimeBegin, validTimeEnd },
      person: { name, personSn: mipsPersonSn, originalCode: personNo },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("sync-to-mips error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
