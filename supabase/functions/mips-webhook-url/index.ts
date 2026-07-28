// v1.0.0 — Admin-only helper: returns the MIPS webhook URLs (recognition +
// register + heartbeat) with the shared MIPS_WEBHOOK_SECRET already embedded
// as a `?token=` query param. Owners/admins/managers only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const secret = Deno.env.get("MIPS_WEBHOOK_SECRET") || "";

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  if (!bearer) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPA_URL, SERVICE_KEY);
  const { data: userRes } = await supabase.auth.getUser(bearer);
  const uid = userRes?.user?.id;
  if (!uid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: roles } = await supabase
    .from("user_roles").select("role").eq("user_id", uid);
  const allowed = new Set(["owner", "admin", "manager"]);
  if (!(roles || []).some((r: any) => allowed.has(r.role))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const base = `${SUPA_URL}/functions/v1/mips-webhook-receiver`;
  const tokenQs = secret ? `?token=${encodeURIComponent(secret)}` : "";
  return new Response(JSON.stringify({
    configured: Boolean(secret),
    recognition_url: `${base}${tokenQs}`,
    heartbeat_url: `${base}${tokenQs}`,
    note: secret
      ? "Paste this exact URL into the MIPS device 'Recognition Record Upload URL' field. The token authenticates each webhook."
      : "MIPS_WEBHOOK_SECRET is not configured. Live attendance will not work until it is set.",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
