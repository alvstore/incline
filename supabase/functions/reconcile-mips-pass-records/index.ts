// v2.2.0 — Reconcile recent MIPS pass records into access_logs + attendance (alias by id/name).
// v2 fixes: staff check_in is stamped with the real hardware scan time (was
// the cron run time, which made every lateness figure wrong), repeat scans
// inside the branch punch-gap no longer open a second attendance row, and a
// later scan closes the open row as a check-out instead of re-checking in.
// Pulls the MIPS server's /through/record/list as the hardware source of truth,
// then idempotently imports missing rows so Live Access Feed works even when
// terminal webhooks are not landing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  mipsFetch,
  MipsTransportError,
  readBreaker,
  isTripped,
  recordTransportFailure,
  recordSuccess,
} from "../_shared/mipsHealth.ts";

type Role = "owner" | "admin" | "manager" | "staff" | "trainer" | "member";

type MipsConnection = {
  branch_id: string;
  server_url: string;
  username: string;
  password: string;
};

type MipsPassRecord = {
  id?: number | string;
  recordId?: number | string;
  personNo?: string;
  personSn?: string;
  personId?: string | number;
  personName?: string;
  name?: string;
  passType?: string;
  passPersonType?: string;
  type?: string;
  temperature?: string | number;
  imgUri?: string;
  img_uri?: string;
  deviceName?: string;
  deviceKey?: string;
  deviceSn?: string;
  createTime?: string;
  time?: string | number;
  timestamp?: string | number;
  eventTime?: string | number;
  [key: string]: unknown;
};

type PersonMatch = {
  id: string;
  branch_id: string;
  user_id: string | null;
  type: "member" | "employee" | "trainer";
};

type RequestBody = {
  branch_id?: string;
  limit?: number;
  dry_run?: boolean;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_ROLES = new Set<Role>(["owner", "admin", "manager", "staff"]);

let cachedToken: string | null = null;
let tokenExpiry = 0;
let cachedBaseUrl = "";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function getBaseUrl(url: string): string {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `http://${trimmed}` : trimmed;
}

function reinsertHyphen(stripped: string): string | null {
  const match = stripped.match(/^([A-Za-z]{3,4})([A-Za-z0-9]+)$/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function normalizePersonCodeCandidates(rawCode: string): string[] {
  const trimmed = rawCode.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  candidates.add(trimmed);
  candidates.add(trimmed.toUpperCase());

  const legacyHyphen = reinsertHyphen(trimmed);
  if (legacyHyphen) candidates.add(legacyHyphen);

  const upper = trimmed.toUpperCase();
  if (!trimmed.includes("-") && upper.startsWith("EMP") && trimmed.length > 3) {
    candidates.add(`EMP-${trimmed.slice(3)}`);
  }
  if (!trimmed.includes("-") && upper.startsWith("TRN") && trimmed.length > 3) {
    candidates.add(`TRN-${trimmed.slice(3)}`);
  }

  return Array.from(candidates);
}

function normalizeScanTime(rawTime: unknown): string {
  if (rawTime === null || rawTime === undefined || rawTime === "") return new Date().toISOString();

  const asNumber = Number(rawTime);
  if (Number.isFinite(asNumber)) {
    const abs = Math.abs(asNumber);
    let ms = asNumber;
    if (abs >= 1e18) ms = asNumber / 1e6;
    else if (abs >= 1e15) ms = asNumber / 1e3;
    else if (abs >= 1e12) ms = asNumber;
    else ms = asNumber * 1e3;

    const dateObj = new Date(ms);
    if (!Number.isNaN(dateObj.getTime())) return dateObj.toISOString();
  }

  if (typeof rawTime === "string") {
    const trimmed = rawTime.trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      const parsedIst = new Date(`${trimmed.replace(" ", "T")}+05:30`);
      if (!Number.isNaN(parsedIst.getTime())) return parsedIst.toISOString();
    }

    const parsed = new Date(trimmed.replace(" ", "T"));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function getRecordKey(record: MipsPassRecord): string {
  const explicitId = getString(record.id ?? record.recordId);
  if (explicitId) return explicitId;

  const personNo = getString(record.personNo ?? record.personSn ?? record.personId);
  const device = getString(record.deviceKey ?? record.deviceSn ?? record.deviceName);
  const rawTime = record.createTime ?? record.time ?? record.timestamp ?? record.eventTime;
  return `${device}:${personNo}:${normalizeScanTime(rawTime)}`;
}

function mapResult(record: MipsPassRecord, matchedType?: PersonMatch["type"]): string {
  if (matchedType === "member") return "member";
  if (matchedType === "employee") return "staff";
  if (matchedType === "trainer") return "trainer";

  const passType = getString(record.passType ?? record.type).toLowerCase();
  const passPersonType = getString(record.passPersonType).toLowerCase();
  if (passType === "face_2" || passPersonType.includes("stranger") || passPersonType.includes("unknown")) return "stranger";
  if (passType === "face_1") return "denied";
  if (passPersonType.includes("member")) return "member";
  if (passPersonType.includes("staff") || passPersonType.includes("employee")) return "staff";
  if (passPersonType.includes("trainer")) return "trainer";
  return "accepted";
}

function mapEventType(record: MipsPassRecord): string {
  const passType = getString(record.passType ?? record.type).toLowerCase();
  if (passType.includes("finger")) return "fingerprint_scan";
  if (passType.includes("card")) return "card_scan";
  return "face_scan";
}

async function getRuoYiToken(baseUrl: string, username: string, password: string): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry && cachedBaseUrl === `${baseUrl}:${username}`) return cachedToken;

  const { text } = await mipsFetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
  }, 12_000);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`MIPS login returned non-JSON: ${text.slice(0, 240)}`);
  }

  const code = Number(json.code);
  if (code !== 200 && code !== 0) {
    throw new Error(`MIPS login failed: ${getString(json.msg) || text.slice(0, 240)}`);
  }

  const data = typeof json.data === "object" && json.data !== null ? json.data as Record<string, unknown> : {};
  const token = getString(json.token ?? data.token);
  if (!token) throw new Error("MIPS login returned no token");

  cachedToken = token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  cachedBaseUrl = `${baseUrl}:${username}`;
  return token;
}

