// mipsDispatch v1.0.0 — the ONLY way to push people to MIPS gates.
//
// WHY THIS EXISTS
// ---------------
// `POST /through/device/syncPerson` binds its body to a `TdxDevice` object on the
// RuoYi server. That object has NO `personId` field, so the `personId` we used to
// send was silently discarded and every call triggered an asynchronous FULL ROSTER
// download to the gate ("正在下载人员信息中！"). The server operation log proved it:
// ~12,300 full downloads to Gate 2 and ~11,500 to Gate 1, in bursts of 200+/minute.
// That is what kept the Android terminals rebuilding face templates and restarting,
// and why Gate 2 never finished a pass (121 photos vs Gate 1's 130 vs server 152).
//
// The real targeted API is `PUT /personInfo/person/persionIssue`:
//   { personType, personIds: [...], deviceIds: [...], regionCodes: [],
//     numType: "2" (2 = selected people, 1 = everyone),
//     deviceType: "1" (1 = selected devices, 2 = all),
//     authType: "1" (1 = issue, 2 = revoke) }
// Verified live: the operation log recorded personIds:[133], deviceIds:[24].
//
// Delivery truth per person/device lives in `/personInfo/authedLog/list`
// (pushStatus + failureMessage) — never infer it from a device photo counter.

export const MIPS_ISSUE_PATH = "/personInfo/person/persionIssue";
export const MIPS_FULL_SYNC_PATH = "/through/device/syncPerson";
export const MIPS_PUSH_LEDGER_PATH = "/personInfo/authedLog/list";

export interface DispatchOutcome {
  ok: boolean;
  httpStatus: number;
  code: number | null;
  message: string | null;
  raw: unknown;
  latencyMs: number;
  throttled?: boolean;
}

export type PushStatus = "queued" | "pushing" | "delivered" | "unknown";

export interface PushLedgerRow {
  personId: number;
  personSn: string | null;
  personName: string | null;
  deviceId: number;
  deviceKey: string | null;
  deviceName: string | null;
  pushStatus: PushStatus;
  rawStatus: number | null;
  failureMessage: string | null;
  createTime: string | null;
}

function classifyPushStatus(raw: unknown): PushStatus {
  switch (Number(raw)) {
    case 0:
      return "queued";
    case 1:
      return "pushing";
    case 2:
      return "delivered";
    default:
      return "unknown";
  }
}

function accepted(httpOk: boolean, code: number | null): boolean {
  return httpOk && (code === 200 || code === 0);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const TRANSIENT_HINTS = [
  "请选择在线设备", // "please select an online device"
  "正在下发或解除中", // "issue/revoke already running, wait"
  "Personnel information is being issued or released",
];

function isTransient(message: string | null, httpStatus: number): boolean {
  if (httpStatus >= 500) return true;
  if (!message) return false;
  return TRANSIENT_HINTS.some((h) => message.includes(h));
}

export interface DispatchPersonArgs {
  baseUrl: string;
  headers: Record<string, string>;
  /** MIPS numeric personId. */
  personId: number;
  /** MIPS numeric device ids (gates). One call per gate keeps delivery truth separate. */
  deviceIds: number[];
  /** 1 = issue the person, 2 = revoke the person from the gates. */
  authType?: 1 | 2;
  /** MIPS personType: 1 = personnel (always 1 for CRM people). */
  personType?: number;
  attempts?: number;
  timeoutMs?: number;
}

/**
 * Targeted push: exactly these people to exactly these gates.
 * Never triggers a full roster download.
 */
export async function dispatchPerson({
  baseUrl,
  headers,
  personId,
  deviceIds,
  authType = 1,
  personType = 1,
  attempts = 3,
  timeoutMs = 10_000,
}: DispatchPersonArgs): Promise<DispatchOutcome> {
  const started = Date.now();
  let last: DispatchOutcome = {
    ok: false,
    httpStatus: 0,
    code: null,
    message: "not attempted",
    raw: null,
    latencyMs: 0,
  };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${baseUrl}${MIPS_ISSUE_PATH}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          personType,
          personIds: [personId],
          deviceIds,
          regionCodes: [],
          numType: "2",
          deviceType: "1",
          authType: String(authType),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await readJson(res) as { code?: number; msg?: string; message?: string };
      const code = typeof body?.code === "number" ? body.code : null;
      const message = body?.msg ?? body?.message ?? (res.ok ? null : `HTTP ${res.status}`);
      last = {
        ok: accepted(res.ok, code),
        httpStatus: res.status,
        code,
        message,
        raw: body,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      last = { ok: false, httpStatus: 0, code: null, message, raw: { error: message }, latencyMs: Date.now() - started };
    }

    if (last.ok) break;
    if (attempt < attempts && isTransient(last.message, last.httpStatus)) {
      await new Promise((r) => setTimeout(r, 700 * attempt));
    } else {
      break;
    }
  }

  return last;
}

/** Revoke a person from the given gates (targeted, no roster download). */
export function revokePerson(args: Omit<DispatchPersonArgs, "authType">): Promise<DispatchOutcome> {
  return dispatchPerson({ ...args, authType: 2 });
}

