// v2.0.0 — Unified MIPS hardware-access function (members + staff).
// Replaces: revoke-mips-access + check-expired-access.
// Body: { action: "revoke" | "restore" | "sweep_expired" | "revoke_staff" | "restore_staff",
//         member_id?, person_type?: "employee"|"trainer", person_id?, reason?, branch_id? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REVOKED_DATE = "2000-01-01 00:00:00";

let cachedToken: string | null = null;
let tokenExpiry = 0;

function getBaseUrl(overrideUrl?: string): string {
  return (overrideUrl || Deno.env.get("MIPS_SERVER_URL")!).replace(/\/+$/, "");
}

async function getRuoYiToken(baseUrl?: string, username?: string, password?: string): Promise<string> {
  const url = baseUrl || getBaseUrl();
  const user = username || Deno.env.get("MIPS_USERNAME")!;
  const pass = password || Deno.env.get("MIPS_PASSWORD")!;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`${url}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const json = await res.json();
  if (json.code !== 200 && json.code !== 0) throw new Error(`Login failed: ${json.msg}`);
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
  const res = await fetch(`${baseUrl}/personInfo/person/list?personSn=${personSn}&pageNum=1&pageSize=5`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const json = await res.json();
  const rows = json?.rows || json?.data;
  if (!Array.isArray(rows)) return null;
  return rows.find((r: any) => r.personSn === personSn) || null;
}

async function dispatchToDevices(baseUrl: string, token: string, personId: number, supabase: any, branchId?: string) {
  let deviceIds: number[] = [];
  try {
    let query = supabase.from("access_devices").select("mips_device_id").eq("is_online", true);
    if (branchId) query = query.eq("branch_id", branchId);
    const { data: devices } = await query;
    if (devices?.length) {
      deviceIds = devices.map((d: any) => d.mips_device_id).filter((id: any) => id && !isNaN(Number(id)));
    }
  } catch {}

  if (deviceIds.length === 0) {
    try {
      const res = await fetch(`${baseUrl}/through/device/list`, { method: "GET", headers: authHeaders(token) });
      const json = await res.json();
      const rows = json?.rows || json?.data;
      if (Array.isArray(rows)) {
        deviceIds = rows.filter((d: any) => d.onlineFlag === 1 || d.status === 1).map((d: any) => d.id).filter((id: any) => !isNaN(Number(id)));
      }
    } catch {}
  }

  if (deviceIds.length === 0) return;

  await fetch(`${baseUrl}/through/device/syncPerson`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ personId, deviceIds, deviceNumType: "4" }),
  });
}

function formatDate(dateStr: string | null, fallback: string): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return fallback;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ActionResult = {
  success: boolean;
  action: "revoke" | "restore";
  error?: string;
  message?: string;
  new_valid_time_end?: string;
  mips_person_id?: number;
};

// Core per-member revoke/restore. Used directly by action=revoke/restore
// and looped over by action=sweep_expired.
async function applyMemberAction(
  supabase: any,
  member_id: string,
  action: "revoke" | "restore",
  reason: string | undefined,
  branch_id_override: string | undefined,
): Promise<ActionResult> {
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, member_code, mips_person_id, mips_person_sn, branch_id, biometric_photo_url")
    .eq("id", member_id)
    .maybeSingle();

  if (memberError || !member) {
    return { success: false, action, error: "Member not found" };
  }

  const effectiveBranchId = branch_id_override || member.branch_id;
  const personSn = member.mips_person_sn || member.member_code?.replace(/-/g, "");

  if (!personSn) {
    return { success: false, action, error: "Member has no MIPS sync identifier" };
  }

  // Branch-specific MIPS connection if any
  let mipsBaseUrl: string | undefined;
  let mipsUsername: string | undefined;
  let mipsPassword: string | undefined;
  if (effectiveBranchId) {
    const { data: conn } = await supabase
      .from("mips_connections")
      .select("server_url, username, password")
      .eq("branch_id", effectiveBranchId)
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

  const existing = await lookupPerson(baseUrl, token, personSn);
  if (!existing) {
    console.log(`Person ${personSn} not found in MIPS — nothing to ${action}`);
    await supabase
      .from("members")
      .update({ hardware_access_status: action === "revoke" ? "revoked" : "none" })
      .eq("id", member_id);
    return { success: true, action, message: "Person not found in MIPS, status updated locally" };
  }

  let newValidTimeEnd = REVOKED_DATE;
  if (action === "restore") {
    const { data: membership } = await supabase
      .from("memberships")
      .select("start_date, end_date")
      .eq("member_id", member_id)
      .eq("status", "active")
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membership) {
      newValidTimeEnd = formatDate(membership.end_date + "T23:59:59", REVOKED_DATE);
    } else {
      console.warn(`No active membership found for member ${member_id}, cannot restore access`);
      return {
        success: false,
        action,
        error: "No active membership found. Cannot restore hardware access without a valid membership.",
      };
    }
  }

  const updatedPerson = { ...existing, validTimeEnd: newValidTimeEnd };
  console.log(`${action} access for ${personSn}: validTimeEnd → ${newValidTimeEnd}`);

  const putRes = await fetch(`${baseUrl}/personInfo/person`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(updatedPerson),
  });
  const putJson = await putRes.json();
  const putSuccess = putJson.code === 200 || putJson.code === 0;

  if (!putSuccess) {
    console.error(`MIPS PUT failed: ${JSON.stringify(putJson)}`);
    return { success: false, action, error: putJson.msg || "MIPS update failed" };
  }

  try {
    await dispatchToDevices(baseUrl, token, existing.personId, supabase, effectiveBranchId);
    console.log(`Dispatched ${action} to devices for personId=${existing.personId}`);
  } catch (e) {
    console.warn("Device dispatch failed (non-fatal):", e);
  }

  const newStatus = action === "revoke" ? "revoked" : "active";
  await supabase.from("members").update({ hardware_access_status: newStatus }).eq("id", member_id);

  await supabase.from("access_logs").insert({
    device_sn: "CRM-SYSTEM",
    event_type: `hardware_${action}`,
    result: action === "revoke" ? "member_denied" : "member",
    message: `Hardware access ${action}d: ${reason || action}. validTimeEnd=${newValidTimeEnd}`,
    member_id: member_id,
    branch_id: effectiveBranchId,
  });

  return {
    success: true,
    action,
    new_valid_time_end: newValidTimeEnd,
    mips_person_id: existing.personId,
    message: `Hardware access ${action}d successfully`,
  };
}

async function sweepExpired(supabase: any) {
  const today = new Date().toISOString().split("T")[0];
  const revoked: string[] = [];
  const errors: string[] = [];

  const safeRevoke = async (m: any, reason: string) => {
    try {
      const result = await applyMemberAction(supabase, m.id, "revoke", reason, m.branch_id);
      if (result.success) {
        revoked.push(m.member_code || m.id);
      } else {
        errors.push(`${m.member_code || m.id}: ${result.error}`);
      }
    } catch (e) {
      errors.push(`${m.member_code || m.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 1. Active hardware but no active membership
  const { data: activeHardwareMembers, error: queryError } = await supabase
    .from("members")
    .select("id, member_code, mips_person_sn, mips_person_id, branch_id")
    .eq("hardware_access_status", "active")
    .not("mips_person_sn", "is", null);
  if (queryError) throw queryError;

  for (const member of activeHardwareMembers || []) {
    const { data: activeMembership } = await supabase
      .from("memberships")
      .select("id, status, end_date")
      .eq("member_id", member.id)
      .eq("status", "active")
      .gte("end_date", today)
      .limit(1)
      .maybeSingle();
    if (!activeMembership) {
      await safeRevoke(member, "Auto-revoked: membership expired or inactive");
    }
  }

  // 2. Frozen memberships with active hardware
  const { data: frozenMembers } = await supabase
    .from("memberships")
    .select("member_id, members!inner(id, member_code, hardware_access_status, mips_person_sn, branch_id)")
    .eq("status", "frozen")
    .eq("members.hardware_access_status", "active");
  for (const ms of frozenMembers || []) {
    const m = (ms as any).members;
    if (!m?.mips_person_sn) continue;
    if (revoked.includes(m.member_code || m.id)) continue;
    await safeRevoke(m, "Auto-revoked: membership frozen");
  }

  // 3. Overdue invoices
  const { data: overdueInvoices } = await supabase
    .from("invoices")
    .select("member_id, members!inner(id, member_code, hardware_access_status, mips_person_sn, branch_id)")
    .in("status", ["overdue"])
    .eq("members.hardware_access_status", "active");
  for (const inv of overdueInvoices || []) {
    const m = (inv as any).members;
    if (!m?.mips_person_sn) continue;
    if (revoked.includes(m.member_code || m.id)) continue;
    await safeRevoke(m, "Auto-revoked: overdue invoice");
  }

  return { revoked, errors };
}

const PERMANENT_END = "2099-12-31 23:59:59";

// Staff (employee/trainer) revoke/restore. Same MIPS API as members; only
// differences are (a) source table and (b) restore goes back to PERMANENT_END
// since staff don't have membership end_dates.
async function applyStaffAction(
  supabase: any,
  person_type: "employee" | "trainer",
  person_id: string,
  action: "revoke_staff" | "restore_staff",
  reason: string | undefined,
  branch_id_override: string | undefined,
): Promise<ActionResult & { person_type?: string }> {
  const tableName = person_type === "employee" ? "employees" : "trainers";
  const { data: row, error } = await supabase
    .from(tableName)
    .select("id, branch_id, mips_person_sn, mips_person_id, user_id")
    .eq("id", person_id)
    .maybeSingle();

  if (error || !row) {
    return { success: false, action: action === "revoke_staff" ? "revoke" : "restore", error: `${person_type} not found` };
  }

  const personSn = row.mips_person_sn;
  if (!personSn) {
    // Nothing to revoke at hardware level — mark locally and succeed.
    await supabase
      .from(tableName)
      .update({ mips_sync_status: action === "revoke_staff" ? "revoked" : "pending" })
      .eq("id", person_id);
    return {
      success: true,
      action: action === "revoke_staff" ? "revoke" : "restore",
      message: "No MIPS identifier; marked locally only",
    };
  }

  const effectiveBranchId = branch_id_override || row.branch_id;

  let mipsBaseUrl: string | undefined;
  let mipsUsername: string | undefined;
  let mipsPassword: string | undefined;
  if (effectiveBranchId) {
    const { data: conn } = await supabase
      .from("mips_connections")
      .select("server_url, username, password")
      .eq("branch_id", effectiveBranchId)
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

  const existing = await lookupPerson(baseUrl, token, personSn);
  if (!existing) {
    await supabase
      .from(tableName)
      .update({ mips_sync_status: action === "revoke_staff" ? "revoked" : "pending" })
      .eq("id", person_id);
    return {
      success: true,
      action: action === "revoke_staff" ? "revoke" : "restore",
      message: "Person not found in MIPS, status updated locally",
    };
  }

  const newValidTimeEnd = action === "revoke_staff" ? REVOKED_DATE : PERMANENT_END;
  const updatedPerson = { ...existing, validTimeEnd: newValidTimeEnd };

  const putRes = await fetch(`${baseUrl}/personInfo/person`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(updatedPerson),
  });
  const putJson = await putRes.json();
  const putSuccess = putJson.code === 200 || putJson.code === 0;
  if (!putSuccess) {
    return {
      success: false,
      action: action === "revoke_staff" ? "revoke" : "restore",
      error: putJson.msg || "MIPS update failed",
    };
  }

  try {
    await dispatchToDevices(baseUrl, token, existing.personId, supabase, effectiveBranchId);
  } catch (e) {
    console.warn("Device dispatch failed (non-fatal):", e);
  }

  await supabase
    .from(tableName)
    .update({ mips_sync_status: action === "revoke_staff" ? "revoked" : "active" })
    .eq("id", person_id);

  try {
    await supabase.from("access_logs").insert({
      device_sn: "CRM-SYSTEM",
      event_type: `hardware_${action}`,
      result: action === "revoke_staff" ? "staff_denied" : "staff",
      message: `Staff (${person_type}) ${action === "revoke_staff" ? "revoked" : "restored"}: ${reason || action}. validTimeEnd=${newValidTimeEnd}`,
      branch_id: effectiveBranchId,
    });
  } catch (e) {
    console.warn("access_logs insert failed (non-fatal):", e);
  }

  return {
    success: true,
    action: action === "revoke_staff" ? "revoke" : "restore",
    new_valid_time_end: newValidTimeEnd,
    mips_person_id: existing.personId,
    person_type,
    message: `Staff access ${action === "revoke_staff" ? "revoked" : "restored"} successfully`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as "revoke" | "restore" | "sweep_expired" | undefined;

    if (!action) {
      return new Response(JSON.stringify({ error: "Missing action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sweep_expired") {
      const { revoked, errors } = await sweepExpired(supabase);
      return new Response(
        JSON.stringify({
          success: true,
          revoked_count: revoked.length,
          revoked,
          errors,
          checked_at: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action !== "revoke" && action !== "restore") {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { member_id, reason, branch_id } = body as {
      member_id?: string;
      reason?: string;
      branch_id?: string;
    };

    if (!member_id) {
      return new Response(JSON.stringify({ error: "Missing member_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await applyMemberAction(supabase, member_id, action, reason, branch_id);
    const status = result.success ? 200 : result.error === "Member not found" ? 404 : 400;
    return new Response(JSON.stringify(result), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("mips-access error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
