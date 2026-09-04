// v2.5.0 - Two-way sync: recognition records are mirrored back to the MIPS server
//           (scheme-less server URLs normalized, native form-encoded body, fallback
//           /tdx-admin path, failures reported via log_error_event).
// v2.4.0 - Check-in-only staff attendance via staff_record_punch (one row per roster shift block).
//           Staff punches now carry the REAL hardware scan time (was webhook arrival
//           time, so a delayed delivery invented lateness), parsed by the shared
//           canonical parser also used by reconcile-mips-pass-records.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseScanTime } from "../_shared/mipsTime.ts";


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

// Timestamp normalisation lives in ../_shared/mipsTime.ts so that the webhook
// and the reconciliation cron can never disagree about when a scan happened.


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
      const reason = (checkinResult as any).reason as string | undefined;
      message = `${personName}: ${(checkinResult as any).message || "Check-in denied"}`;

      // Dues-blocked punch → alert the front desk so staff can intervene at the gate.
      if (reason === "dues_overdue") {
        try {
          const { data: access } = await supabase.rpc("member_access_status", {
            _member_id: memberId,
            _branch_id: branchId,
          });
          const { data: staff } = await supabase
            .from("user_roles")
            .select("user_id, role")
            .in("role", ["owner", "admin", "manager", "staff"]);
          const rows = (staff || []).map((s: any) => ({
            user_id: s.user_id,
            branch_id: branchId,
            title: "Gate entry denied — dues overdue",
            message: `${personName} was denied at the gate. Outstanding Rs. ${
              access?.outstanding_amount ?? "-"
            }, overdue by ${access?.days_overdue ?? "-"} day(s).`,
            type: "warning",
            category: "access",
            action_url: "/members",
          }));
          if (rows.length) await supabase.from("notifications").insert(rows);
        } catch (notifyErr) {
          console.warn("dues denial notification failed:", notifyErr);
        }
      }
      // If the check-in is invalid (dues overdue, expired, etc.), return a "deny" result.
      // This will be used in the main webhook handler to send a command back to the relay.
      if (checkinResult && !(checkinResult as any).valid) {
        return { result: "member_denied", message };
      }
    }
  } catch (e) {
    console.warn("Check-in RPC failed:", e);
    message = `Member ${personName} check-in RPC error: ${e}`;
  }

  return { result, message };
}

async function handleStaffCheckin(supabase: any, userId: string, branchId: string, personName: string, personType: string, scanTime: string) {
  const label = personType === "trainer" ? "Trainer" : "Staff";
  let message = `${label} ${personName} checked in`;

  try {
    // Check-in-only model: the RPC resolves the roster block for this punch and
    // records at most one attendance row per shift block per day. Repeat gate
    // scans inside the same block are ignored (no false check-outs, no dup alerts).
    //
    // check_in is the hardware scan time, never the webhook arrival time — a
    // delivery delayed by 5 minutes must not add 5 minutes of lateness.
    const { data, error } = await supabase.rpc("staff_record_punch", {
      p_user_id: userId,
      p_branch_id: branchId,
      p_check_in: scanTime,
      p_source: "gate",
      p_notes: null,
    });

    if (error) throw error;
    if (!data) message = `${label} ${personName} scan recorded (already checked in for this shift)`;
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

/**
 * Normalize a stored MIPS server URL into an absolute origin.
 * Rows created from the device UI often store `212.38.94.228:9000` with no
 * scheme — `new URL()` (used by fetch) then throws "Invalid URL", which is why
 * every recognition record failed to reach the MIPS server.
 */
function normalizeMipsBase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
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
    const fromConn = normalizeMipsBase(conn?.server_url);
    if (fromConn) return fromConn;
  }
  return normalizeMipsBase(Deno.env.get("MIPS_SERVER_URL"));
}

/**
 * Forward the raw recognition payload back to the MIPS server so its own pass
 * records stay in sync with ours (the gate can only push to ONE URL, and that
 * URL is now us). Sends the vendor's native form-encoded body, retries the
 * alternate `/tdx-admin` path, and returns whether MIPS accepted it.
 */