/**
 * FULL ROSTER DOWNLOAD — makes the terminal re-pull and rebuild every face
 * template. Manual/maintenance only, and only behind `mips_claim_full_sync`.
 */
export async function dispatchFullRoster(
  baseUrl: string,
  headers: Record<string, string>,
  deviceId: number,
  timeoutMs = 10_000,
): Promise<DispatchOutcome> {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${MIPS_FULL_SYNC_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ deviceIds: [deviceId], deviceNumType: "4" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await readJson(res) as { code?: number; msg?: string };
    const code = typeof body?.code === "number" ? body.code : null;
    return {
      ok: accepted(res.ok, code),
      httpStatus: res.status,
      code,
      message: body?.msg ?? null,
      raw: body,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, httpStatus: 0, code: null, message, raw: { error: message }, latencyMs: Date.now() - started };
  }
}

/**
 * Per-person / per-device delivery truth straight from the MIPS push ledger.
 * This replaces photo-counter guessing entirely.
 */
export async function fetchPushLedger(
  baseUrl: string,
  headers: Record<string, string>,
  opts: { pageSize?: number; pages?: number } = {},
): Promise<PushLedgerRow[]> {
  const pageSize = opts.pageSize ?? 500;
  const pages = opts.pages ?? 2;
  const out: PushLedgerRow[] = [];

  for (let page = 1; page <= pages; page++) {
    const res = await fetch(
      `${baseUrl}${MIPS_PUSH_LEDGER_PATH}?pageNum=${page}&pageSize=${pageSize}`,
      { method: "GET", headers, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) break;
    const body = await readJson(res) as { rows?: Array<Record<string, unknown>> };
    const rows = body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      out.push({
        personId: Number(r.personId),
        personSn: (r.personSn as string) ?? null,
        personName: (r.personName as string) ?? null,
        deviceId: Number(r.deviceId),
        deviceKey: (r.deviceKey as string) ?? null,
        deviceName: (r.deviceName as string) ?? null,
        pushStatus: classifyPushStatus(r.pushStatus),
        rawStatus: r.pushStatus === undefined || r.pushStatus === null ? null : Number(r.pushStatus),
        failureMessage: (r.failureMessage as string) ?? null,
        createTime: (r.createTime as string) ?? null,
      });
    }
    if (rows.length < pageSize) break;
  }

  return out;
}

/** Newest ledger row per (personSn, deviceId) — the current delivery state. */
export function latestLedgerState(rows: PushLedgerRow[]): Map<string, PushLedgerRow> {
  const out = new Map<string, PushLedgerRow>();
  for (const r of rows) {
    const key = `${r.personSn ?? r.personId}::${r.deviceId}`;
    const existing = out.get(key);
    if (!existing || (r.createTime ?? "") > (existing.createTime ?? "")) out.set(key, r);
  }
  return out;
}

interface SupabaseLike {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}

/**
 * One push in flight per gate, minimum spacing, hard daily cap.
 * Returns false when the caller must skip this gate for now.
 */
export async function claimDispatchSlot(
  supabase: SupabaseLike,
  mipsDeviceId: number,
  branchId?: string | null,
  opts: { minGapSeconds?: number; dailyCap?: number; inFlightSeconds?: number } = {},
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("mips_claim_dispatch_slot", {
      p_mips_device_id: mipsDeviceId,
      p_branch_id: branchId ?? null,
      p_min_gap_seconds: opts.minGapSeconds ?? 5,
      p_daily_cap: opts.dailyCap ?? 800,
      p_in_flight_seconds: opts.inFlightSeconds ?? 20,
    });
    if (error) return true; // never block a real push on a throttle bookkeeping failure
    return data === true;
  } catch {
    return true;
  }
}

/**
 * Same throttle, but WAITS for the gate instead of dropping the push.
 * A dropped door-access change means an expired member still walks in, or a
 * member who just paid stays locked out — so callers must never silently skip.
 * Returns false only after the whole budget is exhausted.
 */
export async function waitForDispatchSlot(
  supabase: SupabaseLike,
  mipsDeviceId: number,
  branchId?: string | null,
  opts: {
    minGapSeconds?: number;
    dailyCap?: number;
    inFlightSeconds?: number;
    attempts?: number;
    waitMs?: number;
  } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 8;
  const waitMs = opts.waitMs ?? 1500;
  for (let i = 0; i < attempts; i++) {
    const got = await claimDispatchSlot(supabase, mipsDeviceId, branchId, opts);
    if (got) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return false;
}

export async function releaseDispatchSlot(supabase: SupabaseLike, mipsDeviceId: number): Promise<void> {
  try {
    await supabase.rpc("mips_release_dispatch_slot", { p_mips_device_id: mipsDeviceId });
  } catch { /* bookkeeping only */ }
}

/** At most one full roster download per gate per `minHours` (unless forced by a human). */
export async function claimFullSyncSlot(
  supabase: SupabaseLike,
  mipsDeviceId: number,
  opts: { minHours?: number; force?: boolean } = {},
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("mips_claim_full_sync", {
      p_mips_device_id: mipsDeviceId,
      p_min_hours: opts.minHours ?? 24,
      p_force: opts.force ?? false,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
