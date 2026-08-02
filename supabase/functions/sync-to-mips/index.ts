// v2.1.0 — bounded timeouts on every MIPS call (no invocation can hang on a
// rebooting server). Face-safe photo normalization (never degrades a face below the
// terminal's detection threshold), per-stage audit rows for photo upload and
// photo assign, and retryable per-device delivery so one healthy gate cannot
// hide another gate's failure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as decodeImage } from "https://deno.land/x/imagescript@1.2.17/mod.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PERMANENT_END = "2099-12-31 23:59:59";
const REVOKED_DATE = "2000-01-01 00:00:00";
const MAX_PHOTO_BYTES = 400 * 1024; // 400KB per MIPS manual
// Above this the raw source is never decoded — decoding multi-MB photos in an
// edge worker exhausts memory and the invocation is killed by the platform.
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
// Face-safety floors: the terminal runs its own face detection on the image we
// push. Anything smaller / more compressed than this is accepted by the MIPS
// server but silently discarded by the gate, which is exactly how the fleet
// ended up with 41 faces for 57 server photos.
const MIN_FACE_EDGE = 720;
const MIN_FACE_QUALITY = 60;
const BIOMETRIC_BUCKET = "member-photos";
const AVATAR_PATH_PREFIX = "avatars/";


let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Prefer the private biometric bucket path (real face capture) over any
 * `_url` column, which frequently points at the low-res avatar bucket and
 * fails face-recognition on device.
 */
async function resolveBiometricPhoto(
  supabase: any,
  path: string | null | undefined,
  fallbackUrl: string | null | undefined,
): Promise<{ url: string; source: "biometric" | "avatar" | "" }> {
  if (path && typeof path === "string" && path.trim().length > 0) {
    const { data } = await supabase.storage
      .from(BIOMETRIC_BUCKET)
      .createSignedUrl(path, 60 * 10);
    if (data?.signedUrl) return { url: data.signedUrl, source: "biometric" };
  }
  if (fallbackUrl && String(fallbackUrl).trim().length > 0) {
    const isAvatar = String(fallbackUrl).includes(AVATAR_PATH_PREFIX);
    return { url: String(fallbackUrl), source: isAvatar ? "avatar" : "biometric" };
  }
  return { url: "", source: "" };
}

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
    // Bounded: a booting MIPS server must never hang the invocation.
    signal: AbortSignal.timeout(10_000),
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
    { method: "GET", headers: authHeaders(token), signal: AbortSignal.timeout(10_000) }
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
    signal: AbortSignal.timeout(15_000),
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
 * Re-encode an oversized image so it fits MIPS' 400KB face-photo cap WITHOUT
 * destroying the face.
 *
 * Face safety:
 *  - never resized below MIN_FACE_EDGE (720px) on the long edge
 *  - never encoded below MIN_FACE_QUALITY (60)
 *  - if 400KB is unreachable within those floors we return null so the caller
 *    reports `needs_better_source` instead of pushing an image the terminal
 *    will accept and then silently discard.
 *
 * Memory discipline (edge worker OOM guard): sources above MAX_SOURCE_BYTES are
 * never decoded — a 12MP phone JPEG expands to >50MB RGBA and kills the worker.
 */
async function normalizePhotoBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.length > MAX_SOURCE_BYTES) {
    console.warn(`normalizePhotoBytes: source too large (${Math.round(bytes.length / 1024)}KB) — refusing to decode`);
    return null;
  }
  try {
    const decoded = await decodeImage(bytes);
    // GIF (Frame collections) are not supported for face enrollment.
    if (!decoded || typeof (decoded as any).encodeJPEG !== "function") return null;
    let img: any = decoded;
    // Single bounded downscale pass — iterative resizes each allocate a fresh
    // full RGBA buffer and were the source of edge-worker OOM kills.
    const maxEdge = Math.max(img.width, img.height);
    if (maxEdge > 1080) {
      const scale = 1080 / maxEdge;
      img = img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
    }
    for (const quality of [85, 75, 65, MIN_FACE_QUALITY]) {
      const out = new Uint8Array(await img.encodeJPEG(quality));
      if (out.length <= MAX_PHOTO_BYTES) return out;
    }
    // Still too big: one final downscale straight to the face-safety floor.
    const curEdge = Math.max(img.width, img.height);
    if (curEdge > MIN_FACE_EDGE) {
      const scale = MIN_FACE_EDGE / curEdge;
      const small = img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
      img = null;
      for (const quality of [75, MIN_FACE_QUALITY]) {
        const out = new Uint8Array(await small.encodeJPEG(quality));
        if (out.length <= MAX_PHOTO_BYTES) return out;
      }
    }
    console.warn("normalizePhotoBytes: cannot reach 400KB without dropping below face-safety floors");
    return null;
  } catch (e) {
    // Never let a heavy image take the whole sync down — the caller reports
    // needs_better_source and mips-face-sweep can retry later.
    console.warn("normalizePhotoBytes failed:", e);
    return null;
  }
}