function extractRows(json: Record<string, unknown>): MipsPassRecord[] {
  const data = typeof json.data === "object" && json.data !== null ? json.data as Record<string, unknown> : {};
  const candidates = [
    json.rows,
    json.data,
    json.list,
    json.records,
    data.rows,
    data.list,
    data.records,
    data.data,
  ];
  const rows = candidates.find(Array.isArray) as unknown[] | undefined;
  return (rows ?? []).filter((row): row is MipsPassRecord => typeof row === "object" && row !== null);
}

async function fetchPassRecords(connection: MipsConnection, limit: number): Promise<MipsPassRecord[]> {
  const baseUrl = getBaseUrl(connection.server_url);
  const token = await getRuoYiToken(baseUrl, connection.username, connection.password);
  const endpoints = [
    { path: "/through/record/list", params: { pageNum: "1", pageSize: String(limit) } },
    { path: "/interface/exterior/getCheckRecordList", params: { pageNum: "1", pageSize: String(limit) } },
    { path: "/interface/exterior/getCheckRecordList", params: { pageNo: "1", pageSize: String(limit) } },
  ];

  const errors: string[] = [];
  let transportFailures = 0;
  for (const endpoint of endpoints) {
    const searchParams = new URLSearchParams(endpoint.params);
    const url = `${baseUrl}${endpoint.path}?${searchParams.toString()}`;
    console.log(`[reconcile-mips-pass-records] GET ${url}`);

    let res: Response;
    let text: string;
    try {
      ({ res, text } = await mipsFetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "TENANT-ID": "1",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      }, 20_000));
    } catch (e) {
      // One endpoint being unreachable can still mean another answers, so keep
      // going; only a clean sweep of transport failures is a real outage.
      if (e instanceof MipsTransportError) {
        transportFailures++;
        errors.push(`${endpoint.path}: ${e.message}`);
        continue;
      }
      throw e;
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      transportFailures++; // a booting Tomcat serves an HTML error page
      errors.push(`${endpoint.path}: non-JSON ${text.slice(0, 160)}`);
      continue;
    }

    const rows = extractRows(json);
    const code = Number(json.code);
    if (res.ok && (code === 200 || code === 0 || rows.length > 0)) return rows;
    errors.push(`${endpoint.path}: ${getString(json.msg ?? json.message) || text.slice(0, 160)}`);
  }

  const summary = `MIPS records failed: ${errors.join(" | ")}`.slice(0, 500);
  if (transportFailures === endpoints.length) throw new MipsTransportError(summary);
  throw new Error(summary);
}

