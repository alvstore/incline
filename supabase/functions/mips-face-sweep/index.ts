// mips-face-sweep v2.0.0
// Ledger-driven face enrolment worker.
//
// v1.x pushed a rotating batch of people every 5 minutes and hoped the gates'
// `photoCount` climbed. That never converged: photos the terminal cannot build
// a face template from are accepted by the server (`syncPerson` → 200) and then
// silently discarded by the gate, so the same broken photos were re-pushed
// forever while the counter stayed flat.
//
// v2.0.0 pushes ONE person at a time and attributes the resulting photoCount
// delta to that person, building a per-device/per-person ledger
// (`mips_device_face_state`). From then on:
//   - only `pending` / `missing` people are pushed, at most PER_TICK per branch,
//   - `rejected` people are never re-pushed until their photo changes,
//   - when the ledger says every gate is at parity the worker does nothing —
//     no login, no traffic.
//
// Run by the Automation Brain every 5 minutes (rule `mips_face_enrollment_sweep`).
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
import {
  type LedgerDevice,
  type LedgerPerson,
  markAttempt,
  markEnrolled,
  readLedger,
  seedLedger,
} from "../_shared/mipsFaceState.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// One or two people per tick is deliberate: single-person pushes are the only
// way to attribute a photoCount delta, and they cost the VPS almost nothing.
const PER_TICK = 2;
const MAX_PER_TICK = 6;
const SETTLE_MS = 6_000;
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
  try { j = JSON.parse(text); } catch { throw new MipsTransportError(`MIPS login non-JSON: ${text.slice(0, 200)}`); }
  const token = j.token || j.data?.token;
  if (!token) throw new Error(`MIPS login failed: ${j.msg || text.slice(0, 200)}`);
  return token;
}

interface DeviceCount {
  id: number;
  name: string;
  sn: string;
  persons: number;
  faces: number;
  online: boolean;
}

