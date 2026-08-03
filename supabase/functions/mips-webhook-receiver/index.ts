// v2.1.0 - Roster-aware staff attendance: repeat-scan guard, server-stamped shift + lateness
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mips-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Allowlist hostnames for imgUri values written to biometric_photo_url.
// Includes Supabase Storage, our own custom domains, and configured MIPS server hosts.
const STATIC_IMG_HOST_ALLOWLIST = [
  ".supabase.co",
  ".supabase.in",
  "theincline.in",
];

async function isImgUriAllowed(supabase: any, imgUri: string): Promise<boolean> {
  if (!imgUri) return false;
  let host: string;
  try {
    host = new URL(imgUri).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (STATIC_IMG_HOST_ALLOWLIST.some((h) => host === h.replace(/^\./, "") || host.endsWith(h))) {
    return true;
  }
  // Also allow hostnames of configured MIPS server URLs.
  try {
    const { data } = await supabase.from("mips_connections").select("server_url").eq("is_active", true);
    for (const row of data ?? []) {
      try {
        const allowed = new URL(row.server_url).hostname.toLowerCase();
        if (host === allowed) return true;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return false;
}


const DEVICE_ACK = JSON.stringify({ result: 1, code: "000" });

function reinsertHyphen(stripped: string): string | null {
  const match = stripped.match(/^([A-Za-z]{3,4})([A-Za-z0-9]+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  return null;
}

function normalizePersonCodeCandidates(rawCode: string): string[] {
  const trimmed = rawCode.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  candidates.add(trimmed);

  const legacyHyphen = reinsertHyphen(trimmed);
  if (legacyHyphen) candidates.add(legacyHyphen);

  const upper = trimmed.toUpperCase();

  // EMP codes: EMPMM3FYN8U → EMP-MM3FYN8U
  if (!trimmed.includes("-") && upper.startsWith("EMP") && trimmed.length > 3) {
    candidates.add(`EMP-${trimmed.slice(3)}`);
  }

  // TRN codes: TRN5096 → TRN-5096
  if (!trimmed.includes("-") && upper.startsWith("TRN") && trimmed.length > 3) {
    candidates.add(`TRN-${trimmed.slice(3)}`);
  }

  return Array.from(candidates);
}

function mapFaceType(type: string): { result: string; description: string } {
  switch (type) {
    case "face_0":
      return { result: "authorized", description: "Authorized face scan" };
    case "face_1":
      return { result: "denied", description: "Outside allowed passtime" };
    case "face_2":
      return { result: "stranger", description: "Stranger / unrecognized" };
    default:
      return { result: "unknown", description: `Unknown type: ${type}` };
  }
}

function normalizeScanTime(rawTime: unknown): string {
  if (rawTime === null || rawTime === undefined || rawTime === "") {
    return new Date().toISOString();
  }

  const asNumber = Number(rawTime);
  if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
    const abs = Math.abs(asNumber);
    let ms = asNumber;
    if (abs >= 1e18) {
      ms = asNumber / 1e6;
    } else if (abs >= 1e15) {
      ms = asNumber / 1e3;
    } else if (abs >= 1e12) {
      ms = asNumber; // already milliseconds
    } else {
      ms = asNumber * 1e3; // seconds → ms
    }

    const dateObj = new Date(ms);
    if (!Number.isNaN(dateObj.getTime())) {
      return dateObj.toISOString();
    }
  }

  if (typeof rawTime === "string") {
    const parsed = new Date(rawTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Lookup person by mips_person_sn first (exact match from sync), 
 * then by mips_person_id (numeric MIPS ID).
 */
async function findPersonByMipsSn(supabase: any, personSn: string) {
  // Check mips_person_sn (the personSn sent during sync, e.g. EMPMM3FYN8U)
  const { data: member } = await supabase
    .from("members")
    .select("id, branch_id, user_id")
    .eq("mips_person_sn", personSn)
    .maybeSingle();
  if (member) return { ...member, type: "member" };

  const { data: emp } = await supabase
    .from("employees")
    .select("id, branch_id, user_id")
    .eq("mips_person_sn", personSn)
    .maybeSingle();
  if (emp) return { ...emp, type: "employee" };

  const { data: trainer } = await supabase
    .from("trainers")
    .select("id, branch_id, user_id")
    .eq("mips_person_sn", personSn)
    .maybeSingle();
  if (trainer) return { ...trainer, type: "trainer" };

  return null;
}

async function findPersonByMipsId(supabase: any, mipsPersonId: string) {
  const { data: member } = await supabase
    .from("members")
    .select("id, branch_id, user_id")
    .eq("mips_person_id", mipsPersonId)
    .maybeSingle();
  if (member) return { ...member, type: "member" };

  const { data: emp } = await supabase
    .from("employees")
    .select("id, branch_id, user_id")
    .eq("mips_person_id", mipsPersonId)
    .maybeSingle();
  if (emp) return { ...emp, type: "employee" };

  const { data: trainer } = await supabase
    .from("trainers")
    .select("id, branch_id, user_id")
    .eq("mips_person_id", mipsPersonId)
    .maybeSingle();
  if (trainer) return { ...trainer, type: "trainer" };

  return null;
}

async function findPersonByCode(supabase: any, personCode: string) {
  const candidates = normalizePersonCodeCandidates(personCode);

  // Check members by member_code
  for (const candidate of candidates) {
    const { data: member } = await supabase
      .from("members")
      .select("id, branch_id, user_id")
      .eq("member_code", candidate)
      .maybeSingle();
    if (member) return { ...member, type: "member" };
  }

  // Check employees by employee_code
  for (const candidate of candidates) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, branch_id, user_id")
      .eq("employee_code", candidate)
      .maybeSingle();
    if (emp) return { ...emp, type: "employee" };
  }

  // Check trainers by mips_person_id (trainers don't have trainer_code column)
  for (const candidate of candidates) {
    const { data: trainer } = await supabase
      .from("trainers")
      .select("id, branch_id, user_id")
      .eq("mips_person_id", candidate)
      .maybeSingle();
    if (trainer) return { ...trainer, type: "trainer" };
  }

  // Fallback: check mips_person_id on members/employees too
  for (const candidate of candidates) {
    const { data: memberByMips } = await supabase
      .from("members")
      .select("id, branch_id, user_id")
      .eq("mips_person_id", candidate)
      .maybeSingle();
    if (memberByMips) return { ...memberByMips, type: "member" };
  }

  for (const candidate of candidates) {
    const { data: empByMips } = await supabase
      .from("employees")
      .select("id, branch_id, user_id")
      .eq("mips_person_id", candidate)
      .maybeSingle();
    if (empByMips) return { ...empByMips, type: "employee" };
  }

  // Last resort: manual alias mapping (legacy / device-created person codes)
  for (const candidate of [personCode, ...candidates]) {
    const aliased = await findPersonByAlias(supabase, candidate);
    if (aliased) return aliased;
  }

  console.warn(`findPersonByCode: no match for ${personCode}; tried ${candidates.join(", ")}`);
  return null;
}

/**
 * Resolve a device person code through the manual alias table.
 * Covers faces enrolled under an old employee code or created directly on MIPS.
 */
async function findPersonByAlias(supabase: any, personCode: string, personName?: string) {
  if (!personCode && !personName) return null;
  const { data, error } = await supabase.rpc("resolve_mips_person_alias", {
    _person_code: personCode || null,
    _person_name: personName || null,
  });
  if (error) {
    console.warn(`findPersonByAlias error for ${personCode}: ${error.message}`);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  console.log(`findPersonByAlias: ${personCode} -> ${row.target_type} ${row.target_id}`);
  return {
    id: row.target_id,
    branch_id: row.branch_id,
    user_id: row.user_id,
    type: row.target_type,
  };
}


async function handleMemberCheckin(
  supabase: any,
  memberId: string,
  branchId: string,
  personName: string,
  passType: string,
) {
  let result = "member";
  let message = `Member ${personName} checked in via ${passType}`;

  try {
    const { data: checkinResult } = await supabase.rpc("member_check_in", {
      _member_id: memberId,
      _branch_id: branchId,
      _method: "biometric",
    });
    if (checkinResult && !(checkinResult as any).valid) {
      result = "member_denied";
      message = `${personName}: ${(checkinResult as any).message || "Check-in denied"}`;
    }
  } catch (e) {
    console.warn("Check-in RPC failed:", e);
    message = `Member ${personName} check-in RPC error: ${e}`;
  }

  return { result, message };
}

async function handleStaffCheckin(supabase: any, userId: string, branchId: string, personName: string, personType: string) {
  const label = personType === "trainer" ? "Trainer" : "Staff";
  let message = `${label} ${personName} checked in`;

  try {
    const now = new Date();
    // Overnight shifts (e.g. 21:00 -> 10:00 next day) mean the matching open row
    // can be on the previous calendar day. Look back 18h instead of midnight.
    const lookbackStart = new Date(now.getTime() - 18 * 60 * 60_000);

    // Branch late/punch policy (min gap between gate scans)
    let minGapMin = 60;
    try {
      const { data: hr } = await supabase
        .from("hr_settings")
        .select("min_punch_gap_min")
        .eq("branch_id", branchId)
        .maybeSingle();
      if (hr?.min_punch_gap_min != null) minGapMin = Number(hr.min_punch_gap_min);
    } catch (_) { /* defaults */ }

    const { data: openRows } = await supabase
      .from("staff_attendance")
      .select("id, check_in")
      .eq("user_id", userId)
      .gte("check_in", lookbackStart.toISOString())
      .is("check_out", null)
      .order("check_in", { ascending: false })
      .limit(1);

    const openRow = openRows?.[0];
    if (openRow) {
      await supabase.from("staff_attendance").update({ check_out: now.toISOString() }).eq("id", openRow.id);
      message = `${label} ${personName} checked out`;
      return message;
    }

    // Repeat scan guard: don't open a new attendance row (and don't raise a new
    // late alert) when the person already punched within the policy window.
    const { data: recent } = await supabase
      .from("staff_attendance")
      .select("id, check_in")
      .eq("user_id", userId)
      .gte("check_in", new Date(now.getTime() - minGapMin * 60_000).toISOString())
      .order("check_in", { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      message = `${label} ${personName} scan recorded (duplicate within ${minGapMin} min)`;
      return message;
    }

    // shift_type / scheduled_start / late_minutes are stamped server-side by
    // tg_stamp_staff_attendance_shift using the staff roster.
    await supabase.from("staff_attendance").insert({
      user_id: userId,
      branch_id: branchId,
      check_in: now.toISOString(),
    });
  } catch (e) {
    console.warn("Staff attendance failed:", e);
    message = `${label} ${personName} attendance error: ${e}`;
  }

  return message;
}


async function handleImgRegCallback(supabase: any, payload: Record<string, unknown>) {
  const personNo = String(payload.personNo || payload.personSn || "");
  const imgUri = String(payload.imgUri || payload.photoUri || "");
  const imgBase64 = String(payload.imgBase64 || payload.base64 || "");

  if (!personNo) {
    console.warn("ImgReg callback missing personNo");
    return;
  }

  console.log(`ImgReg callback for ${personNo}, imgUri=${imgUri ? "yes" : "no"}, base64=${imgBase64 ? "yes" : "no"}`);

  let person = await findPersonByMipsSn(supabase, personNo);
  if (!person) person = await findPersonByMipsId(supabase, personNo);
  if (!person) person = await findPersonByCode(supabase, personNo);
  if (!person) {
    console.warn(`ImgReg: person ${personNo} not found in CRM`);
    return;
  }

  if (imgBase64 && imgBase64.length > 100) {
    try {
      const binaryStr = atob(imgBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const filePath = `${person.id}_capture.jpg`;
      await supabase.storage.from("member-photos").upload(filePath, bytes, { upsert: true, contentType: "image/jpeg" });

      const { data: urlData } = supabase.storage.from("member-photos").getPublicUrl(filePath);

      const table = person.type === "member" ? "members" : person.type === "trainer" ? "trainers" : "employees";
      await supabase.from(table).update({ biometric_photo_url: urlData.publicUrl }).eq("id", person.id);
      console.log(`ImgReg: saved captured photo for ${personNo} → ${urlData.publicUrl}`);
    } catch (e) {
      console.warn("ImgReg photo save failed:", e);
    }
  } else if (imgUri) {
    if (!(await isImgUriAllowed(supabase, imgUri))) {
      console.warn(`ImgReg: rejected imgUri (host not allowlisted) for ${personNo} → ${imgUri}`);
      return;
    }
    const table = person.type === "member" ? "members" : person.type === "trainer" ? "trainers" : "employees";
    await supabase.from(table).update({ biometric_photo_url: imgUri }).eq("id", person.id);
    console.log(`ImgReg: stored imgUri for ${personNo} → ${imgUri}`);
  }
}

async function getRelayUrl(supabase: any, branchId: string | null): Promise<string | null> {
  if (branchId) {
    const { data: conn } = await supabase
      .from("mips_connections")
      .select("server_url")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .maybeSingle();
    if (conn?.server_url) return conn.server_url.replace(/\/+$/, "");
  }
  const envUrl = Deno.env.get("MIPS_SERVER_URL");
  return envUrl ? envUrl.replace(/\/+$/, "") : null;
}

function relayToMips(mipsServerUrl: string, payload: Record<string, unknown>, eventType: string) {
  const callbackPaths: string[] = [];
  if (eventType === "ImgReg" || eventType === "img_reg" || eventType === "register") {
    callbackPaths.push("/api/callback/imgReg", "/tdx-admin/api/callback/imgReg");
  } else {
    callbackPaths.push("/api/callback/identify", "/tdx-admin/api/callback/identity");
  }

  const primaryUrl = `${mipsServerUrl}${callbackPaths[0]}`;
  console.log(`Relay forwarding to: ${primaryUrl}`);
  fetch(primaryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((e) => console.warn("Relay forward failed:", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // REQUIRED shared-secret gate. MIPS_WEBHOOK_SECRET must be configured.
  // Hardware devices must send `x-mips-token` or `Authorization: Bearer <token>`.
  // If the secret is not configured, refuse ALL requests (fail closed) to prevent
  // forged biometric/attendance events.
  const webhookSecret = Deno.env.get("MIPS_WEBHOOK_SECRET") || "";
  if (!webhookSecret) {
    console.error("mips-webhook-receiver: MIPS_WEBHOOK_SECRET is not configured — refusing all requests");
    return new Response(JSON.stringify({ result: 0, code: "503", message: "Webhook secret not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // v2.1.0 — Also accept `?token=<secret>` query param so the MIPS device UI
  // (which typically only lets you paste a URL, no custom headers) can pass
  // the shared secret via the URL. Header/Bearer still supported.
  const headerToken = req.headers.get("x-mips-token") || "";
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  let queryToken = "";
  try { queryToken = new URL(req.url).searchParams.get("token") || ""; } catch { /* ignore */ }
  if (headerToken !== webhookSecret && bearer !== webhookSecret && queryToken !== webhookSecret) {
    console.warn("mips-webhook-receiver: unauthorized request (missing/invalid token)");
    return new Response(JSON.stringify({ result: 0, code: "401" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let payload: Record<string, unknown>;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else if (contentType.includes("form-urlencoded")) {
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      const text = await req.text();
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    // Log EVERY incoming request for debugging
    console.log("=== MIPS WEBHOOK RECEIVED ===");
    console.log("Request info:", JSON.stringify({
      method: req.method,
      url: req.url,
      content_type: contentType,
      payload_keys: Object.keys(payload),
      timestamp: new Date().toISOString(),
    }));
    console.log("Full payload:", JSON.stringify(payload));

    // Check for ImgReg (registration photo callback)
    const eventType_raw = String(payload.eventType || payload.event_type || payload.type || "");
    if (eventType_raw === "ImgReg" || eventType_raw === "img_reg" || eventType_raw === "register") {
      await handleImgRegCallback(supabase, payload);
      const relayUrl = await getRelayUrl(supabase, null);
      if (relayUrl) relayToMips(relayUrl, payload, eventType_raw);
      return new Response(DEVICE_ACK, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract fields — device may send personId (which is actually personSn)
    const personNo = String(payload.personNo || payload.personSn || payload.personId || payload.person_no || "");
    const personName = String(payload.personName || payload.name || "Unknown");
    const passType = String(payload.passType || payload.pass_type || payload.type || "face");
    const temperature = payload.temperature ? parseFloat(String(payload.temperature)) : null;
    const deviceName = String(payload.deviceName || payload.device_name || payload.deviceKey || "unknown");
    const deviceKey = String(payload.deviceKey || payload.deviceSn || deviceName);

    const rawTime = payload.createTime || payload.time || payload.timestamp || payload.eventTime;
    const scanTime = normalizeScanTime(rawTime);

    const imgUri = String(payload.imgUri || payload.img_uri || payload.imgBase64 || "");
    const searchScore = payload.searchScore ? parseFloat(String(payload.searchScore)) : null;
    const livenessScore = payload.livenessScore ? parseFloat(String(payload.livenessScore)) : null;

    let eventType: string;
    let faceTypeInfo: { result: string; description: string } | null = null;

    if (passType.startsWith("face_")) {
      faceTypeInfo = mapFaceType(passType);
      eventType = "face_scan";
    } else {
      eventType = passType.includes("face")
        ? "face_scan"
        : passType.includes("finger")
          ? "fingerprint_scan"
          : passType.includes("card")
            ? "card_scan"
            : "identify";
    }

    let memberId: string | null = null;
    let profileId: string | null = null;
    let branchId: string | null = null;
    let result = faceTypeInfo?.result || "unknown";
    let message = faceTypeInfo?.description || `${personName} scanned via ${passType}`;

    const isStranger = passType === "face_2" || personNo === "STRANGERBABY" || !personNo;

    if (personNo && !isStranger) {
      console.log(`Looking up person: personNo=${personNo}`);

      // Tier 1: Direct match by mips_person_sn (fastest, most reliable)
      let person = await findPersonByMipsSn(supabase, personNo);

      // Tier 2: Match by mips_person_id (numeric MIPS ID)
      if (!person) {
        person = await findPersonByMipsId(supabase, personNo);
      }

      // Tier 3: Match by code normalization (member_code, employee_code)
      if (!person) {
        person = await findPersonByCode(supabase, personNo);
      }

      if (person) {
        console.log(`Person found: type=${person.type}, id=${person.id}`);
        branchId = person.branch_id;
        profileId = person.user_id;

        if (person.type === "member") {
          memberId = person.id;
          const checkin = await handleMemberCheckin(supabase, person.id, person.branch_id, personName, passType);
          result = checkin.result;
          message = checkin.message;
        } else {
          // Employee or trainer → staff attendance toggle
          result = person.type === "trainer" ? "trainer" : "staff";
          message = await handleStaffCheckin(supabase, person.user_id, person.branch_id, personName, person.type);
        }
      } else {
        // *** CRITICAL FIX: Override result to not_found instead of keeping face_type default ***
        console.warn(`Person NOT FOUND in CRM: personNo=${personNo}, personName=${personName}`);
        result = "not_found";
        message = `Person ${personNo} (${personName}) not found in CRM`;
      }
    } else if (isStranger) {
      result = "stranger";
      message = `Stranger detected at ${deviceName}`;
    }

    // Log to access_logs
    const { error: logError } = await supabase.from("access_logs").insert({
      device_sn: deviceKey,
      event_type: eventType,
      result,
      message,
      member_id: memberId,
      profile_id: profileId,
      branch_id: branchId,
      captured_at: scanTime,
      payload: {
        ...payload,
        temperature,
        img_uri: imgUri,
        search_score: searchScore,
        liveness_score: livenessScore,
        source: "mips_webhook",
        normalized_time: scanTime,
      },
    });

    if (logError) {
      console.error("Failed to insert access_log:", JSON.stringify(logError), { rawTime, scanTime });
    }

    console.log(`Processed: result=${result}, person=${personNo}, device=${deviceKey}, message=${message}`);

    // Relay to MIPS internal callback (fire-and-forget)
    try {
      const relayUrl = await getRelayUrl(supabase, branchId);
      if (relayUrl) {
        relayToMips(relayUrl, payload, eventType_raw);
      } else {
        console.log("No MIPS relay URL configured — skipping relay");
      }
    } catch (relayErr) {
      console.warn("Relay lookup failed:", relayErr);
    }

    return new Response(DEVICE_ACK, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("mips-webhook-receiver FATAL error:", message);
    return new Response(DEVICE_ACK, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