async function findPersonByCode(supabase: ReturnType<typeof createClient>, personCode: string, personName?: string): Promise<PersonMatch | null> {
  const candidates = normalizePersonCodeCandidates(personCode);
  if (!candidates.length) {
    return await resolveAlias(supabase, personCode, personName);
  }

  const [memberBySn, employeeBySn, trainerBySn] = await Promise.all([
    supabase.from("members").select("id, branch_id, user_id").in("mips_person_sn", candidates).maybeSingle(),
    supabase.from("employees").select("id, branch_id, user_id").in("mips_person_sn", candidates).maybeSingle(),
    supabase.from("trainers").select("id, branch_id, user_id").in("mips_person_sn", candidates).maybeSingle(),
  ]);
  if (memberBySn.data) return { ...memberBySn.data, type: "member" } as PersonMatch;
  if (employeeBySn.data) return { ...employeeBySn.data, type: "employee" } as PersonMatch;
  if (trainerBySn.data) return { ...trainerBySn.data, type: "trainer" } as PersonMatch;

  const [memberByCode, employeeByCode, trainerByMipsId, memberByMipsId, employeeByMipsId] = await Promise.all([
    supabase.from("members").select("id, branch_id, user_id").in("member_code", candidates).maybeSingle(),
    supabase.from("employees").select("id, branch_id, user_id").in("employee_code", candidates).maybeSingle(),
    supabase.from("trainers").select("id, branch_id, user_id").in("mips_person_id", candidates).maybeSingle(),
    supabase.from("members").select("id, branch_id, user_id").in("mips_person_id", candidates).maybeSingle(),
    supabase.from("employees").select("id, branch_id, user_id").in("mips_person_id", candidates).maybeSingle(),
  ]);
  if (memberByCode.data) return { ...memberByCode.data, type: "member" } as PersonMatch;
  if (employeeByCode.data) return { ...employeeByCode.data, type: "employee" } as PersonMatch;
  if (trainerByMipsId.data) return { ...trainerByMipsId.data, type: "trainer" } as PersonMatch;
  if (memberByMipsId.data) return { ...memberByMipsId.data, type: "member" } as PersonMatch;
  if (employeeByMipsId.data) return { ...employeeByMipsId.data, type: "employee" } as PersonMatch;
  // Manual alias mapping (legacy / device-created person codes, numeric ids, names)
  for (const candidate of [personCode, ...candidates]) {
    if (!candidate) continue;
    const aliased = await resolveAlias(supabase, candidate);
    if (aliased) return aliased;
  }

  return await resolveAlias(supabase, "", personName);
}

/** Resolve a punch through mips_person_aliases by code, numeric id, or person name. */
async function resolveAlias(
  supabase: ReturnType<typeof createClient>,
  personCode: string,
  personName?: string,
): Promise<PersonMatch | null> {
  if (!personCode && !personName) return null;
  const { data, error } = await supabase.rpc("resolve_mips_person_alias", {
    _person_code: personCode || null,
    _person_name: personName || null,
  });
  if (error) return null;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown>) : (data as Record<string, unknown>);
  if (!row) return null;
  return {
    id: row.target_id,
    branch_id: row.branch_id,
    user_id: row.user_id,
    type: row.target_type,
  } as PersonMatch;
}



