// v1.0.0 — Meta-required Data Deletion Request callback.
// Meta requires apps that handle user data to expose a callback that processes
// deletion requests. This function:
//   - Accepts POST from Meta with a `signed_request` body (JWT-style HMAC payload)
//   - Verifies the signature with the App Secret
//   - Records the deletion request in `data_deletion_requests` table
//   - Returns the JSON envelope Meta requires: { url, confirmation_code }
//
// Also accepts manual GET/POST from our public /data-deletion page (form submission)
// with a body of { email, reason } — same database row, no signature verification.
//
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://incline.lovable.app";

function base64UrlDecode(str: string): Uint8Array {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifySignedRequest(signedRequest: string, appSecret: string): Promise<any | null> {
  const [encSig, payload] = signedRequest.split(".");
  if (!encSig || !payload) return null;

  const sig = base64UrlDecode(encSig);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(payload));
  if (!ok) return null;

  const dec = new TextDecoder().decode(base64UrlDecode(payload));
  try {
    return JSON.parse(dec);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);
    const confirmationCode = `del-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const statusUrl = `${APP_BASE}/data-deletion/status?code=${confirmationCode}`;

    // ── Path A: Meta-signed callback ──
    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";
      let signedRequest: string | null = null;
      let manualBody: any = null;

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const form = await req.formData();
        signedRequest = String(form.get("signed_request") || "");
      } else if (contentType.includes("application/json")) {
        manualBody = await req.json().catch(() => ({}));
        signedRequest = manualBody?.signed_request || null;
      }

      if (signedRequest) {
        // Try every active integration's app_secret until one verifies.
        const { data: integrations } = await supabase
          .from("integration_settings")
          .select("credentials, branch_id")
          .in("provider", ["instagram", "instagram_login", "meta_cloud", "messenger"]);

        let payload: any = null;
        for (const i of integrations || []) {
          const secret = (i.credentials as any)?.app_secret;
          if (!secret) continue;
          payload = await verifySignedRequest(signedRequest, secret);
          if (payload) break;
        }

        if (!payload) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await supabase.from("data_deletion_requests").insert({
          source: "meta_signed",
          external_user_id: String(payload?.user_id || ""),
          confirmation_code: confirmationCode,
          status: "pending",
          payload,
        });

        return new Response(
          JSON.stringify({ url: statusUrl, confirmation_code: confirmationCode }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── Path B: manual form submission from /data-deletion ──
      const email = String(manualBody?.email || "").trim().toLowerCase();
      const reason = String(manualBody?.reason || "").slice(0, 500);
      if (!email) {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("data_deletion_requests").insert({
        source: "user_manual",
        email,
        confirmation_code: confirmationCode,
        status: "pending",
        payload: { reason },
      });

      return new Response(
        JSON.stringify({ ok: true, url: statusUrl, confirmation_code: confirmationCode }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── GET: status lookup ──
    if (req.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response(JSON.stringify({ error: "code required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data } = await supabase
        .from("data_deletion_requests")
        .select("status, created_at, completed_at")
        .eq("confirmation_code", code)
        .maybeSingle();
      return new Response(JSON.stringify({ code, ...(data || { status: "not_found" }) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-data-deletion] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
