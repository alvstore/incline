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
  pruneLedger,
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
// How long an `unverified` row rests before we try to prove it again.
const VERIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// How far back a face recognition still counts as proof of a live template.
const RECOGNITION_WINDOW_DAYS = 120;


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

/**
 * Tier A verification — attribute face templates from real recognitions.
 *
 * The firmware never says WHO it holds, but every accepted face scan in
 * `access_logs` names a person AND the gate serial that recognised them. A
 * successful face scan is proof that this gate carries a usable template for
 * that person, so the matching ledger rows can be marked `enrolled` without
 * touching the MIPS server at all.
 */
async function verifyByRecognition(
  supabase: any,
  branchId: string,
  devices: LedgerDevice[],
  roster: LedgerPerson[],
): Promise<number> {
  if (!devices.length || !roster.length) return 0;

  // serial → mips_device_id
  const { data: deviceRows } = await supabase
    .from("access_devices")
    .select("serial_number, mips_device_id")
    .eq("branch_id", branchId)
    .not("mips_device_id", "is", null);
  const snToMips = new Map<string, number>();
  for (const d of deviceRows || []) {
    if (d.serial_number) snToMips.set(String(d.serial_number).toUpperCase(), Number(d.mips_device_id));
  }
  if (!snToMips.size) return 0;

  const since = new Date(Date.now() - RECOGNITION_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: logs } = await supabase
    .from("access_logs")
    .select("device_sn, member_id, profile_id")
    .eq("branch_id", branchId)
    .eq("event_type", "face_scan")
    .gte("captured_at", since)
    .limit(20000);
  if (!logs?.length) return 0;

  // person_id → person_sn (members are keyed by member id, staff by profile id)
  const memberIds = roster.filter((p) => p.type === "member").map((p) => p.id);
  const staff = roster.filter((p) => p.type !== "member");
  const snByMemberId = new Map<string, string>();
  for (const p of roster) if (p.type === "member") snByMemberId.set(p.id, p.sn);

  const snByProfileId = new Map<string, string>();
  if (staff.length) {
    const [emp, trn] = await Promise.all([
      supabase.from("employees").select("id, user_id").in("id", staff.filter((s) => s.type === "employee").map((s) => s.id)),
      supabase.from("trainers").select("id, user_id").in("id", staff.filter((s) => s.type === "trainer").map((s) => s.id)),
    ]);
    for (const row of [...(emp.data || []), ...(trn.data || [])]) {
      const person = staff.find((s) => s.id === row.id);
      if (person && row.user_id) snByProfileId.set(row.user_id, person.sn);
    }
  }

  // (mips_device_id, person_sn) pairs proven by a real recognition
  const proven = new Map<number, Set<string>>();
  for (const l of logs) {
    const mipsId = snToMips.get(String(l.device_sn || "").toUpperCase());
    if (!mipsId) continue;
    const sn = (l.member_id && snByMemberId.get(l.member_id))
      || (l.profile_id && snByProfileId.get(l.profile_id));
    if (!sn) continue;
    const set = proven.get(mipsId) || new Set<string>();
    set.add(sn);
    proven.set(mipsId, set);
  }
  if (!proven.size) return 0;

  let marked = 0;
  for (const [mipsId, sns] of proven.entries()) {
    const list = [...sns];
    for (let i = 0; i < list.length; i += 200) {
      const { data } = await supabase
        .from("mips_device_face_state")
        .update({
          state: "enrolled",
          reason: "Verified by a successful face recognition at this gate",
          enrolled_at: new Date().toISOString(),
        })
        .eq("branch_id", branchId)
        .eq("mips_device_id", mipsId)
        .in("person_sn", list.slice(i, i + 200))
        .neq("state", "enrolled")
        .select("id");
      marked += (data || []).length;
    }
  }
  if (marked) console.log(`[mips-face-sweep] recognition-verified ${marked} ledger rows (memberIds=${memberIds.length})`);
  return marked;
}


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
          .select("id, mips_person_sn, full_name:employee_code")
          .eq("branch_id", branchId).not("mips_person_id", "is", null).or(photoFilter).limit(1000),
        supabase.from("trainers")
          .select("id, mips_person_sn, full_name:trainer_code")
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

      // ---- Tier A proof: real face recognition at the gate ------------------
      // If a person has actually been recognised BY FACE on a given gate, that
      // gate demonstrably holds a usable template for them. This is stronger
      // evidence than any counter delta and costs the MIPS server nothing.
      const recognised = await verifyByRecognition(supabase, branchId, branchDevices, roster);

      const ledger = await readLedger(supabase, branchId);

      const outstanding = ledger.filter((r) => r.state === "pending" || r.state === "missing");
      const rejected = ledger.filter((r) => r.state === "rejected");
      const unverified = ledger.filter((r) => r.state === "unverified");
      // `unverified` rows are retried on a slow cadence so the ledger keeps
      // converting guesswork into proof even when every gate is at parity.
      const verifyDue = unverified.filter(
        (r) => !r.last_attempt_at || Date.now() - Date.parse(r.last_attempt_at) > VERIFY_COOLDOWN_MS,
      );

      // Nothing queued → do not even touch the MIPS server.
      if (outstanding.length === 0 && verifyDue.length === 0 && !force) {
        summary.push({
          branch_id: branchId,
          nothing_queued: true,
          expected: roster.length,
          verified: ledger.filter((r) => r.state === "enrolled").length,
          unverified: unverified.length,
          rejected: rejected.length,
          recognised,
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
      // carrying everyone — but the firmware never says WHO. Only rows we have
      // ACTUALLY pushed at least once degrade to `unverified` (counted, not
      // attributed). Never-pushed rows stay `pending` so they still get a real
      // single-person push instead of being written off by a bulk counter.
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
            .gt("attempts", 0)
            .in("state", ["pending", "missing"]);
        }
      }

      // ---- Pick the next people, one push each -----------------------------
      const settled = await readLedger(supabase, branchId);
      // `unverified` rows are always retry-eligible once their cooldown has
      // elapsed — parity is not proof, so the ledger must keep working towards
      // a per-person answer instead of freezing forever.
      const stillOutstanding = settled.filter(
        (r) =>
          r.state === "pending" ||
          r.state === "missing" ||
          (r.state === "unverified" &&
            (!r.last_attempt_at || Date.now() - Date.parse(r.last_attempt_at) > VERIFY_COOLDOWN_MS)),
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
          } else if (r.state === "unverified") {
            // A static counter for someone the gate ALREADY counts proves
            // nothing bad — it usually means the template is present. Never
            // escalate an unverified row to `rejected`; just rest it.
            stalled++;
            await supabase
              .from("mips_device_face_state")
              .update({
                last_attempt_at: new Date().toISOString(),
                reason: "Re-pushed; gate counter unchanged (already counted — awaiting a face scan to confirm)",
              })
              .eq("branch_id", branchId)
              .eq("mips_device_id", r.mips_device_id)
              .eq("person_sn", personSn);
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
        pruned,
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
            unverified: rows.filter((r) => r.state === "unverified").length,
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
