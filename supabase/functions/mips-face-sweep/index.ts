// mips-face-sweep v2.4.0
// v2.4.0: photo_rejected persons stay ON the roster (so staff still see
// "needs a new photo") but their ledger rows are forced to `rejected`, which
// keeps them out of every push loop. A new photo resets the person's sync
// status to `pending` (DB trigger) and they are retried automatically.
// v2.3.0: gate face-related rejection messages (unqualified face data,
// FacePassHandler, person is null) immediately mark the person photo_rejected
// so the photo is never re-pushed.
// v2.2.0: verification-only for unverified rows. Only genuinely pending or
// missing photos can produce a gate issue; successful delivery never expires.
// v2.1.0: adds Tier-A verification (a real face recognition at a gate proves
// that gate holds the template), keeps `unverified` rows retry-eligible on a
// cooldown instead of freezing at counter parity, only degrades rows that were
// actually pushed, and never escalates `unverified` to `rejected`.
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
  REJECT_AFTER_ATTEMPTS,
  seedLedger,
} from "../_shared/mipsFaceState.ts";
import { fetchPushLedger, latestLedgerState } from "../_shared/mipsDispatch.ts";

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

// Reads the roster from the shared 120s device-list cache instead of polling
// the heaviest MIPS endpoint on every sweep.
async function readDeviceCounts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  branchId: string | null,
  baseUrl: string,
  token: string,
): Promise<DeviceCount[]> {
  const rows = await getCachedMipsDevices(supabase, branchId, baseUrl, token);
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
 * Per-person / per-gate delivery truth from the MIPS push ledger.
 * Keyed `personSn::mipsDeviceId`, newest row wins.
 */
async function readPushState(baseUrl: string, token: string) {
  try {
    const rows = await fetchPushLedger(baseUrl, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "TENANT-ID": "1",
    }, { pageSize: 500, pages: 3 });
    return latestLedgerState(rows);
  } catch (e) {
    console.warn("[mips-face-sweep] push ledger unavailable:", e);
    return new Map<string, never>() as ReturnType<typeof latestLedgerState>;
  }
}

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
  // PostgREST caps a response at 1000 rows, so page explicitly.
  const logs: Array<{ device_sn: string | null; member_id: string | null; profile_id: string | null }> = [];
  const PAGE = 1000;
  for (let from = 0; from < 40_000; from += PAGE) {
    const { data: page } = await supabase
      .from("access_logs")
      .select("device_sn, member_id, profile_id")
      .eq("branch_id", branchId)
      .eq("event_type", "face_scan")
      .gte("captured_at", since)
      .range(from, from + PAGE - 1);
    if (!page?.length) break;
    logs.push(...(page as any));
    if (page.length < PAGE) break;
  }
  if (!logs.length) return 0;

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
      // photo_rejected persons STAY in the roster so they remain visible in the
      // "needs a new photo" report; their ledger rows are forced to `rejected`
      // right after seeding, which keeps them out of every push loop.
      const photoFilter = "biometric_photo_path.not.is.null,biometric_photo_url.not.is.null";
      const [members, employees, trainers] = await Promise.all([
        // Only members whose gate access is currently active carry a face.
        // Blocked/expired/dues members must never be re-pushed with photo
        // payloads — that is what rebuilds face templates and reboots gates.
        // Their access is handled by validity-date-only updates in mips-access.
        supabase.from("members")
          .select("id, mips_person_sn, member_code, mips_sync_status, profiles:user_id(full_name), leads:lead_id(full_name)")
          .eq("branch_id", branchId).eq("hardware_access_status", "active")
          .not("mips_person_id", "is", null).or(photoFilter)
          .neq("mips_sync_status", "revoked")
          .limit(1000),
        supabase.from("employees")
          .select("id, mips_person_sn, employee_code, mips_sync_status, profiles:user_id(full_name)")
          .eq("branch_id", branchId).not("mips_person_id", "is", null).or(photoFilter)
          .neq("mips_sync_status", "revoked")
          .limit(1000),
        supabase.from("trainers")
          .select("id, mips_person_sn, trainer_code, mips_sync_status, profiles:user_id(full_name)")
          .eq("branch_id", branchId).eq("is_active", true)
          .not("mips_person_id", "is", null).or(photoFilter)
          .neq("mips_sync_status", "revoked")
          .limit(1000),
      ]);

      const rejectedSns = [
        ...(members.data || []), ...(employees.data || []), ...(trainers.data || []),
      ].filter((p: any) => p.mips_sync_status === "photo_rejected" && p.mips_person_sn)
       .map((p: any) => String(p.mips_person_sn));

      // The ledger stores the human name (falling back to the code) so every
      // gate screen can say WHO is waiting, not just which code.
      const roster: LedgerPerson[] = [
        ...(members.data || []).map((m: any) => ({
          table: "members" as const, type: "member" as const,
          id: m.id, sn: m.mips_person_sn || "",
          name: m.profiles?.full_name || m.leads?.full_name || m.member_code || null,
        })),
        ...(employees.data || []).map((e: any) => ({
          table: "employees" as const, type: "employee" as const,
          id: e.id, sn: e.mips_person_sn || "",
          name: e.profiles?.full_name || e.employee_code || null,
        })),
        ...(trainers.data || []).map((t: any) => ({
          table: "trainers" as const, type: "trainer" as const,
          id: t.id, sn: t.mips_person_sn || "",
          name: t.profiles?.full_name || t.trainer_code || null,
        })),
      ].filter((p) => !!p.sn);

      await seedLedger(supabase, branchId, branchDevices, roster);
      const pruned = await pruneLedger(supabase, branchId, branchDevices, roster);

      // Keep people with an unusable photo visible on the gate report, but
      // never push them again until a new photo arrives (which resets the
      // person's sync status back to `pending` via the DB trigger).
      if (rejectedSns.length) {
        await supabase
          .from("mips_device_face_state")
          .update({
            state: "rejected",
            reason: "The gate could not build a face template from this photo — a new photo is needed.",
          })
          .eq("branch_id", branchId)
          .in("person_sn", rejectedSns)
          .neq("state", "enrolled");
      }

      // ---- Tier A proof: real face recognition at the gate ------------------
      // If a person has actually been recognised BY FACE on a given gate, that
      // gate demonstrably holds a usable template for them. This is stronger
      // evidence than any counter delta and costs the MIPS server nothing.
      const recognised = await verifyByRecognition(supabase, branchId, branchDevices, roster);

      const ledger = await readLedger(supabase, branchId);

      const outstanding = ledger.filter((r) => r.state === "pending" || r.state === "missing");
      const rejected = ledger.filter((r) => r.state === "rejected");
      const unverified = ledger.filter((r) => r.state === "unverified");
      // Unverified is bookkeeping uncertainty, not permission to rebuild a
      // template. Recognition events can still promote these rows to enrolled.
      const verifyDue: typeof unverified = [];

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
      const stillOutstanding = settled.filter(
        (r) =>
          r.state === "pending" ||
          r.state === "missing",
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

        // Delivery truth comes from the MIPS push ledger, never from a device
        // photo counter. `/personInfo/authedLog/list` reports pushStatus per
        // (person, gate): 0 queued, 1 pushing, 2 delivered — plus the exact
        // failure message when a gate refuses the template.
        await sleep(SETTLE_MS);
        const state = await readPushState(baseUrl, token);

        for (const r of rows) {
          const entry = state.get(`${personSn}::${r.mips_device_id}`);
          if (entry?.pushStatus === "delivered") {
            enrolledNow++;
            await markEnrolled(supabase, branchId, r.mips_device_id, personSn);
          } else if (entry?.failureMessage) {
            stalled++;
            const isFaceError =
              entry.failureMessage.includes("unqualified face data") ||
              entry.failureMessage.includes("FacePassHandler") ||
              entry.failureMessage.includes("person is null");
            // Face-related failures mean the photo itself is unusable — force
            // the ledger row straight to `rejected` (REJECT_AFTER_ATTEMPTS as
            // the attempts value trips the threshold on this pass) and mark
            // the person photo_rejected so neither this sweep nor the
            // sync-to-mips delta mode ever re-uploads that photo.
            await markAttempt(
              supabase, branchId, r.mips_device_id, personSn,
              isFaceError ? REJECT_AFTER_ATTEMPTS : r.attempts,
              `Gate rejected the template: ${entry.failureMessage}`,
            );
            if (isFaceError && r.person_id) {
              const tbl =
                r.person_type === "member"
                  ? "members"
                  : r.person_type === "employee"
                  ? "employees"
                  : "trainers";
              await supabase.from(tbl)
                .update({ mips_sync_status: "photo_rejected" })
                .eq("id", r.person_id);
              if (notes.length < 10) {
                notes.push(`${personSn} → photo_rejected (gate face error)`);
              }
            }
          } else {
            // Queued or still pushing — normal, the gate drains asynchronously.
            stalled++;
            await supabase
              .from("mips_device_face_state")
              .update({
                last_attempt_at: new Date().toISOString(),
                reason: entry
                  ? `Accepted by MIPS, ${entry.pushStatus} to the gate — awaiting delivery`
                  : "Accepted by MIPS, no ledger entry yet — awaiting delivery",
              })
              .eq("branch_id", branchId)
              .eq("mips_device_id", r.mips_device_id)
              .eq("person_sn", personSn);
          }
        }
      }
      counts = await readDeviceCounts(baseUrl, token).catch(() => counts);


      const finalLedger = await readLedger(supabase, branchId);
      summary.push({
        branch_id: branchId,
        expected: roster.length,
        recognised,
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
