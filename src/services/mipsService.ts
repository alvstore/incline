import { supabase } from "@/integrations/supabase/client";

// RuoYi-Vue v3 device shape from /through/device/list
export interface MIPSDevice {
  id: number;
  deviceKey: string;
  deviceName: string;
  name: string;
  ip: string;
  personCount: number;
  faceCount: number;
  onlineFlag: number;
  status: number;
  lastActiveTime: string;
  fpCount?: number;
  devicePassType?: string;
  isOnline?: number;
}

// Actual MIPS person shape (from /personInfo/person/list)
export interface MIPSPerson {
  personId: number;
  personSn: string;
  personType: number;
  deptId: number;
  deptName: string;
  name: string;
  mobile: string;
  email: string;
  gender: string;
  photoUri: string | null;
  havePhoto: string | null;
  validTimeBegin: string | null;
  validTimeEnd: string | null;
  attendance: string;
  holiday: string;
  status: string;
  birthday: string | null;
  createTime: string;
  updateTime: string | null;
}

/** Canonical identity used by CRM and MIPS, independent of punctuation/case. */
export function normalizeMIPSPersonSn(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    : "";
}

/** MIPS installations return photo flags as booleans, numbers, strings, or URLs. */
export function mipsPersonHasPhoto(person: Partial<MIPSPerson> & Record<string, unknown>): boolean {
  const uriCandidates = [person.photoUri, person.photoUrl, person.photo, person.facePhoto, person.faceUrl];
  if (uriCandidates.some((value) => typeof value === "string" && value.trim().length > 0)) return true;

  const flagCandidates = [person.havePhoto, person.photoFlag, person.faceFlag];
  return flagCandidates.some((value) => {
    if (value === true || value === 1) return true;
    if (typeof value !== "string") return false;
    return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
  }) || (typeof person.faceCount === "number" && person.faceCount > 0);
}

export interface MIPSPassRecord {
  id: number;
  personNo: string;
  personName: string;
  passType: string;
  passPersonType: string;
  temperature: string;
  temperatureState: number;
  maskState: number;
  imgUri: string;
  deviceName: string;
  createTime: string;
}

// Keep backward compat alias
export type MIPSEmployee = MIPSPerson;

export type MIPSFailureReason = "auth_failed" | "unreachable" | "timeout" | "upstream_error";

export interface MIPSConnectionConfig {
  branch_id: string;
  server_url: string;
  username: string;
  is_active: boolean;
  has_password: boolean;
}

export interface MIPSCredentialsDraft {
  server_url: string;
  username: string;
  password?: string;
}

interface MIPSProxyResponse {
  success: boolean;
  status: number;
  reason?: MIPSFailureReason;
  data: {
    code?: number;
    msg?: string;
    message?: string;
    data?: unknown;
    rows?: unknown[];
    total?: number;
    [key: string]: unknown;
  };
  error?: string;
}

async function callMIPSProxy(
  endpoint: string,
  method = "GET",
  params?: Record<string, string>,
  data?: Record<string, unknown>,
  branchId?: string
): Promise<MIPSProxyResponse> {
  const { data: result, error } = await supabase.functions.invoke("mips-proxy", {
    body: { endpoint, method, params, data, branch_id: branchId },
  });
  if (error) throw new Error(error.message || "MIPS proxy call failed");
  return result as MIPSProxyResponse;
}

// Test connection by fetching device list
export async function testMIPSConnection(
  branchId?: string
): Promise<{ success: boolean; message: string; reason?: MIPSFailureReason; raw?: unknown }> {
  try {
    const result = await callMIPSProxy("/through/device/list", "GET", undefined, undefined, branchId);
    const isOk = result.success && (result.data?.code === 200 || result.data?.code === 0);
    return {
      success: isOk,
      reason: isOk ? undefined : (result.reason ?? "upstream_error"),
      message: isOk
        ? "Connected to MIPS server successfully"
        : result.error || `Connection issue: ${result.data?.msg || JSON.stringify(result.data)}`,
      raw: result.data,
    };
  } catch (e) {
    return { success: false, reason: "upstream_error", message: e instanceof Error ? e.message : String(e) };
  }
}

async function manageMIPSConnection<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mips-proxy", { body });
  if (error) throw new Error(error.message || "MIPS connection request failed");
  const response = data as { success?: boolean; error?: string; message?: string };
  if (!response?.success) throw new Error(response?.error || response?.message || "MIPS connection request failed");
  return data as T;
}

