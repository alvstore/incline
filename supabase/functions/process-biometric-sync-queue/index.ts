// v1.0.0 — Drain biometric_sync_queue: retries stuck photo_upload and add
// rows by re-invoking sync-to-mips (server-only). Marks rows succeeded /
// failed with retry_count + error_message so operators can see progress
// from the Personnel Sync tab.
//
// Invoked by the automation-brain cron every ~5 min under rule
// `process_biometric_sync_queue`, and on-demand from the "Heal drift" button
// on the Device Command Center dashboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 10;
const PER_RUN_CAP = 50;
// Exponential backoff (minutes) applied against queued_at + processed_at.
// retry 1→1m, 2→2m, 3→5m, 4→15m, 5→60m, 6→180m, cap 360m.
const BACKOFF_MIN = [0, 1, 2, 5, 15, 60, 180, 360, 360, 360, 360];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPA_URL, SERVICE_KEY);

  try {
    // Pick up pending rows AND failed rows that are ready for another attempt
    // (retry_count still below MAX_RETRIES and backoff window elapsed).
    const { data: rows, error } = await supabase
      .from("biometric_sync_queue")
      .select("id, member_id, staff_id, device_id, sync_type, retry_count, queued_at, processed_at, status")
      .in("status", ["pending", "failed"])
      .lt("retry_count", MAX_RETRIES)
      .order("queued_at", { ascending: true })
      .limit(PER_RUN_CAP);
    if (error) throw error;

    const now = Date.now();
    const dueRows = (rows || []).filter((r: any) => {
      if (r.status === "pending" && (r.retry_count || 0) === 0) return true;
      const waitMin = BACKOFF_MIN[Math.min(r.retry_count || 0, BACKOFF_MIN.length - 1)];
      const anchorTs = new Date(r.processed_at || r.queued_at).getTime();
      return anchorTs + waitMin * 60_000 <= now;
    });

    console.log(`[process-biometric-sync-queue] picked=${rows?.length || 0} due=${dueRows.length}`);

    let ok = 0, failed = 0, skipped = 0;
    for (const row of dueRows) {
      const personId = (row as any).member_id || (row as any).staff_id;
      if (!personId) {
        await supabase
          .from("biometric_sync_queue")
          .update({
            status: "failed",
            error_message: "no member_id/staff_id on queue row",
            retry_count: ((row as any).retry_count || 0) + 1,
          })
          .eq("id", (row as any).id);
        skipped++;
        continue;
      }
      const personType = (row as any).member_id ? "member" : "employee";

      try {
        const { data, error: invErr } = await supabase.functions.invoke("sync-to-mips", {
          body: {
            person_type: personType,
            person_id: personId,
            server_only: true,
          },
        });
        const success = !invErr && (data as any)?.success !== false;
        if (success) {
          await supabase
            .from("biometric_sync_queue")
            .update({
              status: "succeeded",
              error_message: null,
              processed_at: new Date().toISOString(),
            })
            .eq("id", (row as any).id);
          ok++;
        } else {
          const nextRetry = ((row as any).retry_count || 0) + 1;
          await supabase
            .from("biometric_sync_queue")
            .update({
              status: nextRetry >= MAX_RETRIES ? "failed" : "pending",
              error_message: invErr?.message || (data as any)?.error || "sync-to-mips returned failure",
              retry_count: nextRetry,
            })
            .eq("id", (row as any).id);
          failed++;
        }
      } catch (e: any) {
        const nextRetry = ((row as any).retry_count || 0) + 1;
        await supabase
          .from("biometric_sync_queue")
          .update({
            status: nextRetry >= MAX_RETRIES ? "failed" : "pending",
            error_message: e?.message || String(e),
            retry_count: nextRetry,
          })
          .eq("id", (row as any).id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: dueRows.length, picked: rows?.length || 0, ok, failed, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[process-biometric-sync-queue] fatal:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
