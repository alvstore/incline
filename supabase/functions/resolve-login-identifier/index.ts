// resolve-login-identifier v1.0.0
// Looks up the auth email associated with a phone number so users can log in
// using either email OR phone (with password). Returns generic error on miss
// to avoid user enumeration.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone, isValidIndianMobile } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return new Response(JSON.stringify({ error: "phone required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isValidIndianMobile(phone)) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const normalized = normalizePhone(phone);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase.rpc("resolve_email_by_phone", { p_phone: normalized });
    if (error || !data) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ email: data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid credentials" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
