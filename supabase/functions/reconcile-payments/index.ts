// reconcile-payments v1.1.0 — proper PostgrestError serialisation so the
// Automation Brain logs a useful message instead of "[object Object]".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCaller } from "../_shared/requireCaller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((x) => x !== null && x !== undefined && x !== "")
      .map(String);
    if (parts.length) return parts.join(" | ");
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return String(err);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  { const __caller = await requireCaller(req, corsHeaders, { roles: [] }); if (!__caller.ok) return __caller.response; }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("reconcile_payments_daily");
    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: formatError(error) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, summary: data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: formatError(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