async function relayToMips(
  mipsServerUrl: string,
  payload: Record<string, unknown>,
  eventType: string,
): Promise<boolean> {
  const callbackPaths: string[] =
    eventType === "ImgReg" || eventType === "img_reg" || eventType === "register"
      ? ["/api/callback/imgReg", "/tdx-admin/api/callback/imgReg"]
      : ["/api/callback/identify", "/tdx-admin/api/callback/identity"];

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }

  for (const path of callbackPaths) {
    const url = `${mipsServerUrl}${path}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        console.log(`Relay OK → ${url} (${res.status})`);
        return true;
      }
      console.warn(`Relay rejected by ${url}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`Relay forward failed → ${url}:`, e instanceof Error ? e.message : String(e));
    }
  }
  return false;
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

    // Person-registration callback (`?event=regPerson`): the device tells us,
    // per person, whether it actually built a face template. This is the only
    // authoritative per-person signal — when a gate is configured to send it we
    // write it straight into the enrolment ledger instead of inferring from the
    // photoCount delta.
    const eventParam = new URL(req.url).searchParams.get("event") || "";
    if (eventParam === "regPerson") {
      try {
        const personSn = String(
          payload.personSn || payload.personNo || payload.person_sn || payload.personCode || "",
        );
        const deviceKey = String(payload.deviceKey || payload.deviceSn || payload.sn || "");
        const okFlag = payload.result ?? payload.success ?? payload.code ?? payload.status;
        const enrolled = okFlag === 200 || okFlag === 0 || okFlag === true ||
          okFlag === "success" || okFlag === "0" || okFlag === "200";
        if (personSn) {
          let mipsDeviceId: number | null = null;
          if (deviceKey) {
            const { data: dev } = await supabase
              .from("access_devices")
              .select("mips_device_id")
              .eq("serial_number", deviceKey)
              .maybeSingle();
            mipsDeviceId = dev?.mips_device_id ?? null;
          }
          const patch = enrolled
            ? { state: "enrolled", reason: null, enrolled_at: new Date().toISOString(), last_attempt_at: new Date().toISOString() }
            : {
                state: "rejected",
                reason: `Device rejected this photo: ${String(payload.msg || payload.message || "no face template")}`,
                last_attempt_at: new Date().toISOString(),
              };
          let q = supabase.from("mips_device_face_state").update(patch).eq("person_sn", personSn);
          if (mipsDeviceId != null) q = q.eq("mips_device_id", mipsDeviceId);
          await q;
          console.log(`[regPerson] ${personSn} on device ${deviceKey || "?"} → ${patch.state}`);
        }
      } catch (e) {
        console.warn("[regPerson] ledger update failed:", e instanceof Error ? e.message : String(e));
      }
      return new Response(DEVICE_ACK, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


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
    const parsedScan = parseScanTime(rawTime);
    const scanTime = parsedScan.iso;
    if (!parsedScan.fromHardware) {
      console.warn("MIPS payload carried no usable event time; falling back to arrival time", { rawTime });
    }

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

      // Tier 4: Alias by numeric MIPS id or by person name (device-created faces)
      if (!person) {
        person = await findPersonByAlias(supabase, personNo, personName);
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
          message = await handleStaffCheckin(supabase, person.user_id, person.branch_id, personName, person.type, scanTime);
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

    // Relay to the MIPS server so its own pass records mirror ours (two-way sync).
    // A failure here means MIPS silently misses the scan, so it is reported.
    try {
      const relayUrl = await getRelayUrl(supabase, branchId);
      if (relayUrl) {
        const relayed = await relayToMips(relayUrl, payload, eventType_raw);
        if (!relayed) {
          await supabase.rpc("log_error_event", {
            p_severity: "warning",
            p_source: "mips-webhook-receiver",
            p_message: `MIPS relay failed for ${personNo} @ ${deviceKey} — pass record not mirrored to MIPS`,
            p_function_name: "relayToMips",
            p_branch_id: branchId,
            p_context: { personNo, deviceKey, relayUrl, scanTime },
          });
        }
      } else {
        console.log("No MIPS relay URL configured — skipping relay");
      }
    } catch (relayErr) {
      console.warn("Relay lookup failed:", relayErr);
    }

    // *** CRITICAL HARDENING: Real-time Block Signal ***
    // If the check-in was denied (dues overdue, blacklisted, etc.), and we have a relay URL,
    // we send an immediate "deny/block" command back to the relay to force the gate shut.
    // This handles cases where the local device validTimeEnd hasn't synced yet.
    if (result === "member_denied" || result === "staff_denied" || result === "not_found" || result === "stranger") {
      try {
        const relayUrl = await getRelayUrl(supabase, branchId);
        if (relayUrl) {
          const denyUrl = `${relayUrl}/api/command/deny`;
          console.log(`[REAL-TIME BLOCK] Sending deny command to relay for ${personNo}: ${denyUrl}`);
          fetch(denyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              personSn: personNo,
              reason: message,
              timestamp: scanTime,
              deviceKey: deviceKey,
            }),
          }).catch((e) => console.warn("[REAL-TIME BLOCK] Command failed:", e));
        }
      } catch (blockErr) {
        console.warn("[REAL-TIME BLOCK] Failed to send deny signal:", blockErr);
      }
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