async function readDeviceCounts(baseUrl: string, token: string): Promise<DeviceCount[]> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const pinned = Number((body as any)?.batch) > 0
      ? Math.max(1, Math.min(MAX_PER_TICK, Number((body as any)?.batch)))
      : null;
    const onlyBranch: string | undefined = (body as any)?.branch_id;
    const force = Boolean((body as any)?.force);

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

      const branchDevices: LedgerDevice[] = (devices || [])
        .filter((d: any) => d.branch_id === branchId)
        .map((d: any) => ({
          id: d.id,
          mips_device_id: Number(d.mips_device_id),
          name: d.device_name ?? null,
        }));

      // ---- CRM roster: people who should carry a face on every gate ---------
      const photoFilter = "biometric_photo_path.not.is.null,biometric_photo_url.not.is.null";
      const [members, employees, trainers] = await Promise.all([
        supabase.from("members")
          .select("id, mips_person_sn, full_name:member_code")
          .eq("branch_id", branchId).not("mips_person_id", "is", null).or(photoFilter).limit(1000),
        supabase.from("employees")
          .select("id, mips_person_sn, full_name")
          .eq("branch_id", branchId).not("mips_person_id", "is", null).or(photoFilter).limit(1000),
        supabase.from("trainers")
          .select("id, mips_person_sn, full_name")
          .eq("branch_id", branchId).eq("is_active", true)
          .not("mips_person_id", "is", null).or(photoFilter).limit(1000),
      ]);

      const roster: LedgerPerson[] = [
        ...(members.data || []).map((m: any) => ({
          table: "members" as const, type: "member" as const,
          id: m.id, sn: m.mips_person_sn || "", name: m.full_name ?? null,
        })),
        ...(employees.data || []).map((e: any) => ({
          table: "employees" as const, type: "employee" as const,
          id: e.id, sn: e.mips_person_sn || "", name: e.full_name ?? null,
        })),
        ...(trainers.data || []).map((t: any) => ({
          table: "trainers" as const, type: "trainer" as const,
          id: t.id, sn: t.mips_person_sn || "", name: t.full_name ?? null,
        })),
      ].filter((p) => !!p.sn);

      await seedLedger(supabase, branchId, branchDevices, roster);
      const pruned = await pruneLedger(supabase, branchId, branchDevices, roster);
      const ledger = await readLedger(supabase, branchId);

      const outstanding = ledger.filter((r) => r.state === "pending" || r.state === "missing");
      const rejected = ledger.filter((r) => r.state === "rejected");
      const unverified = ledger.filter((r) => r.state === "unverified");

      // Nothing queued → do not even touch the MIPS server.
      if (outstanding.length === 0 && !force) {
        summary.push({
          branch_id: branchId,
          nothing_queued: true,
          expected: roster.length,
          verified: ledger.filter((r) => r.state === "enrolled").length,
          unverified: unverified.length,
          rejected: rejected.length,
          pruned,
          processed: 0,
        });
        continue;
      }

      // ---- Credentials + breaker -------------------------------------------
      let serverUrl = Deno.env.get("MIPS_SERVER_URL") || "";
      let username = Deno.env.get("MIPS_USERNAME") || "";
      let password = Deno.env.get("MIPS_PASSWORD") || "";
      const { data: conn } = await supabase
        .from("mips_connections")
        .select("server_url, username, password")
        .eq("branch_id", branchId).eq("is_active", true).maybeSingle();
      if (conn) {
        serverUrl = (conn as any).server_url;
        username = (conn as any).username;
        password = (conn as any).password;
      }
      if (!serverUrl) {
        summary.push({ branch_id: branchId, skipped: "no MIPS connection" });
        continue;
      }

      const breaker = await readBreaker(supabase, branchId);
      if (isTripped(breaker) && !force) {
        summary.push({
          branch_id: branchId,
          paused: true,
          reason: "MIPS server unreachable — sync paused, auto-resuming",
          resumes_at: breaker.open_until,
          last_error: breaker.last_error,
        });
        continue;
      }

      const baseUrl = serverUrl.replace(/\/+$/, "");
      let token: string;
      let counts: DeviceCount[];
      try {
        token = await login(baseUrl, username, password);
        counts = await readDeviceCounts(baseUrl, token);
        await recordSuccess(supabase, branchId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof MipsTransportError || classifyFailure({ message: msg }) === "transport") {
          const state = await recordTransportFailure(supabase, branchId, msg);
          summary.push({ branch_id: branchId, transport_error: msg, breaker_open: state.open, resumes_at: state.open_until });
        } else {
          summary.push({ branch_id: branchId, error: msg });
        }
        continue;
      }

      // A gate whose counter already covers the whole roster is *probably*
      // carrying everyone — but the firmware never says WHO, so nothing is
      // marked enrolled here. Untouched rows become `unverified`: counted by
      // the gate, not attributed to a name. Only a single-person push that
      // moves the counter ever writes `enrolled`.
      for (const dev of branchDevices) {
        const live = counts.find((c) => c.id === dev.mips_device_id);
        if (live && roster.length > 0 && live.faces >= roster.length) {
          await supabase
            .from("mips_device_face_state")
            .update({
              state: "unverified",
              reason: "Counted on the gate but never attributed to this person",
            })
            .eq("branch_id", branchId)
            .eq("mips_device_id", dev.mips_device_id)
            .in("state", ["pending", "missing"]);
        }
      }

      // ---- Pick the next people, one push each -----------------------------
      const settled = await readLedger(supabase, branchId);
      // Gates that are numerically behind still need real pushes; their
      // `unverified` rows are fair game (lowest priority) so the ledger keeps
      // converting guesswork into proof over time.
      const behindDevices = new Set(
        branchDevices
          .filter((d) => {
            const live = counts.find((c) => c.id === d.mips_device_id);
            return !live || live.faces < roster.length;
          })
          .map((d) => d.mips_device_id),
      );
      const stillOutstanding = settled.filter(
        (r) =>
          r.state === "pending" ||
          r.state === "missing" ||
          (r.state === "unverified" && behindDevices.has(r.mips_device_id)),
      );
      const perTick = pinned ?? PER_TICK;
      const bySn = new Map<string, typeof stillOutstanding>();
      for (const row of stillOutstanding) {
        const list = bySn.get(row.person_sn) || [];
        list.push(row);
        bySn.set(row.person_sn, list);
      }
      const candidates = [...bySn.entries()]
        .sort((a, b) => {
          const aa = Math.min(...a[1].map((r) => r.attempts));
          const bb = Math.min(...b[1].map((r) => r.attempts));
          if (aa !== bb) return aa - bb;
          const at = a[1][0].last_attempt_at ? Date.parse(a[1][0].last_attempt_at) : 0;
          const bt = b[1][0].last_attempt_at ? Date.parse(b[1][0].last_attempt_at) : 0;
          return at - bt;
        })
        .slice(0, perTick);

      let enrolledNow = 0, stalled = 0, pushFailed = 0;
      const notes: string[] = [];

      for (const [personSn, rows] of candidates) {
        if (Date.now() - startedAt >= INVOCATION_BUDGET_MS) break;
        const row = rows[0];
        const before = await readDeviceCounts(baseUrl, token).catch(() => counts);

        let pushError = "";
        try {
          const res = await fetch(`${SUPA_URL}/functions/v1/sync-to-mips`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
              apikey: SERVICE_KEY,
            },
            body: JSON.stringify({
              person_type: row.person_type,
              person_id: row.person_id,
              branch_id: branchId,
              deploy_to_devices: true,
            }),
            signal: AbortSignal.timeout(25_000),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.photo_uploaded !== true) {
            pushError = String(data?.photo_result?.message || data?.error || `HTTP ${res.status}`);
          }
        } catch (e) {
          pushError = e instanceof Error ? e.message : String(e);
        }

        if (pushError) {
          pushFailed++;
          for (const r of rows) {
            await markAttempt(supabase, branchId, r.mips_device_id, personSn, r.attempts, `Push failed: ${pushError}`);
          }
          if (notes.length < 10) notes.push(`${personSn} → push failed: ${pushError}`);
          continue;
        }

        // Give the terminals a moment to drain the download, then attribute the
        // delta. Single-person pushes make this attribution exact.
        await sleep(SETTLE_MS);
        const after = await readDeviceCounts(baseUrl, token).catch(() => before);

        for (const r of rows) {
          const b = before.find((d) => d.id === r.mips_device_id)?.faces ?? 0;
          const a = after.find((d) => d.id === r.mips_device_id)?.faces ?? b;
          if (a > b) {
            enrolledNow++;
            await markEnrolled(supabase, branchId, r.mips_device_id, personSn);
          } else {
            stalled++;
            await markAttempt(
              supabase, branchId, r.mips_device_id, personSn, r.attempts,
              "Server accepted the photo but the gate's face counter did not move",
            );
          }
        }
        counts = after;
      }

      const finalLedger = await readLedger(supabase, branchId);
      summary.push({
        branch_id: branchId,
        expected: roster.length,
        processed: candidates.length,
        enrolled_now: enrolledNow,
        stalled,
        push_failed: pushFailed,
        notes,
        devices: branchDevices.map((d) => {
          const rows = finalLedger.filter((r) => r.mips_device_id === d.mips_device_id);
          const live = counts.find((c) => c.id === d.mips_device_id);
          return {
            name: d.name,
            mips_device_id: d.mips_device_id,
            online: live?.online ?? null,
            faces_on_device: live?.faces ?? null,
            persons_on_device: live?.persons ?? null,
            enrolled: rows.filter((r) => r.state === "enrolled").length,
            pending: rows.filter((r) => r.state === "pending" || r.state === "missing").length,
            rejected: rows.filter((r) => r.state === "rejected").length,
          };
        }),
      });
    }

    console.log(`[mips-face-sweep] ${JSON.stringify({ took_ms: Date.now() - startedAt, branches: summary.length })}`);
    return json({ success: true, took_ms: Date.now() - startedAt, branches: summary });
  } catch (e) {
    console.error("[mips-face-sweep] fatal:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
