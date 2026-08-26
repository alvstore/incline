// process-comm-retry-queue v3.0.0
// v3.0.0: PHASE 4 + 7 — never fabricate success, one shared Meta policy.
//          • Parked `awaiting_confirmation` rows with no provider callback now
//            close as `unknown`, NOT `succeeded`. Elapsed time is not evidence.
//          • All terminal / retryable / cooldown decisions come from
//            `_shared/metaErrorPolicy.ts`. No local Meta code tables.
// v2.8.0: Missing template variables are repairable. The dispatcher now
//          hydrates canonical member/branch data, so manual restarts and worker
//          retries must be allowed to replay old template_param_empty rows.
// v2.7.0: Meta acceptance ≠ delivery. WhatsApp retries park in
//          `awaiting_confirmation` until a webhook callback promotes them to
//          `succeeded` or marks them `terminal` (131049/failure).


// v2.6.0: Meta 131049 pacing failures are terminal for the current message.
//          Retrying the identical template/recipient payload worsens quality.
// v2.5.0: terminal template contract failures never retry; cap each worker run
//          at 10 rows to avoid nested edge-function compute fan-out.
// v2.3.0: Soft-terminal Meta codes — 131000 ("something went wrong") is transient
//          but flaky Meta backends can loop it. Cap after 1 retry: on the SECOND
//          occurrence for the same queue row we mark exhausted instead of a 3rd try.
//          Meta error codes immediately abandons the queue row (status='exhausted')
//          with no further retries:
//            • no_active_session_no_template
//            • no_template_for_closed_session
//            • template_not_approved / template_stale_in_meta
//            • do_not_contact / member_pref_opt_out / preference_block
//            • invalid_recipient_phone / recipient_unreachable
//            • Meta codes: 131026, 131047, 131051, 132000, 132001, 132012, 133010
//          Also: hard cap at row.max_retries (default 3); enforce before reschedule.
//          When a recipient hits 3 terminal failures in 24h, auto-mark
//          do_not_contact via mark_do_not_contact RPC so future automation skips.
// v2.1.0: Treat dispatcher `suppressed` as TERMINAL.
// v2.0.0: Always retry through dispatch-communication.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BACKOFF_MINUTES,
  classifyMetaError,
  extractMetaCode,
  isTerminal,
} from "../_shared/metaErrorPolicy.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Phase 7/8: terminal/retry/backoff decisions come from the shared Meta policy.


// Reason substrings (non-Meta, dispatcher contract failures) that abandon the
// retry row immediately. Meta codes are NOT listed here — they come from the
// shared policy module.
const TERMINAL_REASON_PATTERNS: RegExp[] = [
  /no_active_session_no_template/i,
  /no_template_for_closed_session/i,
  /template_not_approved/i,
  /template_stale/i,
  /template_missing/i,
  /missing_template/i,
  /do_not_contact/i,
  /member_pref_opt_out/i,
  /preference_block/i,
  /channel_disabled_in_settings/i,
  /invalid_recipient/i,
  /recipient_unreachable/i,
];

// Transient Meta codes that must still be capped after one retry.
const SOFT_TERMINAL_META_CODES = new Set(["131000", "133000"]);

