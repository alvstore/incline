// v1.0.0 — Backward-compat router. Forwards to send-meta-dm or send-whatsapp.
// Older code paths may still POST to /functions/v1/send-message; this keeps
// them working without re-deploying every caller.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const platform = String(body.platform || "whatsapp").toLowerCase();
    const isMetaDm = platform === "instagram" || platform === "messenger";
    const target = isMetaDm ? "send-meta-dm" : "send-whatsapp";

    const forwardBody = isMetaDm
      ? {
          message_id: body.message_id,
          platform,
          recipient_id: body.recipient_id ?? body.recipient ?? body.phone_number,
          content: body.content ?? body.message ?? body.body,
          branch_id: body.branch_id ?? body.branchId,
          ig_account_id: body.ig_account_id ?? null,
        }
      : {
          message_id: body.message_id,
          phone_number: body.phone_number ?? body.recipient ?? body.recipient_id,
          content: body.content ?? body.message ?? body.body,
          branch_id: body.branch_id ?? body.branchId,
          message_type: body.message_type,
          media_url: body.media_url,
          caption: body.caption,
        };

    const r = await fetch(`${SUPABASE_URL}/functions/v1/${target}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(forwardBody),
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "internal_error", detail: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
