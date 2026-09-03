// v2.0.0 — HOWBODY posture report push receiver
// Hardening: device allowlist, scanId ↔ member correlation, atomic idempotent entitlement
// consumption on the confirmed report (plan allowance first, then add-on credit).
import { corsHeaders, json, admin, logWebhook, getExpectedWebhookAppKey } from "../_shared/howbody.ts";

const ENVELOPE_OK = { code: 200, message: "Push successful", data: null };
const ENVELOPE_FAIL = { code: 500, message: "Push failed", data: null };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readAppKey(req: Request): string | null {
  for (const [k, v] of req.headers.entries()) {
    if (k.toLowerCase() === "appkey") return v;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const expectedKey = await getExpectedWebhookAppKey();
    const sentKey = readAppKey(req);
    if (!expectedKey || !sentKey || !timingSafeEqual(sentKey, expectedKey)) {
      await logWebhook("posture", null, null, 401, "appkey mismatch", null);
      return json({ code: 401, message: "Unauthorized", data: null }, 401);
    }

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") return json(ENVELOPE_FAIL, 400);

    const thirdUid = payload.thirdUid as string | undefined;
    const dataKey = payload.dataKey as string | undefined;
    if (!thirdUid || !dataKey) {
      await logWebhook("posture", thirdUid ?? null, dataKey ?? null, 400, "missing thirdUid/dataKey", payload);
      return json(ENVELOPE_FAIL, 400);
    }

    const sb = admin();

    // Device allowlist — reject pushes from devices disabled in inventory.
    if (payload.equipmentNo) {
      const { data: deviceOk } = await sb.rpc("howbody_device_authorized", {
        _equipment_no: payload.equipmentNo,
      });
      if (deviceOk === false) {
        await logWebhook("posture", thirdUid, dataKey, 403, `unauthorized device ${payload.equipmentNo}`, payload);
        return json({ code: 403, message: "Device not authorized", data: null }, 403);
      }
    }

    const { data: member } = await sb
      .from("members")
      .select("id")
      .eq("howbody_third_uid", thirdUid)
      .maybeSingle();
    if (!member) {
      await logWebhook("posture", thirdUid, dataKey, 404, "member not found", payload);
      return json(ENVELOPE_FAIL, 404);
    }

    // scanId ↔ member correlation — a report may not be attributed across sessions.
    if (payload.scanId) {
      const { data: session } = await sb
        .from("howbody_scan_sessions")
        .select("member_id")
        .eq("scan_id", payload.scanId)
        .maybeSingle();
      if (session && session.member_id && session.member_id !== member.id) {
        await logWebhook("posture", thirdUid, dataKey, 409, "scanId/member mismatch", payload);
        return json({ code: 409, message: "Session mismatch", data: null }, 409);
      }
    }

    const testTime = payload.testTime ? new Date(Number(payload.testTime) * 1000).toISOString() : null;
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

    const { data: upserted } = await sb.from("howbody_posture_reports").upsert({
      member_id: member.id,
      data_key: dataKey,
      equipment_no: payload.equipmentNo ?? null,
      scan_id: payload.scanId ?? null,
      test_time: testTime,
      score: num(payload.score),
      head_forward: num(payload.headForward),
      head_slant: num(payload.headSlant),
      shoulder_left: num(payload.shoulderLeft),
      shoulder_right: num(payload.shoulderRight),
      high_low_shoulder: num(payload.highLowShoulder),
      pelvis_forward: num(payload.pelvisForward),
      knee_left: num(payload.kneeLeft),
      knee_right: num(payload.kneeRight),
      leg_left: num(payload.legLeft),
      leg_right: num(payload.legRight),
      body_slope: num(payload.bodySlope),
      bust: num(payload.bust),
      waist: num(payload.waist),
      hip: num(payload.hip),
      left_thigh: num(payload.leftThigh),
      right_thigh: num(payload.rightThigh),
      calf_left: num(payload.calfLeft),
      calf_right: num(payload.calfRight),
      shoulder_back: num(payload.shoulderBack),
      up_arm_left: num(payload.upArmLeft),
      up_arm_right: num(payload.upArmRight),
      front_img: payload.frontImg ?? null,
      left_img: payload.leftImg ?? null,
      right_img: payload.rightImg ?? null,
      back_img: payload.backImg ?? null,
      model_url: payload.murl ?? null,
      full_payload: payload,
    }, { onConflict: "data_key" }).select("id").maybeSingle();

    // Atomic, idempotent entitlement consumption keyed on dataKey.
    const { data: consumption, error: consumeErr } = await sb.rpc("howbody_consume_scan", {
      _member_id: member.id,
      _kind: "posture",
      _data_key: dataKey,
    });
    if (consumeErr) console.error("howbody_consume_scan (posture) failed:", consumeErr.message);
    const isDuplicate = (consumption as Record<string, unknown> | null)?.duplicate === true;

    // Touch device inventory (auto-registers unknown devices, bumps counters)
    if (payload.equipmentNo) {
      await sb.rpc("howbody_touch_device", { _equipment_no: payload.equipmentNo }).catch(() => {});
    }

    if (payload.scanId) {
      await sb.from("howbody_scan_sessions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("scan_id", payload.scanId);
    }

    // Fire-and-forget: deliver report to member (Email + WhatsApp + in-app).
    // Skipped on duplicate pushes so a redelivered dataKey never re-sends.
    if (upserted?.id && !isDuplicate) {
      sb.functions.invoke("deliver-scan-report", {
        body: { report_id: upserted.id, kind: "posture" },
      }).catch((err) => console.error("deliver-scan-report (posture) invoke failed:", err));
    }

    await logWebhook("posture", thirdUid, dataKey, 200, isDuplicate ? "ok (duplicate)" : "ok", null);
    return json(ENVELOPE_OK, 200);
  } catch (e) {
    console.error("howbody-posture-webhook error:", e);
    await logWebhook("posture", null, null, 500, e instanceof Error ? e.message : "error", null);
    return json(ENVELOPE_FAIL, 500);
  }
});
