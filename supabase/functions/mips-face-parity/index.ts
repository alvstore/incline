// mips-face-parity v1.2.0
// Reconciles FACE (photo) enrolment across every MIPS device of a branch.
//
// Problem it solves: the MIPS server holds N persons with photos, but each
// turnstile can end up with a different face count (e.g. Gate 1 = 69,
// Gate 2 = 70) when a syncPerson dispatch silently failed for one device.
//
// Actions:
//   { action: "report", branch_id? }  → per-device persons/faces + server photo count
//   { action: "audit", branch_id }    → NAMED list of who is missing a face per gate,
//        read from the mips_device_face_state ledger written by mips-face-sweep.
//   { action: "resync", branch_id?, device_ids?: number[] }
//        → re-dispatch every person that HAS a photo to the given devices
//          (defaults to all devices on the branch).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claimDispatchSlot, dispatchPerson, releaseDispatchSlot } from "../_shared/mipsDispatch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`MIPS login non-JSON: ${text.slice(0, 200)}`); }
  const token = j.token || j.data?.token;
  if (!token) throw new Error(`MIPS login failed: ${j.msg || text.slice(0, 200)}`);
  return token;
}

const authHeaders = (token: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
  "TENANT-ID": "1",
});

async function getJson(url: string, token: string) {
  const res = await fetch(url, { method: "GET", headers: authHeaders(token) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPA_URL, SERVICE_KEY);

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (bearer !== SERVICE_KEY) {
      if (!bearer) return json({ error: "Unauthorized" }, 401);
      const { data: userRes } = await supabase.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const allowed = new Set(["owner", "admin", "manager"]);
      if (!(roles || []).some((r: any) => allowed.has(r.role))) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { action = "report", branch_id, device_ids, person_type, person_id } = body as {
      action?: "report" | "resync" | "diagnose" | "audit";
      branch_id?: string;
      device_ids?: number[];
      person_type?: "member" | "employee" | "trainer";
      person_id?: string;
    };


    // Resolve MIPS connection (branch-scoped, env fallback)
    let serverUrl = Deno.env.get("MIPS_SERVER_URL") || "";
    let username = Deno.env.get("MIPS_USERNAME") || "";
    let password = Deno.env.get("MIPS_PASSWORD") || "";
    if (branch_id) {
      const { data: conn } = await supabase
        .from("mips_connections")
        .select("server_url, username, password")
        .eq("branch_id", branch_id)
        .eq("is_active", true)
        .maybeSingle();
      if (conn) {
        serverUrl = conn.server_url;
        username = conn.username;
        password = conn.password;
      }
    }
    if (!serverUrl) return json({ error: "No MIPS server configured" }, 400);
    const baseUrl = serverUrl.replace(/\/+$/, "");
    const token = await login(baseUrl, username, password);

    // 1. Device inventory from the MIPS server
    const devJson = await getJson(`${baseUrl}/through/device/list`, token);
    const devRows: any[] = devJson?.rows || devJson?.data || [];
    const devices = devRows.map((d) => ({
      id: Number(d.id ?? d.deviceId),
      sn: String(d.deviceKey || d.sn || d.serialNumber || ""),
      name: d.deviceName || d.name || "",
      persons: Number(d.personCount ?? d.personNum ?? 0),
      faces: Number(d.photoCount ?? d.faceCount ?? d.faceNum ?? 0),
      online: d.onlineFlag === 1 || d.status === 1 || d.status === "1",
    })).filter((d) => !isNaN(d.id));

    // Named audit: who exactly is missing a face on each gate. Reads the
    // per-person ledger built by mips-face-sweep (single-person pushes with
    // photoCount attribution) — this firmware exposes no per-device roster.
    if (action === "audit") {
      if (!branch_id) return json({ error: "branch_id is required" }, 400);
      const { data: ledger } = await supabase
        .from("mips_device_face_state")
        .select("mips_device_id, device_name, person_sn, person_name, person_type, state, reason, attempts, last_attempt_at")
        .eq("branch_id", branch_id)
        .limit(5000);
      const rows = ledger || [];
      return json({
        success: true,
        devices: devices.map((d) => {
          const forDevice = rows.filter((r: any) => Number(r.mips_device_id) === d.id);
          const notEnrolled = forDevice.filter((r: any) => r.state !== "enrolled");
          return {
            id: d.id,
            name: d.name,
            online: d.online,
            persons_on_device: d.persons,
            faces_on_device: d.faces,
            tracked: forDevice.length,
            enrolled: forDevice.length - notEnrolled.length,
            missing: notEnrolled.map((r: any) => ({
              person_sn: r.person_sn,
              person_name: r.person_name,
              person_type: r.person_type,
              state: r.state,
              reason: r.reason,
              attempts: r.attempts,
              last_attempt_at: r.last_attempt_at,
            })),
          };
        }),
        note: rows.length === 0
          ? "Ledger is empty — run the face sweep once to start attributing faces per person."
          : undefined,
      });
    }

    // Diagnostic: prove whether the terminal rejects the face image or whether
    // the dispatch itself was lost. Re-push one person, then re-read each
    // gate's photoCount — the only device-side truth this firmware exposes.
    if (action === "diagnose") {
      if (!person_type || !person_id) return json({ error: "person_type and person_id are required" }, 400);
      const before = devices.map((d) => ({ id: d.id, name: d.name, faces: d.faces, persons: d.persons }));

      const syncRes = await fetch(`${SUPA_URL}/functions/v1/sync-to-mips`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
        },
        body: JSON.stringify({ person_type, person_id, branch_id, deploy_to_devices: true }),
        signal: AbortSignal.timeout(40_000),
      });
      const syncData = await syncRes.json().catch(() => ({}));

      // Give the terminal time to pull and enrol the face template.
      await new Promise((r) => setTimeout(r, 8000));
      const afterJson = await getJson(`${baseUrl}/through/device/list`, token);
      const afterRows: any[] = afterJson?.rows || afterJson?.data || [];
      const after = afterRows.map((d) => ({
        id: Number(d.id ?? d.deviceId),
        name: d.deviceName || d.name || "",
        faces: Number(d.photoCount ?? d.faceCount ?? d.faceNum ?? 0),
        persons: Number(d.personCount ?? d.personNum ?? 0),
      })).filter((d) => !isNaN(d.id));

      const deltas = after.map((a) => {
        const b = before.find((x) => x.id === a.id);
        return { device: a.name, faces_before: b?.faces ?? null, faces_after: a.faces, delta: b ? a.faces - b.faces : null };
      });
      const anyIncrease = deltas.some((d) => (d.delta ?? 0) > 0);

      return json({
        success: true,
        verdict: anyIncrease
          ? "face_enrolled — dispatch path is healthy for this person"
          : "no_face_increase — server accepted it but no gate enrolled the face (image quality or a lost dispatch)",
        sync: {
          ok: syncData?.success ?? false,
          photo_uploaded: syncData?.photo_uploaded ?? null,
          photo_result: syncData?.photo_result ?? null,
          dispatched_device_ids: syncData?.dispatched_device_ids ?? [],
          requested_device_ids: syncData?.requested_device_ids ?? [],
          error: syncData?.error ?? null,
        },
        deltas,
      });
    }


    // 2. All persons on the server, keeping only those that carry a photo
    const persons: Array<{ id: number; personSn: string; name: string; hasPhoto: boolean }> = [];
    for (let page = 1; page <= 20; page++) {
      const pj = await getJson(
        `${baseUrl}/personInfo/person/list?pageNum=${page}&pageSize=100`,
        token,
      );
      const rows: any[] = pj?.rows || pj?.data?.rows || pj?.data || [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const p of rows) {
        persons.push({
          id: Number(p.id ?? p.personId),
          personSn: String(p.personSn || p.personNo || ""),
          name: p.personName || p.name || "",
          hasPhoto: Boolean(
            p.photoUri || p.photoUrl || p.photo || p.facePhoto || p.faceUrl ||
            p.havePhoto === 1 || p.havePhoto === true ||
            p.photoFlag === 1 || p.faceFlag === 1 || Number(p.faceCount) > 0,
          ),


        });
      }
      if (rows.length < 100) break;
    }
    // Fall back to every person when the server does not expose a photo flag —
    // syncing a photo-less person is a no-op on the device, but skipping a
    // photo-bearing one is what leaves a gate short of faces.
    const photoFlagged = persons.filter((p) => p.hasPhoto && !isNaN(p.id));
    const withPhoto = photoFlagged.length > 0
      ? photoFlagged
      : persons.filter((p) => !isNaN(p.id));


    if (action === "report") {
      const maxFaces = devices.reduce((m, d) => Math.max(m, d.faces), 0);
      return json({
        success: true,
        server_persons: persons.length,
        server_persons_with_photo: withPhoto.length,
        devices: devices.map((d) => ({
          ...d,
          faces_missing: Math.max(withPhoto.length - d.faces, 0),
          lagging: d.faces < maxFaces,
        })),
      });
    }

    // 3. Re-dispatch every photo-bearing person to the target devices
    const targets = (device_ids && device_ids.length ? device_ids : devices.map((d) => d.id))
      .map(Number)
      .filter((n) => !isNaN(n));
    if (targets.length === 0) return json({ error: "No target devices" }, 400);

    // Dispatch per device (not one bulk deviceIds array): a single bad device id
    // makes the whole bulk call fail, which is exactly how Gate 2 fell behind.
    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    const perDevice: Record<string, { ok: number; failed: number }> = {};
    for (const t of targets) perDevice[String(t)] = { ok: 0, failed: 0 };

    for (const p of withPhoto) {
      for (const t of targets) {
        let success = false;
        let slotHeld = false;
        try {
          slotHeld = await claimDispatchSlot(supabase, t, null, { minGapSeconds: 1 });
          if (!slotHeld) {
            if (errors.length < 15) errors.push(`dev ${t} / ${p.personSn}: dispatch slot busy`);
          } else {
            const outcome = await dispatchPerson({
              baseUrl,
              headers: authHeaders(token),
              personId: p.id,
              deviceIds: [t],
              attempts: 2,
            });
            success = outcome.ok;
            if (!success && errors.length < 15) {
              errors.push(`dev ${t} / ${p.personSn}: ${outcome.message ?? "unknown"}`);
            }
          }
        } catch (e) {
          if (errors.length < 15) {
            errors.push(`dev ${t} / ${p.personSn}: ${e instanceof Error ? e.message : String(e)}`);
          }
        } finally {
          if (slotHeld) await releaseDispatchSlot(supabase, t);
        }

        if (success) { ok++; perDevice[String(t)].ok++; }
        else { failed++; perDevice[String(t)].failed++; }
        // gentle pacing so the server queue does not drop dispatches
        await new Promise((r) => setTimeout(r, 40));
      }
    }


    return json({
      success: true,
      dispatched: ok,
      failed,
      per_device: perDevice,
      total_with_photo: withPhoto.length,
      target_device_ids: targets,
      errors,
    });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