export async function getMIPSConnection(branchId: string): Promise<MIPSConnectionConfig | null> {
  const result = await manageMIPSConnection<{ success: true; connection: MIPSConnectionConfig | null }>({ operation: "get_connection", branch_id: branchId });
  return result.connection;
}

export async function testMIPSCredentials(branchId: string, credentials: MIPSCredentialsDraft) {
  return manageMIPSConnection<{ success: true; message: string; device_count: number }>({ operation: "test_connection", branch_id: branchId, credentials });
}

export async function saveAndTestMIPSConnection(branchId: string, credentials: MIPSCredentialsDraft) {
  return manageMIPSConnection<{ success: true; message: string; device_count: number }>({ operation: "save_and_test", branch_id: branchId, credentials });
}


// Fetch devices from MIPS
export async function fetchMIPSDevices(branchId?: string): Promise<MIPSDevice[]> {
  const result = await callMIPSProxy("/through/device/list", "GET", undefined, undefined, branchId);
  if (!result.success && result.data?.code !== 200 && result.data?.code !== 0) {
    throw new Error(result.data?.msg || "Failed to fetch MIPS devices");
  }
  const rows = result.data?.rows || result.data?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((d: any) => ({
    id: d.id || d.deviceId,
    deviceKey: d.deviceKey || d.sn || d.serialNumber || "",
    deviceName: d.deviceName || d.name || "",
    name: d.deviceName || d.name || d.deviceKey || "",
    ip: d.ip || d.ipAddress || "",
    personCount: d.personCount ?? d.personNum ?? 0,
    faceCount: d.photoCount ?? d.faceCount ?? d.faceNum ?? 0,
    onlineFlag: d.onlineFlag ?? (d.status === "0" ? 0 : d.status === "1" ? 1 : Number(d.status) || 0),
    status: d.onlineFlag ?? (d.status === "0" ? 0 : d.status === "1" ? 1 : Number(d.status) || 0),
    lastActiveTime: d.lastActiveTime || d.updateTime || "",
  }));
}

// Fetch pass records from MIPS
export async function fetchMIPSPassRecords(
  page = 1,
  size = 20,
  branchId?: string,
  filters?: { beginTime?: string; endTime?: string; personName?: string; deviceId?: number | string }
): Promise<{
  records: MIPSPassRecord[];
  total: number;
}> {
  const params: Record<string, string> = {
    pageNum: String(page),
    pageSize: String(size),
  };
  if (filters?.beginTime) params.beginTime = filters.beginTime;
  if (filters?.endTime) params.endTime = filters.endTime;
  if (filters?.personName) params.personName = filters.personName;
  if (filters?.deviceId !== undefined && filters?.deviceId !== null) params.deviceId = String(filters.deviceId);
  const result = await callMIPSProxy("/through/record/list", "GET", params, undefined, branchId);
  const rows = result.data?.rows || result.data?.data;
  const total = (result.data?.total as number) || 0;
  return { records: Array.isArray(rows) ? rows as MIPSPassRecord[] : [], total };
}

// Convenience helper — latest N pass records across all devices for a branch.
export async function fetchRecentMIPSPassRecords(branchId?: string, limit = 30): Promise<MIPSPassRecord[]> {
  const { records } = await fetchMIPSPassRecords(1, limit, branchId);
  return records;
}

// Fetch persons from MIPS
export async function fetchMIPSEmployees(page = 1, size = 50, branchId?: string): Promise<{
  employees: MIPSPerson[];
  total: number;
}> {
  const result = await callMIPSProxy("/personInfo/person/list", "GET", {
    pageNum: String(page),
    pageSize: String(size),
  }, undefined, branchId);
  if (!result.success || (result.data?.code !== undefined && result.data.code !== 200 && result.data.code !== 0)) {
    throw new Error(result.error || result.data?.msg || result.data?.message || "Failed to fetch the MIPS person list");
  }
  const rows = result.data?.rows || result.data?.data;
  const total = (result.data?.total as number) || 0;
  return { employees: Array.isArray(rows) ? rows as MIPSPerson[] : [], total };
}

// Sync a person to MIPS
// deployToDevices=false uploads the person to the MIPS server only; the
// mips-reconcile-devices cron (every 15 min) will fan them out. Use for bulk
// imports where per-device push would be too chatty.
export async function syncPersonToMIPS(
  personType: "member" | "employee" | "trainer",
  personId: string,
  branchId?: string,
  deployToDevices: boolean = true
): Promise<{ success: boolean; mips_person_id?: number; error?: string; action?: string; photo_result?: any; mips_response?: unknown }> {
  const { data, error } = await supabase.functions.invoke("sync-to-mips", {
    body: { person_type: personType, person_id: personId, branch_id: branchId, deploy_to_devices: deployToDevices },
  });
  if (error) throw new Error(error.message || "Sync failed");
  return data;
}