async function markAttendance(
  supabase: ReturnType<typeof createClient>,
  person: PersonMatch,
  personName: string,
  scanTime: string,
): Promise<string | null> {
  if (person.type === "member") {
    const { data } = await supabase.rpc("member_check_in", {
      _member_id: person.id,
      _branch_id: person.branch_id,
      _method: "biometric",
    });
    const result = data as { valid?: boolean; message?: string } | null;
    return result?.message ?? null;
  }

  if (!person.user_id) return "Staff profile missing login id; access logged only";

  const label = person.type === "trainer" ? "Trainer" : "Staff";
  const scanMs = new Date(scanTime).getTime();

  // Branch punch policy: minimum gap between two gate scans that may open
  // separate attendance rows. Repeat scans inside the window are access
  // events only (no second check-in, no second late alert).
  let minGapMin = 60;
  const { data: hr } = await supabase
    .from("hr_settings")
    .select("min_punch_gap_min")
    .eq("branch_id", person.branch_id)
    .maybeSingle();
  if ((hr as { min_punch_gap_min?: number } | null)?.min_punch_gap_min != null) {
    minGapMin = Number((hr as { min_punch_gap_min: number }).min_punch_gap_min);
  }

  // IST calendar day of the scan — attendance is a per-day concept here.
  const istDayStart = new Date(scanMs);
  istDayStart.setTime(scanMs + 5.5 * 3600_000);
  istDayStart.setUTCHours(0, 0, 0, 0);
  const dayStartUtc = new Date(istDayStart.getTime() - 5.5 * 3600_000).toISOString();
  const dayEndUtc = new Date(istDayStart.getTime() + 24 * 3600_000 - 5.5 * 3600_000).toISOString();

  // Night shifts cross midnight (e.g. 21:00 → 06:00). A small-hours scan is
  // the tail of yesterday's shift, not a brand new — and very late — arrival.
  const istHour = new Date(scanMs + 5.5 * 3600_000).getUTCHours();
  if (istHour < 6) {
    const { data: prevRows } = await supabase
      .from("staff_attendance")
      .select("id, check_in")
      .eq("user_id", person.user_id)
      .lt("check_in", dayStartUtc)
      .gte("check_in", new Date(scanMs - 12 * 3600_000).toISOString())
      .order("check_in", { ascending: false })
      .limit(1);
    const prev = (prevRows ?? [])[0] as { id: string } | undefined;
    if (prev) {
      await supabase.from("staff_attendance").update({ check_out: scanTime }).eq("id", prev.id);
      return `${label} ${personName} scan recorded (night shift continues)`;
    }
  }

  // Stale rows left open from earlier days must never block today's punch:
  // the unique "one open row per shift" index rejects the insert otherwise,
  // which is exactly why present staff were showing up Absent.
  await supabase
    .from("staff_attendance")
    .update({ check_out: dayStartUtc })
    .eq("user_id", person.user_id)
    .is("check_out", null)
    .lt("check_in", dayStartUtc);

  const { data: todays } = await supabase
    .from("staff_attendance")
    .select("id, check_in, check_out")
    .eq("user_id", person.user_id)
    .gte("check_in", dayStartUtc)
    .lt("check_in", dayEndUtc)
    .order("check_in", { ascending: true });

  const rows = (todays ?? []) as Array<{ id: string; check_in: string; check_out: string | null }>;

  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    const lastMs = new Date(last.check_in).getTime();
    if (Math.abs(scanMs - lastMs) < minGapMin * 60_000) {
      return `${label} ${personName} scan recorded (duplicate within ${minGapMin} min)`;
    }
    // No dedicated exit reader yet: a later scan on the same day is treated as
    // the latest seen time, not as a fresh (late) check-in.
    if (scanMs > lastMs) {
      await supabase.from("staff_attendance").update({ check_out: scanTime }).eq("id", last.id);
    }
    return `${label} ${personName} already checked in today`;
  }

  // check_in must be the real hardware scan time — never the import time, or
  // lateness gets measured against whenever the cron happened to run.
  const { error } = await supabase.from("staff_attendance").insert({
    user_id: person.user_id,
    branch_id: person.branch_id,
    check_in: scanTime,
    notes: "Imported from MIPS pass records",
  });
  if (error) return `Staff attendance error: ${error.message}`;
  return `${label} ${personName} checked in`;
}