function isTerminalReason(reason: string | null | undefined, retryCount = 0): boolean {
  if (!reason) return false;
  const s = String(reason);
  if (TERMINAL_REASON_PATTERNS.some((re) => re.test(s))) return true;
  const code = extractMetaCode(s);
  if (!code) return false;
  const pol = classifyMetaError({ code });
  if (isTerminal(pol)) return true;
  if (SOFT_TERMINAL_META_CODES.has(code) && retryCount >= 1) return true;
  return false;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let manualId: string | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        manualId = body?.queue_id || null;
      }
    } catch { /* ignore */ }

    // v3.0.0 (Phase 4): a parked row with no provider callback is NOT a success.
    // Close it as `unknown` — never `succeeded` — and never re-attempt it.
    await supabase
      .from("communication_retry_queue")
      .update({ status: "unknown", last_error: "no provider confirmation within 6h — outcome unknown" })
      .eq("status", "awaiting_confirmation")
      .lt("updated_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .then(() => {}, () => {});



    let query = supabase
      .from("communication_retry_queue")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", new Date().toISOString())
      .order("next_retry_at", { ascending: true })
      .limit(10);

    if (manualId) {
      query = supabase
        .from("communication_retry_queue")
        .select("*")
        .eq("id", manualId);
    }

    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return json({ success: true, processed: 0, message: "No pending retries" });
    }

    const results: any[] = [];

    for (const row of rows) {
      // ── Pre-flight: hard cap on retries (defends against rows that already
      //              exceed max_retries due to legacy data).
      if ((row.retry_count || 0) >= (row.max_retries || 3)) {
        await supabase
          .from("communication_retry_queue")
          .update({ status: "exhausted", last_error: row.last_error || "max_retries_reached" })
          .eq("id", row.id);
        results.push({ id: row.id, status: "exhausted", reason: "max_retries_reached" });
        continue;
      }

      // ── Pre-flight: if the previous error reason is terminal, abandon now.
      if (isTerminalReason(row.last_error, row.retry_count || 0)) {
        await supabase
          .from("communication_retry_queue")
          .update({ status: "exhausted" })
          .eq("id", row.id);
        results.push({ id: row.id, status: "exhausted", reason: "terminal_previous_error" });
        continue;
      }

      await supabase
        .from("communication_retry_queue")
        .update({ status: "processing" })
        .eq("id", row.id)
        .eq("status", row.status);

      // Resolve original log to recover category/attachment when present
      let category: string | null = null;
      let attachment: any = null;
      // v2.4.0: replay the ORIGINAL variable bag (incl. `event_key`). Dropping
      // it made every retry unresolvable to a template, so welcome/plan
      // messages died with `no_template_for_closed_session`.
      let payloadVariables: Record<string, unknown> | undefined = undefined;
      const useBranded = true;


      if (row.original_log_id) {
        const { data: log } = await supabase
          .from("communication_logs")
          .select("category, delivery_metadata")
          .eq("id", row.original_log_id)
          .maybeSingle();
        if (log) {
          category = (log as any).category ?? null;
          const meta = ((log as any).delivery_metadata ?? {}) as Record<string, any>;
          if (meta.attachment) attachment = meta.attachment;
          if (meta.variables && typeof meta.variables === "object") {
            payloadVariables = { ...(meta.variables as Record<string, unknown>) };
          }
          if (meta.event_key && payloadVariables && !payloadVariables.event_key) {
            payloadVariables.event_key = meta.event_key;
          }
        }
      }
      // Fallback to retry-queue.metadata copy of delivery_metadata
      const meta = (row.metadata ?? {}) as Record<string, any>;
      if (!category && meta.category) category = meta.category;
      if (!attachment && meta.attachment) attachment = meta.attachment;
      if (!payloadVariables && meta.variables && typeof meta.variables === "object") {
        payloadVariables = { ...(meta.variables as Record<string, unknown>) };
      }
      if (meta.event_key) {
        payloadVariables = { ...(payloadVariables ?? {}), event_key: meta.event_key };
      }

      if (!category) {
        category = "transactional";
      }


      const dispatchPayload: Record<string, unknown> = {
        branch_id: row.branch_id,
        channel: row.type,                   // whatsapp | sms | email
        category,
        recipient: row.recipient,
        member_id: row.member_id ?? null,
        template_id: row.template_id ?? null,
        payload: {
          subject: row.subject ?? undefined,
          body: row.content ?? "",
          variables: payloadVariables,
          use_branded_template: row.type === "email" ? useBranded : undefined,
        },
        // Fresh dedupe key so the retry doesn't collide with the failed log row
        dedupe_key: `retry:${row.id}:${row.retry_count + 1}`,
        // Replays must still honor preferences, DNC and pacing safeguards.
        force: false,
        attachment: attachment ?? undefined,
        source_caller: "process-comm-retry-queue",
      };

      let success = false;
      let errorMsg = "";
      let dispatchReason: string | undefined;
      let dispatchStatus: string | undefined;
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-communication`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify(dispatchPayload),
        });
        const text = await resp.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        dispatchStatus = parsed?.status;
        dispatchReason = parsed?.reason;
        if (resp.ok && (dispatchStatus === "sent" || dispatchStatus === "queued" || dispatchStatus === "deduped")) {
          success = true;
        } else if (resp.ok && dispatchStatus === "suppressed") {
          // Channel kill-switch, preference block, or no-template-for-closed-session.
          await supabase
            .from("communication_retry_queue")
            .update({
              status: "exhausted",
              retry_count: (row.retry_count || 0) + 1,
              last_error: dispatchReason || "suppressed",
            })
            .eq("id", row.id);
          results.push({ id: row.id, status: "suppressed", reason: dispatchReason });
          continue;
        } else {
          errorMsg = `dispatch ${resp.status}: ${dispatchReason || parsed?.error || text.slice(0, 300)}`;
        }
      } catch (e) {
        errorMsg = `dispatch error: ${e instanceof Error ? e.message : String(e)}`;
      }

      const newRetryCount = (row.retry_count || 0) + 1;

      if (success) {
        // v2.7.0: Meta ACCEPTING a request is not delivery. WhatsApp rows park in
        // `awaiting_confirmation`; the webhook promotes them to `succeeded` on a
        // delivered/read callback, or to `terminal` on 131049/failure — so a paced
        // message can never be re-attempted by this worker.
        const parked = row.type === "whatsapp" && dispatchStatus === "sent";
        await supabase
          .from("communication_retry_queue")
          .update({
            status: parked ? "awaiting_confirmation" : "succeeded",
            retry_count: newRetryCount,
            succeeded_at: parked ? null : new Date().toISOString(),
            last_error: null,
          })
          .eq("id", row.id);
        if (row.original_log_id) {
          await supabase
            .from("communication_logs")
            .update({ status: "sent", attempt_count: newRetryCount + 1 })
            .eq("id", row.original_log_id);
        }
        results.push({ id: row.id, status: parked ? "awaiting_confirmation" : "succeeded", attempts: newRetryCount });
      } else {

        // Terminal reason in the fresh error → abandon now (no reschedule).
        const terminal = isTerminalReason(errorMsg, newRetryCount) || newRetryCount >= (row.max_retries || 3);
        if (terminal) {
          await supabase
            .from("communication_retry_queue")
            .update({ status: "exhausted", retry_count: newRetryCount, last_error: errorMsg })
            .eq("id", row.id);

          // Auto-flag recipient as do_not_contact when they accumulate 3+ terminal
          // failures in 24h. This stops automation from filling the queue again.
          const recipientTerminal = /recipient_unreachable|invalid_recipient|\b131026\b|\b131051\b|\b133010\b/i.test(errorMsg);
          if (recipientTerminal && row.recipient && (row.type === "whatsapp" || row.type === "sms")) {
            try {
              const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
              const { count } = await supabase
                .from("communication_retry_queue")
                .select("id", { count: "exact", head: true })
                .eq("recipient", row.recipient)
                .eq("status", "exhausted")
                .gte("updated_at", since);
              if ((count ?? 0) >= 3) {
                await supabase.rpc("mark_do_not_contact" as any, {
                  p_phone: row.recipient,
                  p_reason: "auto_3_terminal_failures_24h",
                } as any).then(
                  () => {},
                  (e: unknown) => console.warn("mark_do_not_contact failed:", e),
                );
              }
            } catch (e) {
              console.warn("do_not_contact auto-flag check failed:", e);
            }
          }

          results.push({ id: row.id, status: "exhausted", error: errorMsg });
        } else {
          const backoffMin = BACKOFF_MINUTES[Math.min(newRetryCount, BACKOFF_MINUTES.length - 1)];
          const nextAt = new Date(Date.now() + backoffMin * 60_000).toISOString();
          await supabase
            .from("communication_retry_queue")
            .update({
              status: "pending",
              retry_count: newRetryCount,
              next_retry_at: nextAt,
              last_error: errorMsg,
            })
            .eq("id", row.id);
          results.push({ id: row.id, status: "rescheduled", next_retry_at: nextAt, attempts: newRetryCount });
        }
      }
    }

    return json({ success: true, processed: rows.length, results });
  } catch (e) {
    console.error("process-comm-retry-queue error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
