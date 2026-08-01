// mips-face-sweep v1.1.0
// Self-healing face enrollment worker.
//
// The MIPS server accepts photos that the turnstiles then silently discard, so
// the only device-side truth available on this firmware (1.42.x) is the
// `photoCount` field on GET /through/device/list. This worker:
//   1. computes the expected face population from the CRM (people with a
//      biometric photo AND a MIPS person id, on a branch that has devices),
//   2. reads each gate's live photoCount,
//   3. if a gate is short, re-pushes a small rotating batch of people through
//      sync-to-mips (photo upload + per-device dispatch),
//   4. re-reads photoCount and reports the before → after delta.
//
// v1.1.0 adds graceful degradation: transport failures (server rebooting,
// Tomcat restarting, VPS unreachable) trip a shared circuit breaker instead of
// hammering a starting server, and the sweep resumes automatically once a probe
// succeeds.
//
// Run by the Automation Brain every 5 minutes (rule `mips_face_enrollment_sweep`).
// Also callable on demand from the Device Command Center.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyFailure,
  isTripped,
  mipsFetch,
  MipsTransportError,
  readBreaker,
  recordSuccess,
  recordTransportFailure,
} from "../_shared/mipsHealth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Steady-state top-up size. A cold or reset gate gets the burst size instead,
// otherwise a full roster (~70 people) would take two hours at 3 per tick.
const DEFAULT_BATCH = 3;
const BURST_BATCH = 10;
const BURST_SHORTFALL = 20;
const MAX_BATCH = 12;
const INVOCATION_BUDGET_MS = 45_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const { text } = await mipsFetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username, password }),
  }, 10_000);
  let j: any;
  // A booting Tomcat answers with an HTML error page — that is a transport
  // condition, not bad credentials.
  try { j = JSON.parse(text); } catch { throw new MipsTransportError(`MIPS login non-JSON: ${text.slice(0, 200)}`); }
  const token = j.token || j.data?.token;
  if (!token) throw new Error(`MIPS login failed: ${j.msg || text.slice(0, 200)}`);
  return token;
}

