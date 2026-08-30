// v2.3.0 — Drift-driven, quiet-hours-aware reconciliation across members,
// employees and trainers.
//
// v2.2.0 rotated blindly through the roster and re-pushed 3 people (person +
// photo + syncPerson to every gate) every 15 minutes, 24x7, forever. That is
// ~576 dispatches/day of pure no-op traffic and makes the terminals rebuild
// face templates round the clock.
//
// v2.3.0 only dispatches a person when there is real DRIFT: no successful
// `device_dispatch` recorded for every mapped device since that person last
// changed. People already in sync are skipped for free, and during quiet hours
// (23:00-06:00 IST) nothing speculative is pushed at all.
//
// Invoked by the automation-brain cron every ~15 min (rule
// `mips_reconcile_devices`).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PER_RUN_CAP = 3;
const INVOCATION_BUDGET_MS = 45_000;
// Roster entries examined per run. Examining is a cheap local comparison; only
// genuine drift is turned into a device dispatch.
const SCAN_WINDOW = 60;
// Safety net: even a perfectly in-sync person is re-proven this often.
const MAX_SYNC_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** 23:00-06:00 IST — gym closed, no speculative device traffic. */
function isQuietHourIST(now = new Date()): boolean {
  const istHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  return istHour >= 23 || istHour < 6;
}

const ts = (v: unknown): number => (v ? Date.parse(String(v)) : 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const force = Boolean((body as any)?.force);
    const runStartedAt = Date.now();

    if (isQuietHourIST() && !force) {
      return new Response(
        JSON.stringify({ success: true, skipped: "quiet_hours_ist", branches: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Load all MAPPED devices grouped by branch (include offline — MIPS
    //    server queues syncs for offline devices and delivers on reconnect).
    const { data: devices, error: devErr } = await supabase
      .from("access_devices")
      .select("id, branch_id, mips_device_id, device_name, is_online")
      .not("mips_device_id", "is", null);
    if (devErr) throw devErr;

    const byBranch = new Map<string, Array<{ localId: string; mipsId: number }>>();
    for (const d of devices || []) {
      const list = byBranch.get((d as any).branch_id) || [];
      list.push({ localId: (d as any).id, mipsId: Number((d as any).mips_device_id) });
      byBranch.set((d as any).branch_id, list);
    }

    const summary: Array<Record<string, unknown>> = [];

    for (const [branchId, brDevices] of byBranch.entries()) {
      if (brDevices.length < 2) continue; // only multi-device branches

      const deviceIds = brDevices.map((d) => d.mipsId);
      const localDeviceIds = brDevices.map((d) => d.localId);

      // 2. Build the complete branch roster, including trainers.
      const cols = "id, mips_person_id, updated_at, biometric_updated_at";
      const [{ data: members }, { data: employees }, { data: trainers }] = await Promise.all([
        supabase.from("members").select(cols)
          .eq("branch_id", branchId).not("mips_person_id", "is", null),
        supabase.from("employees").select(cols)
          .eq("branch_id", branchId).not("mips_person_id", "is", null),
        supabase.from("trainers").select(cols)
          .eq("branch_id", branchId).eq("is_active", true).not("mips_person_id", "is", null),
      ]);

      const roster = [
        ...((members || []).map((m: any) => ({ type: "member", ...m }))),
        ...((employees || []).map((e: any) => ({ type: "employee", ...e }))),
        ...((trainers || []).map((t: any) => ({ type: "trainer", ...t }))),
      ].map((p: any) => ({
        type: p.type as string,
        id: p.id as string,
        changedAt: Math.max(ts(p.updated_at), ts(p.biometric_updated_at)),
      }));

      // 3. Advance a rotating SCAN window (cheap: local comparison only).
      const windowNo = Math.floor(Date.now() / (15 * 60_000));
      const start = roster.length > 0 ? (windowNo * SCAN_WINDOW) % roster.length : 0;
      const scanned = Array.from(
        { length: Math.min(SCAN_WINDOW, roster.length) },
        (_, index) => roster[(start + index) % roster.length],
      );

      // 4. Last successful device_dispatch per (person, device).
      const { data: attempts } = await supabase
        .from("mips_sync_attempts")
        .select("entity_id, device_id, created_at")
        .eq("operation", "device_dispatch")
        .eq("status", "success")
        .in("device_id", localDeviceIds)
        .in("entity_id", scanned.map((p) => p.id))
        .order("created_at", { ascending: false })
        .limit(5000);

      const lastOk = new Map<string, number>(); // `${entity}|${device}` → epoch
      for (const a of attempts || []) {
        const key = `${(a as any).entity_id}|${(a as any).device_id}`;
        const t = ts((a as any).created_at);
        if (t > (lastOk.get(key) ?? 0)) lastOk.set(key, t);
      }

      // 5. Drift = any device without a successful dispatch after the person's
      //    last change (or with no dispatch at all / a very stale one).
      const now = Date.now();
      const drifted = scanned.filter((p) =>
        localDeviceIds.some((dev) => {
          const seen = lastOk.get(`${p.id}|${dev}`) ?? 0;
          return seen === 0 || seen < p.changedAt || now - seen > MAX_SYNC_AGE_MS;
        })
      );

      const persons = drifted.slice(0, PER_RUN_CAP);

      let ok = 0, failed = 0;
      for (const p of persons) {
        if (Date.now() - runStartedAt >= INVOCATION_BUDGET_MS) break;
        try {
          const res = await fetch(`${SUPA_URL}/functions/v1/sync-to-mips`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
            body: JSON.stringify({ person_type: p.type, person_id: p.id, branch_id: branchId, deploy_to_devices: true }),
            signal: AbortSignal.timeout(20_000),
          });
          const data = await res.json().catch(() => ({}));
          const isOk = res.ok && data?.success === true && Array.isArray(data?.dispatched_device_ids)
            && data.dispatched_device_ids.length === deviceIds.length;
          if (isOk) ok++; else failed++;
        } catch {
          failed++;
        }
      }

      // 6. Stamp last_reconcile_at on all branch devices.
      await supabase
        .from("access_devices")
        .update({ last_reconcile_at: new Date().toISOString() })
        .in("id", localDeviceIds);

      summary.push({
        branch_id: branchId,
        devices: deviceIds.length,
        roster: roster.length,
        offset: start,
        scanned: scanned.length,
        drifted: drifted.length,
        processed: ok + failed,
        ok,
        failed,
      });
    }

    console.log(`[mips-reconcile-devices] ${JSON.stringify(summary)}`);
    return new Response(JSON.stringify({ success: true, branches: summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[mips-reconcile-devices] fatal:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
