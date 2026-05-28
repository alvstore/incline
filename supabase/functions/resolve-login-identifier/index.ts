// resolve-login-identifier v2.0.0
// Server-side phone+password sign-in. Never returns the email associated with
// a phone number (prevents PII enumeration). Accepts {phone, password} and
// returns a Supabase session on success, generic error otherwise.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone, isValidIndianMobile } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const genericError = () =>
  new Response(JSON.stringify({ error: "Invalid credentials" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { phone, password } = await req.json().catch(() => ({}));
    if (!phone || !password || typeof phone !== "string" || typeof password !== "string") {
      return genericError();
    }
    if (!isValidIndianMobile(phone)) return genericError();

    const normalized = normalizePhone(phone);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: email, error: rpcErr } = await admin.rpc("resolve_email_by_phone", {
      p_phone: normalized,
    });
    if (rpcErr || !email) return genericError();

    // Perform sign-in server-side with a fresh anon client so we never leak the email.
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
      email: email as string,
      password,
    });
    if (signInErr || !signIn?.session) return genericError();

    return new Response(JSON.stringify({ session: signIn.session }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return genericError();
  }
});