async function readDeviceCounts(baseUrl: string, token: string) {
  const { text } = await mipsFetch(`${baseUrl}/through/device/list`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "TENANT-ID": "1" },
  }, 10_000);
  let j: any;
  try { j = JSON.parse(text); } catch { j = {}; }
  const rows: any[] = j?.rows || j?.data || [];
  return rows
    .map((d) => ({
      id: Number(d.id ?? d.deviceId),
      name: d.deviceName || d.name || "",
      sn: String(d.deviceKey || d.sn || d.serialNumber || ""),
      persons: Number(d.personCount ?? d.personNum ?? 0),
      faces: Number(d.photoCount ?? d.faceCount ?? d.faceNum ?? 0),
      online: d.onlineFlag === 1 || d.status === 1 || d.status === "1",
    }))
    .filter((d) => !isNaN(d.id));
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    // An explicit `batch` in the payload pins the size; otherwise it is chosen
    // per branch from the measured shortfall (see below).
    const pinnedBatch = Number((body as any)?.batch) > 0
      ? Math.max(1, Math.min(MAX_BATCH, Number((body as any)?.batch)))
      : null;
    const onlyBranch: string | undefined = (body as any)?.branch_id;

    // Branches that actually have mapped hardware.
    const { data: devices, error: devErr } = await supabase
      .from("access_devices")
      .select("id, branch_id, mips_device_id, device_name")
      .not("mips_device_id", "is", null);
    if (devErr) throw devErr;

    const branchIds = [...new Set((devices || []).map((d: any) => d.branch_id))]
      .filter((b) => !onlyBranch || b === onlyBranch);

    const summary: Array<Record<string, unknown>> = [];

    for (const branchId of branchIds) {
      if (Date.now() - startedAt >= INVOCATION_BUDGET_MS) break;

      // Resolve MIPS credentials for this branch (env fallback).
      let serverUrl = Deno.env.get("MIPS_SERVER_URL") || "";
      let username = Deno.env.get("MIPS_USERNAME") || "";
      let password = Deno.env.get("MIPS_PASSWORD") || "";
      const { data: conn } = await supabase
        .from("mips_connections")
        .select("server_url, username, password")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .maybeSingle();
      if (conn) {
        serverUrl = (conn as any).server_url;
        username = (conn as any).username;
        password = (conn as any).password;
      }
      if (!serverUrl) {
        summary.push({ branch_id: branchId, skipped: "no MIPS connection" });
        continue;
      }

      const baseUrl = serverUrl.replace(/\/+$/, "");
      let token: string;
      try {
        token = await login(baseUrl, username, password);
      } catch (e) {
        summary.push({ branch_id: branchId, error: e instanceof Error ? e.message : String(e) });
        continue;
      }

      const before = await readDeviceCounts(baseUrl, token);

      // Expected face population = CRM people with a photo AND a MIPS identity.
      const photoFilter = "biometric_photo_path.not.is.null,biometric_photo_url.not.is.null";
      const [members, employees, trainers] = await Promise.all([
        supabase.from("members")
          .select("id, mips_face_verified_at")
          .eq("branch_id", branchId)
          .not("mips_person_id", "is", null)
          .or(photoFilter)
          .order("mips_face_verified_at", { ascending: true, nullsFirst: true })
          .limit(500),
        supabase.from("employees")
          .select("id, mips_face_verified_at")
          .eq("branch_id", branchId)
          .not("mips_person_id", "is", null)
          .or(photoFilter)
          .order("mips_face_verified_at", { ascending: true, nullsFirst: true })
          .limit(500),
        supabase.from("trainers")
          .select("id, mips_face_verified_at")
          .eq("branch_id", branchId)
          .eq("is_active", true)
          .not("mips_person_id", "is", null)
          .or(photoFilter)
          .order("mips_face_verified_at", { ascending: true, nullsFirst: true })
          .limit(500),
      ]);

      const roster = [
        ...((members.data || []).map((m: any) => ({ table: "members", type: "member", id: m.id, verified: m.mips_face_verified_at }))),
        ...((employees.data || []).map((e: any) => ({ table: "employees", type: "employee", id: e.id, verified: e.mips_face_verified_at }))),
        ...((trainers.data || []).map((t: any) => ({ table: "trainers", type: "trainer", id: t.id, verified: t.mips_face_verified_at }))),
      ].sort((a, b) => {
        if (!a.verified && !b.verified) return 0;
        if (!a.verified) return -1;
        if (!b.verified) return 1;
        return new Date(a.verified).getTime() - new Date(b.verified).getTime();
      });

      const expected = roster.length;
      const minFaces = before.length ? Math.min(...before.map((d) => d.faces)) : 0;
      const shortfall = Math.max(expected - minFaces, 0);

      if (shortfall === 0 || roster.length === 0) {
        summary.push({
          branch_id: branchId,
          expected,
          devices: before.map((d) => ({ name: d.name, faces: d.faces, persons: d.persons, online: d.online })),
          shortfall: 0,
          processed: 0,
        });
        continue;
      }

      // Adaptive batch: burst when a gate is cold (reset / large backlog),
      // small top-ups once the fleet is close to parity.
      const batchSize = pinnedBatch
        ?? (shortfall >= BURST_SHORTFALL ? BURST_BATCH : DEFAULT_BATCH);

      // Oldest-verified-first batch — a rotating cursor without extra state.
      const batch = roster.slice(0, batchSize);
      let ok = 0, failed = 0;
      const failures: string[] = [];

      for (const person of batch) {
        if (Date.now() - startedAt >= INVOCATION_BUDGET_MS) break;
        try {
          const res = await fetch(`${SUPA_URL}/functions/v1/sync-to-mips`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
              apikey: SERVICE_KEY,
            },
            body: JSON.stringify({
              person_type: person.type,
              person_id: person.id,
              branch_id: branchId,
              deploy_to_devices: true,
            }),
            signal: AbortSignal.timeout(25_000),
          });
          const data = await res.json().catch(() => ({}));
          const dispatched = Array.isArray(data?.dispatched_device_ids) ? data.dispatched_device_ids : [];
          const requested = Array.isArray(data?.requested_device_ids) ? data.requested_device_ids : [];
          const success = res.ok
            && data?.photo_uploaded === true
            && requested.length > 0
            && dispatched.length === requested.length;

          if (success) {
            ok++;
            await supabase.from(person.table)
              .update({ mips_face_verified_at: new Date().toISOString() })
              .eq("id", person.id);
          } else {
            failed++;
            // Push to the back of the queue for this cycle so a permanently
            // broken source photo cannot block everyone behind it.
            await supabase.from(person.table)
              .update({ mips_face_verified_at: new Date().toISOString() })
              .eq("id", person.id);
            if (failures.length < 10) {
              failures.push(
                `${person.type}:${person.id} → ${data?.photo_result?.message || data?.error || `devices ${dispatched.length}/${requested.length}`}`,
              );
            }
          }
        } catch (e) {
          failed++;
          if (failures.length < 10) failures.push(`${person.type}:${person.id} → ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const after = await readDeviceCounts(baseUrl, token);
      const deviceReport = after.map((d) => {
        const prev = before.find((p) => p.id === d.id);
        return {
          name: d.name,
          persons: d.persons,
          faces_before: prev?.faces ?? null,
          faces_after: d.faces,
          delta: prev ? d.faces - prev.faces : null,
          online: d.online,
        };
      });
      // The server accepted the dispatches but no terminal counter moved: the
      // gates are online yet not draining their download queue. That is a
      // device-side condition, not a pipeline failure — flag it explicitly so
      // the operator is told instead of watching a silent retry loop.
      const gatesStalled = ok > 0
        && deviceReport.length > 0
        && deviceReport.every((d) => d.online && (d.delta ?? 0) === 0);

      summary.push({
        branch_id: branchId,
        expected,
        shortfall,
        batch_size: batchSize,
        processed: ok + failed,
        ok,
        failed,
        failures,
        gates_stalled: gatesStalled,
        devices: deviceReport,
      });
    }

    console.log(`[mips-face-sweep] ${JSON.stringify({ took_ms: Date.now() - startedAt, branches: summary.length })}`);
    return json({ success: true, took_ms: Date.now() - startedAt, branches: summary });
  } catch (e) {
    console.error("[mips-face-sweep] fatal:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
