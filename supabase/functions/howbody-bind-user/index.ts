// v2.0.0 — Bind HOWBODY scanner session to a member (calls /openApi/setUserInfo)
// Kind-aware entitlement: a BODY scan requires BODY entitlement; a POSTURE scan requires
// POSTURE entitlement. Posture entitlement may NEVER substitute for body entitlement.
// scanId is single-use: a scanId already bound (or completed) cannot be re-bound.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, admin, getHowbodyCreds, howbodyAuthedHeaders } from "../_shared/howbody.ts";

type ScanKind = "body" | "posture";

interface BindBody {
  equipmentNo?: string;
  scanId?: string;
  memberId?: string;
  kind?: string;
}

/** Human-readable denial reason mapped from howbody_scan_quota() output. */
function denialReason(kind: ScanKind, quota: Record<string, unknown> | null): string {
  const label = kind === "posture" ? "posture" : "body composition";
  const reason = (quota?.reason as string) || "";
  if (reason === "plan_no_scan") {
    return `Your current plan does not include ${label} scans, and you have no add-on scans remaining. Please ask staff.`;
  }
  if (reason === "period_limit") {
    return `You have used all ${label} scans included for this period. Purchase an add-on scan or ask staff for help.`;
  }
  return `No ${label} scan entitlement found on your account. Please ask staff.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const sbAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await sbAuth.auth.getClaims(token);
    const callerId = claims?.claims?.sub as string | undefined;
    if (!callerId) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as BindBody;
    const equipmentNo = (body.equipmentNo || "").trim();
    const scanId = (body.scanId || "").trim();
    const memberId = (body.memberId || "").trim();
    const kind: ScanKind = body.kind === "posture" ? "posture" : "body";
    if (!equipmentNo || !scanId || !memberId) {
      return json({ ok: false, error: "equipmentNo, scanId and memberId are required" }, 400);
    }

    const sb = admin();

    // Device allowlist — a device explicitly disabled in inventory cannot start scans.
    const { data: deviceOk } = await sb.rpc("howbody_device_authorized", { _equipment_no: equipmentNo });
    if (deviceOk === false) {
      return json({ ok: false, error: "This scanner is not authorized. Please ask staff." }, 403);
    }

    // scanId single-use — never re-bind an already used session.
    const { data: existingSession } = await sb
      .from("howbody_scan_sessions")
      .select("id, member_id, status")
      .eq("scan_id", scanId)
      .maybeSingle();
    if (existingSession && existingSession.status !== "pending") {
      const sameMember = existingSession.member_id === memberId;
      return json({
        ok: false,
        error: sameMember
          ? "This scan session is already linked. Please scan the device QR again for a new session."
          : "This scan session belongs to another member. Please scan the device QR again.",
      }, 409);
    }

    // Load member + profile
    const { data: member, error: mErr } = await sb
      .from("members")
      .select("id, user_id, status, howbody_third_uid, profiles:user_id(full_name,phone,gender,date_of_birth)")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr || !member) return json({ ok: false, error: "Member not found" }, 404);

    if (member.status && member.status !== "active") {
      return json({ ok: false, error: "Member is not active" }, 403);
    }

    // Ownership check: a member may only bind themselves. Staff may bind anyone.
    if (member.user_id !== callerId) {
      const { data: roleRows } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId);
      const roles = (roleRows || []).map((r: { role: string }) => r.role);
      const staffRoles = ["owner", "admin", "manager", "staff", "trainer"];
      if (!roles.some((r) => staffRoles.includes(r))) {
        return json({ ok: false, error: "You can only link your own account to the scanner." }, 403);
      }
    }

    // Entitlement — strictly for the requested scan kind (no cross-substitution).
    const { data: quota } = await sb.rpc("howbody_scan_quota", { _member_id: memberId, _kind: kind });
    const allowed = (quota as Record<string, unknown> | null)?.allowed === true;
    if (!allowed) {
      return json({
        ok: false,
        error: denialReason(kind, quota as Record<string, unknown> | null),
        kind,
        quota,
      }, 403);
    }

    const profile: Record<string, string | null> = (member.profiles || {}) as Record<string, string | null>;
    const sex = profile.gender === "female" ? 0 : 1;
    let age: number | null = null;
    if (profile.date_of_birth) {
      const dob = new Date(profile.date_of_birth);
      const diff = Date.now() - dob.getTime();
      age = Math.max(4, Math.min(99, Math.floor(diff / (365.25 * 24 * 3600 * 1000))));
    }

    // Latest measurement for height
    const { data: meas } = await sb
      .from("member_measurements")
      .select("height_cm")
      .eq("member_id", memberId)
      .not("height_cm", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const height = Math.max(80, Math.min(250, Number(meas?.height_cm) || 170));

    // Call HOWBODY setUserInfo
    const { baseUrl } = await getHowbodyCreds();
    const headers = await howbodyAuthedHeaders();
    const hbResp = await fetch(`${baseUrl}/openApi/setUserInfo`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        equipmentNo,
        scanId,
        thirdUid: member.howbody_third_uid,
        nickname: profile.full_name || "Member",
        tel: profile.phone || "",
        sex,
        height,
        age: age ?? 25,
      }),
    });
    const hbBody = await hbResp.json().catch(() => ({}));

    if (hbBody?.code !== 200) {
      // HOWBODY production API returns `msg`; older docs say `message`. Support both.
      const rawMsg = (hbBody?.msg || hbBody?.message || "").toString();
      const lower = rawMsg.toLowerCase();
      const isSessionExpired = lower.includes("session") || rawMsg.includes("会话") || lower.includes("expired");
      const friendly =
        hbBody?.code === 406 ? (isSessionExpired ? "QR session expired — please scan the device QR again" : (rawMsg || "Invalid scan parameters"))
        : hbBody?.code === 401 ? "HOWBODY auth failed — check API credentials"
        : hbBody?.code === 500 ? "Device may be offline. Please ask staff."
        : (rawMsg || "HOWBODY rejected the request");
      return json({ ok: false, error: friendly, code: hbBody?.code, raw: rawMsg }, 502);
    }

    // Persist session (entitlement is consumed later, on the confirmed report push)
    await sb.from("howbody_scan_sessions").upsert({
      scan_id: scanId,
      equipment_no: equipmentNo,
      member_id: memberId,
      kind,
      status: "bound",
      bound_at: new Date().toISOString(),
    }, { onConflict: "scan_id" });

    return json({ ok: true, kind });
  } catch (e) {
    console.error("howbody-bind-user error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