async function authorize(req: Request, supabase: ReturnType<typeof createClient>, serviceKey: string): Promise<Response | null> {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") || "";
  const systemCall = req.headers.get("x-system-call") || "";
  if (apikey === serviceKey && systemCall === "automation-brain") return null;
  if (bearer === serviceKey) return null;
  if (!bearer) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: userRes } = await supabase.auth.getUser(bearer);
  const userId = userRes?.user?.id;
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: roles, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return jsonResponse({ error: "Unable to verify permissions" }, 403);
  const isAllowed = (roles ?? []).some((row) => ALLOWED_ROLES.has((row as { role: Role }).role));
  return isAllowed ? null : jsonResponse({ error: "Forbidden" }, 403);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const SUPA_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPA_URL || !SERVICE_KEY) return jsonResponse({ error: "Backend environment is not configured" }, 500);

  const supabase = createClient(SUPA_URL, SERVICE_KEY);
  const authError = await authorize(req, supabase, SERVICE_KEY);
  if (authError) return authError;

  try {
    const rawBody = await req.json().catch(() => ({})) as RequestBody;
    const branchId = typeof rawBody.branch_id === "string" && rawBody.branch_id.trim() ? rawBody.branch_id.trim() : undefined;
    const limit = Math.min(Math.max(Number(rawBody.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const dryRun = rawBody.dry_run === true;

    let connectionQuery = supabase
      .from("mips_connections")
      .select("branch_id, server_url, username, password")
      .eq("is_active", true)
      .limit(1);
    if (branchId) connectionQuery = connectionQuery.eq("branch_id", branchId);
    const { data: connection, error: connectionError } = await connectionQuery.maybeSingle();
    if (connectionError) throw connectionError;

    const fallbackUrl = Deno.env.get("MIPS_SERVER_URL") || "";
    const fallbackUser = Deno.env.get("MIPS_USERNAME") || "";
    const fallbackPass = Deno.env.get("MIPS_PASSWORD") || "";
    const resolvedConnection = (connection as MipsConnection | null) ?? (
      fallbackUrl && fallbackUser && fallbackPass
        ? { branch_id: branchId || "", server_url: fallbackUrl, username: fallbackUser, password: fallbackPass }
        : null
    );
    if (!resolvedConnection) return jsonResponse({ success: false, error: "No active MIPS connection configured", imported: 0, skipped: 0 }, 200);

    // The MIPS VPS reboots / restarts Tomcat. A brief outage is not a failed
    // automation run: hold off while the shared breaker is open and report a
    // healthy skip instead of a 500 that the Automation Brain logs as an error.
    const breakerBranch = resolvedConnection.branch_id || null;
    const breaker = await readBreaker(supabase, breakerBranch);
    if (isTripped(breaker)) {
      return jsonResponse({
        success: true,
        skipped_reason: "mips_breaker_open",
        breaker_open_until: breaker.open_until,
        last_error: breaker.last_error,
        fetched: 0,
        imported: 0,
        skipped: 0,
      });
    }

    let records: MipsPassRecord[];
    try {
      records = await fetchPassRecords(resolvedConnection, limit);
      await recordSuccess(supabase, breakerBranch);
    } catch (e) {
      if (e instanceof MipsTransportError) {
        const state = await recordTransportFailure(supabase, breakerBranch, e.message);
        console.warn(`[reconcile-mips-pass-records] MIPS unreachable: ${e.message}`);
        return jsonResponse({
          success: true,
          skipped_reason: "mips_unreachable",
          transport_error: e.message,
          breaker_open: state.open,
          breaker_open_until: state.open_until,
          fetched: 0,
          imported: 0,
          skipped: 0,
        });
      }
      throw e;
    }

    let imported = 0;
    let skipped = 0;
    let attendanceUpdated = 0;
    let unmatched = 0;
    const errors: string[] = [];
    const latestRecordAt = records.reduce<string | null>((latest, record) => {
      const iso = normalizeScanTime(record.createTime ?? record.time ?? record.timestamp ?? record.eventTime);
      return !latest || new Date(iso).getTime() > new Date(latest).getTime() ? iso : latest;
    }, null);

    // oldest first, so the first punch of a day opens the row and later ones
    // close it rather than the other way round
    records.sort((a, b) =>
      new Date(normalizeScanTime(a.createTime ?? a.time ?? a.timestamp ?? a.eventTime)).getTime() -
      new Date(normalizeScanTime(b.createTime ?? b.time ?? b.timestamp ?? b.eventTime)).getTime()
    );

    for (const record of records) {
      const recordKey = getRecordKey(record);
      const { data: existing, error: existingError } = await supabase
        .from("access_logs")
        .select("id")
        .eq("payload->>mips_record_id", recordKey)
        .eq("payload->>source", "mips_record_reconcile")
        .maybeSingle();
      if (existingError) {
        errors.push(`lookup ${recordKey}: ${existingError.message}`);
        continue;
      }
      if (existing?.id) {
        skipped++;
        continue;
      }

      const personNo = getString(record.personNo ?? record.personSn ?? record.personId);
      const personName = getString(record.personName ?? record.name) || "Unknown";
      const matchedPerson = personNo || personName
        ? await findPersonByCode(supabase, personNo, personName)
        : null;
      if (!matchedPerson) unmatched++;

      const scanTime = normalizeScanTime(record.createTime ?? record.time ?? record.timestamp ?? record.eventTime);

      const attendanceMessage = !dryRun && matchedPerson
        ? await markAttendance(supabase, matchedPerson, personName, scanTime).catch((error: Error) => `Attendance error: ${error.message}`)
        : null;
      if (
        attendanceMessage &&
        !attendanceMessage.toLowerCase().includes("error") &&
        !attendanceMessage.toLowerCase().includes("already") &&
        !attendanceMessage.toLowerCase().includes("duplicate")
      ) {
        attendanceUpdated++;
      }

      const result = matchedPerson ? mapResult(record, matchedPerson.type) : mapResult(record);
      const deviceSn = getString(record.deviceKey ?? record.deviceSn ?? record.deviceName) || "mips-server";
      const message = matchedPerson
        ? (attendanceMessage || `${personName} · ${personNo}`)
        : `Person ${personNo || "unknown"} (${personName}) imported from MIPS but not matched in CRM`;

      if (dryRun) {
        imported++;
        continue;
      }

      const { error: insertError } = await supabase.from("access_logs").insert({
        device_sn: deviceSn,
        branch_id: (matchedPerson?.branch_id ?? resolvedConnection.branch_id) || null,
        member_id: matchedPerson?.type === "member" ? matchedPerson.id : null,
        profile_id: matchedPerson?.user_id ?? null,
        event_type: mapEventType(record),
        result,
        message,
        captured_at: scanTime,
        payload: {
          ...record,
          source: "mips_record_reconcile",
          mips_record_id: recordKey,
          person_no: personNo,
          normalized_time: scanTime,
          attendance_message: attendanceMessage,
        },
      });

      if (insertError) {
        if (insertError.code === "23505") skipped++;
        else errors.push(`insert ${recordKey}: ${insertError.message}`);
      } else {
        imported++;
      }
    }

    console.log(`[reconcile-mips-pass-records] fetched=${records.length} imported=${imported} skipped=${skipped} unmatched=${unmatched} attendance=${attendanceUpdated}`);
    return jsonResponse({
      success: errors.length === 0,
      fetched: records.length,
      imported,
      skipped,
      unmatched,
      attendance_updated: attendanceUpdated,
      latest_record_at: latestRecordAt,
      branch_id: resolvedConnection.branch_id || branchId || null,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[reconcile-mips-pass-records] fatal:", message);
    return jsonResponse({ success: false, error: message, imported: 0, skipped: 0 }, 500);
  }
});