// Remote open door
export async function remoteOpenDoor(deviceId: number, branchId?: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await callMIPSProxy(`/through/device/openDoor/${deviceId}`, "GET", undefined, undefined, branchId);
    const isOk = result.success && (result.data?.code === 200 || result.data?.code === 0);
    return {
      success: isOk,
      message: isOk ? "Door opened successfully" : (result.data?.msg || "Failed to open door"),
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// Restart device
export async function restartDevice(deviceId: number, branchId?: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await callMIPSProxy(`/through/device/reboot/${deviceId}`, "GET", undefined, undefined, branchId);
    const isOk = result.success && (result.data?.code === 200 || result.data?.code === 0);
    return {
      success: isOk,
      message: isOk ? "Device restarting..." : (result.data?.msg || "Failed to restart device"),
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Dispatch ONE person to ONE gate.
 *
 * Uses the targeted `persionIssue` API. The old `/through/device/syncPerson`
 * call dropped the personId server-side and made the gate re-download the
 * entire roster (which is what kept the terminals rebuilding templates and
 * restarting) — never call it from here.
 */
export async function dispatchToDevice(
  personMipsId: string | number,
  targetDeviceId = 13
): Promise<{ success: boolean; message: string }> {
  try {
    const numId = typeof personMipsId === "string" ? parseInt(personMipsId, 10) : personMipsId;
    if (isNaN(numId)) return { success: false, message: "Invalid MIPS person ID" };

    const result = await callMIPSProxy("/personInfo/person/persionIssue", "PUT", undefined, {
      personType: 1,
      personIds: [numId],
      deviceIds: [targetDeviceId],
      regionCodes: [],
      numType: "2",
      deviceType: "1",
      authType: "1",
    });
    const isOk = result.success && (result.data?.code === 200 || result.data?.code === 0);
    return {
      success: isOk,
      message: isOk ? "Person dispatched to device" : (result.data?.msg || "Failed to dispatch"),
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}


// Fetch online device IDs
export async function fetchOnlineDeviceIds(): Promise<number[]> {
  try {
    const devices = await fetchMIPSDevices();
    return devices
      .filter((d) => d.onlineFlag === 1 || d.status === 1)
      .map((d) => d.id)
      .filter((id) => !isNaN(id));
  } catch {
    return [];
  }
}

export interface DoorOpenAttempt {
  device_id: number | null;
  device_name: string;
  success: boolean;
  message: string;
  latency_ms: number;
}

// Remote open door by branch — fires openDoor in PARALLEL to every device
// whose door_role matches (default 'entry'). Returns per-device outcome so
// the UI can render "Entry-01 opened in 1.2s, Entry-02 timeout".
export async function remoteOpenDoorByBranch(
  branchId: string,
  opts: { role?: 'entry' | 'exit' | 'both' } = {}
): Promise<{ success: boolean; message: string; attempts: DoorOpenAttempt[] }> {
  const role = opts.role || 'entry';
  try {
    const { data: devices } = await supabase
      .from("access_devices")
      .select("mips_device_id, device_name, door_role, is_online")
      .eq("branch_id", branchId)
      .eq("is_online", true);

    const roleMatches = (devices || []).filter(
      (d: any) => d.mips_device_id && (d.door_role === role || d.door_role === 'both' || !d.door_role)
    );

    let targets: Array<{ id: number; name: string }> = roleMatches.map((d: any) => ({
      id: Number(d.mips_device_id),
      name: d.device_name || `Device ${d.mips_device_id}`,
    }));

    // Fallback: no DB mapping → query MIPS live list, open all online ones.
    if (targets.length === 0) {
      const mipsDevices = await fetchMIPSDevices(branchId);
      targets = mipsDevices
        .filter(d => d.onlineFlag === 1 || d.status === 1)
        .map(d => ({ id: d.id, name: d.name || d.deviceKey || `Device ${d.id}` }));
    }

    if (targets.length === 0) {
      return { success: false, message: "No online devices found", attempts: [] };
    }

    const attempts: DoorOpenAttempt[] = await Promise.all(
      targets.map(async (t) => {
        const started = Date.now();
        const r = await remoteOpenDoor(t.id, branchId);
        return {
          device_id: t.id,
          device_name: t.name,
          success: r.success,
          message: r.message,
          latency_ms: Date.now() - started,
        };
      })
    );

    const anyOk = attempts.some(a => a.success);
    const summary = anyOk
      ? `Opened ${attempts.filter(a => a.success).length}/${attempts.length} door(s)`
      : `All ${attempts.length} door(s) failed`;
    return { success: anyOk, message: summary, attempts };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
      attempts: [],
    };
  }
}


// Assign device permission for a synced person
export async function assignDevicePermission(
  personMipsId: string | number,
  deviceIds: number[]
): Promise<{ success: boolean; message: string }> {
  try {
    const numId = typeof personMipsId === "string" ? parseInt(personMipsId, 10) : personMipsId;
    if (isNaN(numId)) return { success: false, message: "Invalid MIPS person ID" };

    const result = await callMIPSProxy("/through/device/syncPerson", "POST", undefined, {
      personId: numId,
      deviceIds,
      deviceNumType: "4",
    });
    const isOk = result.success && (result.data?.code === 200 || result.data?.code === 0);
    return {
      success: isOk,
      message: isOk ? "Permission assigned successfully" : (result.data?.msg || "Failed to assign permission"),
    };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// Fetch all persons from MIPS (for bulk verification)
export async function fetchAllMIPSPersons(pageSize = 200, branchId?: string): Promise<MIPSPerson[]> {
  const all: MIPSPerson[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const { employees, total } = await fetchMIPSEmployees(page, pageSize, branchId);
    all.push(...employees);
    hasMore = all.length < total;
    page++;
    if (page > 10) break;
  }
  return all;
}

// Verify a single person exists on MIPS by personSn (hyphen-stripped)
export async function verifyPersonOnMIPS(personNo: string, branchId?: string): Promise<{
  exists: boolean;
  hasPhoto: boolean;
  mipsId: number | null;
  personData: MIPSPerson | null;
  validTimeBegin: string | null;
  validTimeEnd: string | null;
}> {
  const stripped = normalizeMIPSPersonSn(personNo);
  const result = await callMIPSProxy("/personInfo/person/list", "GET", {
    personSn: stripped,
    pageNum: "1",
    pageSize: "10",
  }, undefined, branchId);

  if (!result.success || (result.data?.code !== undefined && result.data.code !== 200 && result.data.code !== 0)) {
    throw new Error(result.error || result.data?.msg || result.data?.message || "Failed to verify person on MIPS");
  }

  const rows = result.data?.rows || result.data?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { exists: false, hasPhoto: false, mipsId: null, personData: null, validTimeBegin: null, validTimeEnd: null };
  }

  const person = rows.find((r: MIPSPerson) => normalizeMIPSPersonSn(r.personSn) === stripped);
  if (!person) {
    return { exists: false, hasPhoto: false, mipsId: null, personData: null, validTimeBegin: null, validTimeEnd: null };
  }
  return {
    exists: true,
    hasPhoto: mipsPersonHasPhoto(person as MIPSPerson & Record<string, unknown>),
    mipsId: person.personId || null,
    personData: person as MIPSPerson,
    validTimeBegin: person.validTimeBegin || null,
    validTimeEnd: person.validTimeEnd || null,
  };
}

// Compare CRM synced count vs MIPS person count
export async function compareCRMvsMIPS(crmSyncedCount: number): Promise<{
  crmSynced: number;
  mipsTotal: number;
  match: boolean;
}> {
  const result = await callMIPSProxy("/personInfo/person/list", "GET", {
    pageNum: "1",
    pageSize: "1",
  });
  const mipsTotal = (result.data?.total as number) || 0;
  return { crmSynced: crmSyncedCount, mipsTotal, match: crmSyncedCount === mipsTotal };
}

// Manual sync test — syncs one person and verifies in MIPS roster
export async function manualSyncTest(
  personType: "member" | "employee",
  personId: string,
  personNo: string,
  branchId?: string
): Promise<{ syncResult: any; verifyResult: any; verified: boolean }> {
  const syncResult = await syncPersonToMIPS(personType, personId, branchId);

  let verified = false;
  let verifyResult: any = null;
  try {
    const verification = await verifyPersonOnMIPS(personNo);
    verified = verification.exists;
    verifyResult = verification.exists
      ? { personId: verification.mipsId, hasPhoto: verification.hasPhoto, validTimeBegin: verification.validTimeBegin, validTimeEnd: verification.validTimeEnd }
      : { message: `Person ${personNo} not found in MIPS roster after sync` };
  } catch (e) {
    verifyResult = { error: e instanceof Error ? e.message : String(e) };
  }

  return { syncResult, verifyResult, verified };
}