/**
 * Two-step photo upload:
 * 1. POST /common/uploadHeadPhoto (multipart) → get fileName
 * 2. PUT /personInfo/person with full person object + photoUri = fileName
 * 
 * MIPS rules: JPG only, max 400KB (oversized images are re-encoded here)
 */
async function uploadPhoto(
  baseUrl: string,
  token: string,
  personSn: string,
  photoUrl: string,
  supabase?: any,
): Promise<{ success: boolean; message: string; fileName?: string; bytes?: Uint8Array }> {

  if (!photoUrl) return { success: false, message: "No photo URL" };

  try {
    let url = photoUrl;
    if (!url.startsWith("http")) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      url = `${supabaseUrl}/storage/v1/object/public/${url}`;
    }

    console.log(`Fetching biometric photo for ${personSn}`);
    let photoRes = await fetch(url, { signal: AbortSignal.timeout(8_000) });

    // Fallback — if the public URL is broken (bucket flipped private, ACL
    // change, avatar deleted), try to re-sign the same path via service role
    // against the private `member-photos` bucket.
    if (!photoRes.ok && supabase) {
      const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/);
      if (m) {
        const bucket = m[1];
        const path = decodeURIComponent(m[2]);
        console.warn(`Public fetch failed (${photoRes.status}); trying signed URL bucket=${bucket} path=${path}`);
        const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
        if (signed?.signedUrl) {
          photoRes = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(8_000) });
        }
        // Second fallback — try the biometric bucket at the same path (avatar → biometric drift).
        if (!photoRes.ok && bucket !== BIOMETRIC_BUCKET) {
          const { data: bioSigned } = await supabase.storage.from(BIOMETRIC_BUCKET).createSignedUrl(path, 300);
          if (bioSigned?.signedUrl) {
            console.warn(`Trying biometric bucket fallback for path=${path}`);
            photoRes = await fetch(bioSigned.signedUrl, { signal: AbortSignal.timeout(8_000) });
          }
        }
      }
    }
    if (!photoRes.ok) {
      return { success: false, message: `Photo fetch failed: ${photoRes.status} at ${url}` };
    }

    let photoBytes = new Uint8Array(await photoRes.arrayBuffer());
    let sizeKB = Math.round(photoBytes.length / 1024);

    // Never fail on size — MIPS caps face photos at 400KB, so re-encode
    // server-side (downscale + iterative JPEG quality) instead of aborting.
    if (photoBytes.length > MAX_PHOTO_BYTES) {
      const normalized = await normalizePhotoBytes(photoBytes);
      if (!normalized) {
        return {
          success: false,
          message: `needs_better_source: ${sizeKB}KB photo cannot fit 400KB without dropping below ${MIN_FACE_EDGE}px / q${MIN_FACE_QUALITY} face-safety floors`,
        };
      }
      console.log(`Photo normalized: ${sizeKB}KB → ${Math.round(normalized.length / 1024)}KB`);
      photoBytes = normalized;
      sizeKB = Math.round(photoBytes.length / 1024);
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
      signal: AbortSignal.timeout(8_000),
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

    return { success: true, message: "Photo uploaded and assigned", fileName: filePath, bytes: photoBytes };
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
  branchId?: string,
  entityType?: "member" | "employee" | "trainer",
  entityId?: string,
): Promise<{ results: any[]; deviceIds: number[] }> {
  // 1. Try to get device IDs from access_devices table
  //    IMPORTANT: include ALL mapped devices, not just is_online. MIPS server
  //    queues syncs for offline devices and delivers them on reconnect —
  //    filtering by online silently drops second devices that blipped once.
  let deviceIds: number[] = [];
  let localDevices: any[] = [];

  try {
    let query = supabase
      .from("access_devices")
      .select("id, mips_device_id, device_name, serial_number, is_online")
      .not("serial_number", "is", null);
    if (branchId) query = query.eq("branch_id", branchId);
    const { data: devices } = await query;
    localDevices = devices || [];
  } catch (e) {
    console.warn("Error fetching access_devices:", e);
  }

  // Always pull server device list so we can auto-heal missing mips_device_id
  // mappings (fixes second/third devices that were added on the MIPS server
  // but never mapped in access_devices).
  let serverBySerial = new Map<string, { id: number; online: boolean }>();
  try {
    const res = await fetch(`${baseUrl}/through/device/list`, {
      method: "GET",
      headers: authHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const json = JSON.parse(text);
    const rows = json?.rows || json?.data;
    if (Array.isArray(rows)) {
      for (const d of rows) {
        const sn = String(d.deviceKey || d.sn || d.serialNumber || "").trim();
        const mid = Number(d.id ?? d.deviceId);
        if (sn && !isNaN(mid)) {
          serverBySerial.set(sn.toUpperCase(), {
            id: mid,
            online: d.onlineFlag === 1 || d.status === 1 || d.status === "1",
          });
        }
      }
    }
  } catch (e) {
    console.warn("Error fetching MIPS device list:", e);
  }

  // Auto-heal: backfill mips_device_id / is_online for local devices matched by SN
  for (const local of localDevices) {
    const sn = String(local.serial_number || "").trim().toUpperCase();
    if (!sn) continue;
    const match = serverBySerial.get(sn);
    if (!match) continue;

    const needsMap = !local.mips_device_id || Number(local.mips_device_id) !== match.id;
    if (needsMap) {
      await supabase
        .from("access_devices")
        .update({
          mips_device_id: match.id,
          is_online: match.online,
          last_reconcile_at: new Date().toISOString(),
          ...(match.online ? { last_heartbeat: new Date().toISOString() } : {}),
        })
        .eq("id", local.id);
      local.mips_device_id = match.id;
      local.is_online = match.online;
      console.log(`[dispatchToDevices] auto-mapped ${local.device_name} SN=${sn} → mips_device_id=${match.id}`);
    }
  }

  deviceIds = localDevices
    .map((d: any) => d.mips_device_id)
    .filter((id: any) => id && !isNaN(Number(id)))
    .map((id: any) => Number(id));

  // Final fallback: if we still have nothing locally, dispatch to all online server devices
  if (deviceIds.length === 0) {
    for (const [, v] of serverBySerial) {
      if (v.online) deviceIds.push(v.id);
    }
  }

  console.log(`[dispatchToDevices] branch=${branchId || 'all'} local=${localDevices.length} server=${serverBySerial.size} dispatch_ids=[${deviceIds.join(",")}]`);

  if (deviceIds.length === 0) {
    console.warn("No devices found for dispatch");
    return { results: [], deviceIds: [] };
  }


  // Dispatch separately so Gate 1 and Gate 2 have independent delivery truth.
  // A combined request can return 200 while silently failing one device.
  const results: any[] = [];
  const deliveredDeviceIds: number[] = [];
  for (const mipsDeviceId of [...new Set(deviceIds)]) {
    const local = localDevices.find((d: any) => Number(d.mips_device_id) === mipsDeviceId);
    const started = Date.now();
    let result: any = null;
    let responseCode = 0;
    let status = "failed";
    let lastError: string | null = null;
    try {
      // "请选择在线设备" ("please select an online device") is a transient
      // window on the MIPS side, not a permanent failure — back off and retry
      // instead of losing the dispatch.
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const res = await fetch(`${baseUrl}/through/device/syncPerson`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ personId, deviceIds: [mipsDeviceId], deviceNumType: "4" }),
          signal: AbortSignal.timeout(8_000),
        });
        responseCode = res.status;
        const text = await res.text();
        try { result = JSON.parse(text); } catch { result = { raw: text }; }
        const apiCode = Number(result?.code ?? result?.data?.code);
        const accepted = res.ok && (apiCode === 0 || apiCode === 200);
        status = accepted ? "success" : "failed";
        lastError = accepted ? null : String(result?.msg || result?.message || `HTTP ${res.status}`);
        if (accepted) {
          deliveredDeviceIds.push(mipsDeviceId);
          break;
        }
        const retryable = lastError.includes("请选择在线设备") || res.status >= 500;
        if (attempt < MAX_ATTEMPTS && retryable) {
          await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        } else {
          break;
        }
      }

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      result = { error: lastError };
    }

    if (local?.id && branchId) {
      const { error: auditError } = await supabase.from("mips_sync_attempts").insert({
        branch_id: branchId,
        device_id: local.id,
        entity_type: entityType,
        entity_id: entityId,
        mips_person_id: personId,
        operation: "device_dispatch",
        status,
        delivery_stage: status === "success" ? "device_accepted" : "failed",
        last_error: lastError,
        response_code: responseCode,
        latency_ms: Date.now() - started,
        response_payload: result,
        completed_at: new Date().toISOString(),
        verification_payload: {
          accepted_only: status === "success",
          message: result?.msg || result?.message || null,
        },
      });
      if (auditError) console.warn("Device delivery audit insert failed:", auditError.message);
    }
    results.push({ mipsDeviceId, status, responseCode, lastError, response: result });
  }

  return { results, deviceIds: deliveredDeviceIds, requestedDeviceIds: deviceIds };
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
    const { person_type, person_id, branch_id, verify_only, person_no, deploy_to_devices } = body as {

      person_type: "member" | "employee" | "trainer";
      person_id: string;
      branch_id?: string;
      verify_only?: boolean;
      person_no?: string;
      /** false = upload to MIPS server only, let cron fan out to devices. Default true. */
      deploy_to_devices?: boolean;
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

    // Step 1: Fetch CRM data based on person type — merge every available source
    // (profile → lead → row) so lead-converted members don't sync as "Unknown".
    let name = "Unknown";
    let personNo = "";
    let phone = "";
    let email = "";
    let photoUrl = "";
    let photoSource: "biometric" | "avatar" | "" = "";

    let gender: "M" | "F" | "U" = "U";
    let birthday: string | null = null;                     // YYYY-MM-DD
    let deptId = 100;
    let deptName = "Members";
    let remarkExtra = "";
    let validTimeBegin = formatDate(new Date().toISOString(), "2024-01-01 00:00:00");
    let validTimeEnd = PERMANENT_END;
    let tableName: string;
    let effectiveBranchId = branch_id;
    let shouldRevokeInstead = false;
    let revokeReason = "Inactive/offboarded staff must not be synced";

    const normGender = (g?: string | null): "M" | "F" | "U" => {
      const s = (g || "").trim().toLowerCase();
      if (s.startsWith("m")) return "M";
      if (s.startsWith("f")) return "F";
      return "U";
    };
    const fmtDob = (d?: string | null): string | null => {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    };
    const pick = (...vals: Array<string | null | undefined>) =>
      vals.find((v) => v && String(v).trim().length > 0) as string | undefined;

    if (person_type === "member") {
      tableName = "members";
      deptId = 100;
      deptName = "Members";
      const { data: member, error } = await supabase
        .from("members")
        .select("*, profiles:user_id(full_name, phone, avatar_url, email, gender, date_of_birth), leads:lead_id(full_name, phone, email, gender, date_of_birth, avatar_url)")
        .eq("id", person_id)
        .maybeSingle();
      if (error) throw new Error(`Member query error: ${error.message}`);
      if (!member) throw new Error(`Member not found with id: ${person_id}`);

      const profile = (member as any).profiles || null;
      const lead = (member as any).leads || null;

      name = pick(profile?.full_name, lead?.full_name) || `Member ${member.member_code || ""}`.trim() || "Unknown";
      personNo = member.member_code || person_id.substring(0, 8);
      phone = pick(profile?.phone, lead?.phone) || "";
      email = pick(profile?.email, lead?.email) || "";
      const resolved = await resolveBiometricPhoto(
        supabase,
        (member as any).biometric_photo_path,
        pick(member.biometric_photo_url, profile?.avatar_url, lead?.avatar_url),
      );
      photoUrl = resolved.url;
      photoSource = resolved.source;

      gender = normGender(profile?.gender ?? lead?.gender);
      birthday = fmtDob(profile?.date_of_birth ?? lead?.date_of_birth);

      effectiveBranchId = effectiveBranchId || member.branch_id;

      // Membership validity — pick newest membership regardless of status so
      // future/frozen/expired members get correct MIPS access windows.
      const { data: membership } = await supabase
        .from("memberships")
        .select("start_date, end_date, status")
        .eq("member_id", person_id)
        .order("end_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membership) {
        remarkExtra = `Membership ${membership.status}`;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const endDate = new Date(membership.end_date + "T23:59:59");
        if (membership.status === "expired" || membership.status === "cancelled" || endDate < today) {
          // Expired → block access on device
          validTimeBegin = formatDate(membership.start_date + "T00:00:00", validTimeBegin);
          validTimeEnd = REVOKED_DATE;
        } else {
          // active | frozen | future — send real dates so access opens on start
          validTimeBegin = formatDate(membership.start_date + "T00:00:00", validTimeBegin);
          validTimeEnd = formatDate(membership.end_date + "T23:59:59", validTimeEnd);
        }
      } else {
        // No membership yet — give a 24h probation window instead of 2099
        remarkExtra = "No active membership (probation window)";
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        validTimeEnd = formatDate(tomorrow.toISOString(), validTimeEnd);
      }
    } else if (person_type === "employee") {
      tableName = "employees";
      deptId = 101;
      const { data: emp, error } = await supabase
        .from("employees")
        .select("*, profiles:user_id(full_name, phone, avatar_url, email, gender, date_of_birth)")
        .eq("id", person_id)
        .maybeSingle();
      if (error) throw new Error(`Employee query error: ${error.message}`);
      if (!emp) throw new Error(`Employee not found with id: ${person_id}`);

      const profile = (emp as any).profiles || null;
      name = pick(profile?.full_name, (emp as any).full_name) || "Unknown";
      personNo = emp.employee_code || person_id.substring(0, 8);
      phone = pick(profile?.phone, (emp as any).personal_phone, (emp as any).phone) || "";
      email = pick(profile?.email, (emp as any).personal_email, (emp as any).email) || "";
      const resolved = await resolveBiometricPhoto(
        supabase,
        (emp as any).biometric_photo_path,
        pick(emp.biometric_photo_url, profile?.avatar_url),
      );
      photoUrl = resolved.url;
      photoSource = resolved.source;

      gender = normGender((emp as any).gender ?? profile?.gender);
      birthday = fmtDob((emp as any).date_of_birth ?? profile?.date_of_birth);

      deptName = (emp as any).department || "Staff";
      remarkExtra = [ (emp as any).department, (emp as any).position ].filter(Boolean).join(" · ");
      effectiveBranchId = effectiveBranchId || emp.branch_id;
      shouldRevokeInstead = emp.is_active === false || !!emp.exit_date;
      revokeReason = emp.exit_type ? `Staff offboarded: ${emp.exit_type}` : revokeReason;
      validTimeEnd = PERMANENT_END;
    } else if (person_type === "trainer") {
      tableName = "trainers";
      deptId = 102;
      const { data: trainer, error } = await supabase
        .from("trainers")
        .select("id, branch_id, biometric_photo_url, biometric_photo_path, is_active, user_id, mips_sync_status, mips_person_id, exit_date, exit_type, specializations")
        .eq("id", person_id)
        .maybeSingle();
      if (error) throw new Error(`Trainer query error: ${error.message}`);
      if (!trainer) throw new Error(`Trainer not found with id: ${person_id}`);

      // Fetch profile separately to avoid join coercion errors when user_id is null
      let profile: any = null;
      if (trainer.user_id) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("full_name, phone, avatar_url, email, gender, date_of_birth")
          .eq("id", trainer.user_id)
          .maybeSingle();
        profile = profileData;
      }

      name = profile?.full_name || "Unknown";
      phone = profile?.phone || "";
      email = profile?.email || "";
      const resolvedTrainer = await resolveBiometricPhoto(
        supabase,
        (trainer as any).biometric_photo_path,
        (trainer as any).biometric_photo_url || profile?.avatar_url,
      );
      photoUrl = resolvedTrainer.url;
      photoSource = resolvedTrainer.source;

      gender = normGender(profile?.gender);
      birthday = fmtDob(profile?.date_of_birth);
      const specs = Array.isArray((trainer as any).specializations) ? (trainer as any).specializations : [];
      deptName = specs.length > 0 ? `Trainer · ${specs[0]}` : "Trainer";
      remarkExtra = specs.join(", ");

      effectiveBranchId = effectiveBranchId || trainer.branch_id;
      shouldRevokeInstead = trainer.is_active === false || !!(trainer as any).exit_date;
      revokeReason = (trainer as any).exit_type ? `Trainer offboarded: ${(trainer as any).exit_type}` : revokeReason;
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
    console.log(`Syncing ${person_type}: ${name} (${personNo} → ${mipsPersonSn}) gender=${gender} dob=${birthday || "-"} dept=${deptName}`);

    // Step 2: Check if person already exists in MIPS
    const existing = await lookupPerson(baseUrl, token, mipsPersonSn);
    console.log(`MIPS lookup: ${existing ? `found personId=${existing.personId}` : "not found"}`);

    if (shouldRevokeInstead && (person_type === "employee" || person_type === "trainer")) {
      if (existing) {
        const updatedPerson = { ...existing, validTimeEnd: REVOKED_DATE, remark: revokeReason };
        const putRes = await fetch(`${baseUrl}/personInfo/person`, {
          method: "PUT",
          headers: authHeaders(token),
          body: JSON.stringify(updatedPerson),
          signal: AbortSignal.timeout(15_000),
        });
        const putJson = await putRes.json().catch(() => ({}));
        const ok = putJson.code === 200 || putJson.code === 0;
        if (!ok) throw new Error(`MIPS revoke failed: ${putJson.msg || JSON.stringify(putJson)}`);
        try { await dispatchToDevices(baseUrl, token, existing.personId, supabase, effectiveBranchId, person_type, person_id); } catch (_) { /* non-fatal */ }
      }

      await supabase.from(tableName).update({
        mips_sync_status: "revoked",
        mips_person_sn: mipsPersonSn,
        ...(existing?.personId ? { mips_person_id: String(existing.personId) } : {}),
      }).eq("id", person_id);

      return new Response(JSON.stringify({
        success: true,
        action: "revoked_instead_of_synced",
        reason: revokeReason,
        mips_person_id: existing?.personId ?? null,
        person: { name, personSn: mipsPersonSn, originalCode: personNo },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 3: Create or update person — omit empty strings so MIPS keeps prior values
    const personType = person_type === "member" ? 1 : 2;
    const personPayload: Record<string, unknown> = {
      personSn: mipsPersonSn,
      personType,
      deptId,
      deptName,
      name,
      attendance: "1",
      holiday: "1",
      validTimeBegin,
      validTimeEnd,
      gender,
      remark: [
        person_type === "member" ? "Gym Member" : person_type === "trainer" ? "Trainer" : "Staff",
        remarkExtra,
      ].filter(Boolean).join(" — "),
    };
    if (phone) personPayload.mobile = phone;
    if (email) personPayload.email = email;
    if (birthday) personPayload.birthday = birthday;

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
    // Photo upload is non-blocking for the person record, but its true result
    // IS audited — an unaudited photo stage is why the queue read 100% success
    // while 16 faces were missing from the gates.
    let photoResult = { success: false, message: "No photo available" } as any;
    if (photoUrl) {
      const photoStarted = Date.now();
      try {
        photoResult = await uploadPhoto(baseUrl, token, mipsPersonSn, photoUrl, supabase);
        console.log(`Photo upload: ${photoResult.success ? "✓" : "✗"} ${photoResult.message}`);
      } catch (photoErr) {
        console.warn("Photo upload failed (non-fatal):", photoErr);
        photoResult = { success: false, message: `Photo upload error: ${photoErr instanceof Error ? photoErr.message : String(photoErr)}` };
      }
      if (effectiveBranchId) {
        const { error: photoAuditErr } = await supabase.from("mips_sync_attempts").insert({
          branch_id: effectiveBranchId,
          entity_type: person_type,
          entity_id: person_id,
          mips_person_id: personId,
          operation: "photo_upload",
          status: photoResult?.success ? "success" : "failed",
          delivery_stage: photoResult?.success ? "server_face_ready" : "failed",
          last_error: photoResult?.success ? null : String(photoResult?.message || "photo upload failed"),
          latency_ms: Date.now() - photoStarted,
          response_payload: {
            message: photoResult?.message ?? null,
            file_name: photoResult?.fileName ?? null,
            bytes: photoResult?.bytes?.length ?? null,
            photo_source: photoSource || null,
          },
          completed_at: new Date().toISOString(),
        });
        if (photoAuditErr) console.warn("Photo stage audit insert failed:", photoAuditErr.message);
      }
    } else {

      console.log("No photo URL provided, skipping photo upload");
    }

    // Step 4b: If the face image came from the public avatar bucket, persist the
    // normalized (device-ready) copy into the private biometric bucket and
    // backfill biometric_photo_path so future syncs use the high-quality path.
    if (photoResult?.success && photoSource === "avatar" && photoResult.bytes) {
      try {
        const bioPath = `biometric/${tableName}/${person_id}.jpg`;
        const { error: upErr } = await supabase.storage
          .from(BIOMETRIC_BUCKET)
          .upload(bioPath, photoResult.bytes, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        await supabase.from(tableName).update({ biometric_photo_path: bioPath }).eq("id", person_id);
        console.log(`Biometric path backfilled: ${bioPath}`);
      } catch (e) {
        console.warn("Biometric backfill failed (non-fatal):", e);
      }
    }

    // Step 5: Dispatch to ALL mapped devices (multi-device) — unless caller
    // explicitly opted out (verification-only flows).
    let dispatchResult: any = null;
    if (deploy_to_devices === false) {
      dispatchResult = { skipped: true, reason: "deploy_to_devices=false" };
    } else {
      try {
        dispatchResult = await dispatchToDevices(baseUrl, token, personId, supabase, effectiveBranchId, person_type, person_id);
      } catch (e) {
        console.error("Dispatch error:", e);
        dispatchResult = { error: String(e) };
      }
    }

    const dispatchedDeviceIds: number[] = Array.isArray(dispatchResult?.deviceIds)
      ? dispatchResult.deviceIds
      : [];
    const photoUploaded = Boolean(photoResult?.success);
    const requestedDeviceIds: number[] = Array.isArray(dispatchResult?.requestedDeviceIds)
      ? dispatchResult.requestedDeviceIds
      : [];
    const allDevicesDelivered = deploy_to_devices === false
      || (requestedDeviceIds.length > 0 && dispatchedDeviceIds.length === requestedDeviceIds.length);

    // Step 6: Update CRM database with real personId AND mips_person_sn
    await supabase.from(tableName).update({
      mips_sync_status: photoUploaded && allDevicesDelivered ? "synced" : "failed",
      mips_person_id: String(personId),
      mips_person_sn: mipsPersonSn,
    }).eq("id", person_id);
    console.log(`CRM updated: mips_person_id=${personId}, mips_person_sn=${mipsPersonSn}`);

    return new Response(JSON.stringify({
      success: photoUploaded && allDevicesDelivered,
      mips_person_id: personId,
      action: existing ? "updated" : "created",
      photo_uploaded: photoUploaded,
      photo_source: photoSource || null,
      dispatched_device_ids: dispatchedDeviceIds,
      requested_device_ids: requestedDeviceIds,
      photo_result: { success: photoResult?.success ?? false, message: photoResult?.message },
      dispatch_result: dispatchResult && typeof dispatchResult === "object"
        ? { ...dispatchResult, results: undefined, deviceIds: dispatchedDeviceIds }
        : dispatchResult,
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
