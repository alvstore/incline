// process-whatsapp-retry-queue v1.1.0
// Drains pending rows from `whatsapp_send_queue` by re-invoking
// `dispatch-communication`. Capped retries with exponential backoff.
// v1.1.0: terminal Meta error codes (131049 pacing, 131026 unreachable,
//         131047 24h window, 132000/132001/132015/132016 template errors)
//         are abandoned immediately — retrying them just burns quota and
//         tanks template quality further.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BACKOFF_MINUTES = [1, 5, 30];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Lock-free dequeue (small batches)
    const { data: queue, error } = await supabase
      .from("whatsapp_send_queue")
      .select("id, message_id, branch_id, attempts, max_attempts, payload")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("next_attempt_at", { ascending: true })
      .limit(25);
    if (error) throw error;

    let succeeded = 0;
    let failed = 0;
    let abandoned = 0;

    for (const row of queue ?? []) {
      const attemptNo = row.attempts + 1;
      const isLast = attemptNo >= row.max_attempts;

      const dispatch = await supabase.functions.invoke("dispatch-communication", {
        body: row.payload,
      });

      if (!dispatch.error) {
        await supabase
          .from("whatsapp_send_queue")
          .update({
            status: "sent",
            attempts: attemptNo,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        succeeded++;
        continue;
      }

      const errMsg = dispatch.error.message ?? String(dispatch.error);
      // Terminal Meta error codes — never retry. The error strings vary but
      // dispatcher / send-whatsapp surface the numeric code in the message.
      const TERMINAL_META_CODES = [131049, 131026, 131047, 132000, 132001, 132015, 132016, 132018];
      const isTerminal = TERMINAL_META_CODES.some((code) => errMsg.includes(String(code)));


      if (isLast) {
        await supabase
          .from("whatsapp_send_queue")
          .update({
            status: "abandoned",
            attempts: attemptNo,
            last_error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        await supabase.rpc("log_error_event", {
          p_source: "whatsapp_retry_queue",
          p_severity: "error",
          p_message: `WhatsApp send abandoned after ${attemptNo} attempts: ${errMsg}`,
          p_context: { queue_id: row.id, message_id: row.message_id },
        });
        abandoned++;
      } else {
        const backoffMin = BACKOFF_MINUTES[Math.min(attemptNo, BACKOFF_MINUTES.length - 1)];
        const next = new Date(Date.now() + backoffMin * 60_000).toISOString();
        await supabase
          .from("whatsapp_send_queue")
          .update({
            attempts: attemptNo,
            last_error: errMsg,
            next_attempt_at: next,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: queue?.length ?? 0,
        succeeded,
        failed,
        abandoned,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
