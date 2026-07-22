// v1.0.0 — Reconcile MIPS device membership: for every branch that has ≥2
// online access_devices with a mips_device_id, re-issue syncPerson for each
// person that has a mips_person_id, so anyone who missed a sync while a
// device was offline is re-pushed. Idempotent on the MIPS side.
//
// Invoked by the automation-brain cron every ~15 min (rule
// `mips_reconcile_devices`).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PER_RUN_CAP = 100; // per-branch cap to bound edge-fn runtime

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

      // 2. Pull all synced members + employees for this branch.
      const [{ data: members }, { data: employees }] = await Promise.all([
        supabase
          .from("members")
          .select("id, mips_person_id")
          .eq("branch_id", branchId)
          .not("mips_person_id", "is", null)
          .limit(PER_RUN_CAP),
        supabase
          .from("employees")
          .select("id, mips_person_id")
          .eq("branch_id", branchId)
          .not("mips_person_id", "is", null)
          .limit(PER_RUN_CAP),
      ]);

      const persons = [
        ...((members || []).map((m: any) => ({ type: "member", personId: Number(m.mips_person_id) }))),
        ...((employees || []).map((e: any) => ({ type: "employee", personId: Number(e.mips_person_id) }))),
      ].filter((p) => !isNaN(p.personId));

      let ok = 0, failed = 0;
      for (const p of persons) {
        try {
          const { data, error } = await supabase.functions.invoke("mips-proxy", {
            body: {
              endpoint: "/through/device/syncPerson",
              method: "POST",
              data: { personId: p.personId, deviceIds, deviceNumType: "4" },
              branch_id: branchId,
            },
          });
          const isOk = !error && (data as any)?.success && ((data as any)?.data?.code === 200 || (data as any)?.data?.code === 0);
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

      summary.push({ branch_id: branchId, devices: deviceIds.length, persons: persons.length, ok, failed });
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
