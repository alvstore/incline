// v2.0.0 — Resumable, bounded reconciliation across members, employees and
// trainers. Each run advances a rotating roster window and delegates the full
// server + photo + per-device audited delivery to sync-to-mips. The rotating
// window bounds runtime while eventually healing the complete branch roster.
//
// Invoked by the automation-brain cron every ~15 min (rule
// `mips_reconcile_devices`).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PER_RUN_CAP = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  try {
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

      // 2. Build the complete branch roster, including trainers.
      const [{ data: members }, { data: employees }, { data: trainers }] = await Promise.all([
        supabase
          .from("members")
          .select("id, mips_person_id")
          .eq("branch_id", branchId)
          .not("mips_person_id", "is", null),
        supabase
          .from("employees")
          .select("id, mips_person_id")
          .eq("branch_id", branchId)
          .not("mips_person_id", "is", null),
        supabase
          .from("trainers")
          .select("id, mips_person_id")
          .eq("branch_id", branchId)
          .eq("is_active", true)
          .not("mips_person_id", "is", null),
      ]);

      const roster = [
        ...((members || []).map((m: any) => ({ type: "member", id: m.id }))),
        ...((employees || []).map((e: any) => ({ type: "employee", id: e.id }))),
        ...((trainers || []).map((t: any) => ({ type: "trainer", id: t.id }))),
      ];
      const windowNo = Math.floor(Date.now() / (15 * 60_000));
      const start = roster.length > 0 ? (windowNo * PER_RUN_CAP) % roster.length : 0;
      const persons = Array.from(
        { length: Math.min(PER_RUN_CAP, roster.length) },
        (_, index) => roster[(start + index) % roster.length],
      );

      let ok = 0, failed = 0;
      for (const p of persons) {
        try {
          const res = await fetch(`${SUPA_URL}/functions/v1/sync-to-mips`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
            body: JSON.stringify({ person_type: p.type, person_id: p.id, branch_id: branchId, deploy_to_devices: true }),
          });
          const data = await res.json().catch(() => ({}));
          const isOk = res.ok && data?.success === true && Array.isArray(data?.dispatched_device_ids)
            && data.dispatched_device_ids.length === deviceIds.length;
          if (isOk) ok++; else failed++;
        } catch {
          failed++;
        }
      }

      // 3. Stamp last_reconcile_at on all branch devices.
      await supabase
        .from("access_devices")
        .update({ last_reconcile_at: new Date().toISOString() })
        .in("id", brDevices.map((d) => d.localId));

      summary.push({ branch_id: branchId, devices: deviceIds.length, roster: roster.length, offset: start, processed: persons.length, ok, failed });
    }

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
