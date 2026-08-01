// v1.5.0 — Drain biometric_sync_queue in bounded batches of five.
// dispatch, and only marks a row succeeded when the face photo uploaded and
// at least one gate received the person. Failures keep retry_count + reason
// from the Personnel Sync tab.
//
// v1.5.0 separates transport failures (MIPS server rebooting / unreachable)
// from data failures. Transport failures reschedule the row WITHOUT consuming
// its retry budget and trip the shared circuit breaker, so a server outage can
// no longer exhaust the queue and permanently fail everyone in it.
//
// Invoked by the automation-brain cron every ~5 min under rule
// `process_biometric_sync_queue`, and on-demand from the "Heal drift" button
// on the Device Command Center dashboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyFailure,
  isTripped,
  readBreaker,
  recordSuccess,
  recordTransportFailure,
} from "../_shared/mipsHealth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 10;
const PER_RUN_CAP = 5;
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
      .select("id, member_id, staff_id, person_uuid, person_type, device_id, sync_type, retry_count, queued_at, processed_at, status")
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

    // Queue rows carry no branch, so honour any open breaker: if MIPS is known
    // unreachable, leave the rows untouched rather than burning their retries.
    const { data: breakerRows } = await supabase
      .from("settings")
      .select("branch_id, value")
      .eq("key", "mips_breaker");
    const openBreaker = (breakerRows || []).find((b: any) =>
      isTripped({
        open: Boolean(b?.value?.open),
        open_until: b?.value?.open_until ?? null,
        consecutive_failures: 0,
        opens: 0,
        last_error: b?.value?.last_error ?? null,
        last_failure_at: null,
        last_success_at: null,
      })
    );
    if (openBreaker && dueRows.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          paused: true,
          reason: "MIPS server unreachable — queue paused, auto-resuming",
          resumes_at: (openBreaker as any).value?.open_until ?? null,
          last_error: (openBreaker as any).value?.last_error ?? null,
          waiting: dueRows.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let ok = 0, failed = 0, skipped = 0, deferred = 0;

    for (const row of dueRows) {
      const personId = (row as any).person_uuid || (row as any).member_id || (row as any).staff_id;
      const personType = (row as any).person_type
        || ((row as any).member_id ? "member" : (row as any).staff_id ? "employee" : null);
      if (!personId || !personType) {
        await supabase
          .from("biometric_sync_queue")
          .update({
            status: "failed",
            error_message: "queue row has no resolvable person identity",
            retry_count: ((row as any).retry_count || 0) + 1,
          })
          .eq("id", (row as any).id);
        skipped++;
        continue;
      }
      try {
        // Call sync-to-mips as service_role — the queue drainer has no user JWT,
        // so the default anon bearer would be rejected by sync-to-mips' auth gate.
        const invokeRes = await fetch(`${SUPA_URL}/functions/v1/sync-to-mips`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "apikey": SERVICE_KEY,
          },
          body: JSON.stringify({
            person_type: personType,
            person_id: personId,
            // Always fan out to devices from the queue — the previous
            // "server_only" hand-off had no owner and left people registered
            // on the MIPS server but absent from Gate 1 / Gate 2.
            deploy_to_devices: true,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        const invText = await invokeRes.text();
        let data: any = null;
        try { data = JSON.parse(invText); } catch { data = { raw: invText }; }
        const invErr = invokeRes.ok ? null : { message: `HTTP ${invokeRes.status}: ${invText.slice(0, 200)}` };
        // A row only counts as done when the person landed, the face photo
        // uploaded AND at least one device received the dispatch.
        const dispatched = Array.isArray(data?.dispatched_device_ids) ? data.dispatched_device_ids : [];
        const photoOk = data?.photo_uploaded === true;
        const revoked = data?.action === "revoked_instead_of_synced";
        const requested = Array.isArray(data?.requested_device_ids) ? data.requested_device_ids : [];
        const allDevicesDelivered = requested.length > 0 && dispatched.length === requested.length;
        const success = !invErr && data?.success !== false && (revoked || (photoOk && allDevicesDelivered));
        const partialReason = invErr?.message
          || data?.error
          || (!photoOk ? `photo not uploaded: ${data?.photo_result?.message || "unknown"}` : "")
          || (!allDevicesDelivered ? `device delivery incomplete: ${dispatched.length}/${requested.length}` : "")
          || "sync-to-mips returned failure";

        if (success) {
          await supabase
            .from("biometric_sync_queue")
            .update({
              status: "succeeded",
              error_message: null,
              processed_at: new Date().toISOString(),
            })
            .eq("id", (row as any).id);
          await recordSuccess(supabase, null);
          ok++;
        } else if (classifyFailure({ status: invokeRes.status, message: partialReason }) === "transport") {
          // Server-side outage: reschedule without consuming the retry budget.
          await recordTransportFailure(supabase, null, partialReason);
          await supabase
            .from("biometric_sync_queue")
            .update({
              status: "pending",
              error_message: `deferred (MIPS unreachable): ${partialReason}`,
              processed_at: new Date().toISOString(),
            })
            .eq("id", (row as any).id);
          deferred++;
        } else {
          const nextRetry = ((row as any).retry_count || 0) + 1;
          await supabase
            .from("biometric_sync_queue")
            .update({
              status: nextRetry >= MAX_RETRIES ? "failed" : "pending",
              error_message: partialReason,
              retry_count: nextRetry,
              processed_at: new Date().toISOString(),
            })

            .eq("id", (row as any).id);
          failed++;
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (classifyFailure({ message: msg }) === "transport") {
          await recordTransportFailure(supabase, null, msg);
          await supabase
            .from("biometric_sync_queue")
            .update({
              status: "pending",
              error_message: `deferred (MIPS unreachable): ${msg}`,
              processed_at: new Date().toISOString(),
            })
            .eq("id", (row as any).id);
          deferred++;
          continue;
        }
        const nextRetry = ((row as any).retry_count || 0) + 1;
        await supabase
          .from("biometric_sync_queue")
          .update({
            status: nextRetry >= MAX_RETRIES ? "failed" : "pending",
            error_message: msg,
            retry_count: nextRetry,
          })
          .eq("id", (row as any).id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: dueRows.length, picked: rows?.length || 0, ok, failed, skipped, deferred }),
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
