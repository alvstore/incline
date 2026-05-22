// v1.0.0 — Phase G: Instagram Business Login OAuth callback.
// Handles the redirect from Meta after the user completes the IG Business Login flow.
//
// Flow:
//   1. User clicks "Authorize with Instagram" in IntegrationSettings → opens
//      https://www.instagram.com/oauth/authorize?client_id=...&redirect_uri=THIS&scope=...&state=<branch_id>
//   2. Meta redirects browser to this function with `?code=...&state=<branch_id>`.
//   3. We exchange `code` → short-lived token → long-lived (60-day) token.
//   4. Persist into `integration_settings` (provider='instagram_login') for the branch.
//   5. Redirect browser back to /settings?tab=integrations&meta_oauth=success.
//
// Endpoints used:
//   POST https://api.instagram.com/oauth/access_token   (short-lived)
//   GET  https://graph.instagram.com/access_token       (long-lived swap)
//   GET  https://graph.instagram.com/v25.0/me           (fetch user_id+username)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { IG_API_BASE, metaFetchWithFallback } from "../_shared/meta-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://incline.lovable.app";

function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}.card{background:#fff;border-radius:16px;padding:32px;max-width:480px;box-shadow:0 10px 30px -10px rgba(0,0,0,0.1)}h1{margin:0 0 12px;font-size:20px}p{margin:8px 0;color:#475569}a{color:#6366f1;text-decoration:none;font-weight:600}</style>
     </head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // expected: branch_id
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      console.error("[meta-oauth-callback] Meta returned error:", error, errorDescription);
      return htmlResponse(
        "Instagram authorization failed",
        `<h1>❌ Authorization failed</h1>
         <p><b>${error}</b></p>
         <p>${errorDescription || "The Instagram authorization was cancelled or denied."}</p>
         <p><a href="${APP_BASE}/settings?tab=integrations">← Back to Integrations</a></p>`,
        400,
      );
    }

    if (!code || !state) {
      return htmlResponse(
        "Invalid callback",
        `<h1>⚠️ Missing parameters</h1>
         <p>This URL is the Instagram OAuth callback. It must be invoked by Meta after a user authorizes the app — not opened directly.</p>
         <p>If you are setting up the integration, paste this URL as the <b>Redirect URL</b> in your Meta Dashboard → Instagram → API setup with Instagram login.</p>
         <p><a href="${APP_BASE}/settings?tab=integrations">← Back to Integrations</a></p>`,
        400,
      );
    }

    const branchId = state.trim();

    // Look up Meta App ID + Secret for this branch (stored in integration_settings).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existing } = await supabase
      .from("integration_settings")
      .select("id, credentials, config")
      .eq("branch_id", branchId)
      .eq("provider", "instagram_login")
      .maybeSingle();

    const appId =
      (existing?.credentials as any)?.app_id ||
      Deno.env.get("META_APP_ID");
    const appSecret =
      (existing?.credentials as any)?.app_secret ||
      Deno.env.get("META_APP_SECRET");

    if (!appId || !appSecret) {
      return htmlResponse(
        "App not configured",
        `<h1>⚠️ Meta App credentials missing</h1>
         <p>Before authorizing, paste your Meta <b>App ID</b> and <b>App Secret</b> in
         Settings → Integrations → Instagram → Instagram Business Login, then save and try again.</p>
         <p><a href="${APP_BASE}/settings?tab=integrations">← Back to Integrations</a></p>`,
        400,
      );
    }

    const redirectUri = `${url.origin}${url.pathname}`;

    // Step 1: code → short-lived access token
    const shortResp = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortData = await shortResp.json().catch(() => ({}));
    if (!shortResp.ok || !shortData?.access_token) {
      console.error("[meta-oauth-callback] short-lived exchange failed:", shortData);
      return htmlResponse(
        "Token exchange failed",
        `<h1>❌ Token exchange failed</h1>
         <p>${shortData?.error_message || shortData?.error?.message || "Meta refused the authorization code."}</p>
         <p>Verify the App ID and App Secret in Integrations match Meta Dashboard → Settings → Basic.</p>
         <p><a href="${APP_BASE}/settings?tab=integrations">← Back to Integrations</a></p>`,
        400,
      );
    }

    const shortToken: string = shortData.access_token;
    const igUserId: string = String(shortData.user_id || "");

    // Step 2: short → long-lived (60 day) token
    const longResp = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortToken)}`,
    );
    const longData = await longResp.json().catch(() => ({}));
    const longToken: string = longData?.access_token || shortToken;
    const expiresIn: number = Number(longData?.expires_in || 0);

    // Step 3: fetch profile so we have username for display
    const meResp = await metaFetchWithFallback(
      `${IG_API_BASE}/me?fields=user_id,username,name,account_type`,
      { headers: { Authorization: `Bearer ${longToken}` } },
    );
    const me = await meResp.json().catch(() => ({}));
    const username = me?.username || "";
    const accountId = String(me?.user_id || me?.id || igUserId);
    const accountType = String(me?.account_type || "").toUpperCase();

    // Step 4: persist
    const credentials = {
      ...((existing?.credentials as any) || {}),
      app_id: appId,
      app_secret: appSecret,
      access_token: longToken,
      token_expires_at: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
    };
    const config = {
      ...((existing?.config as any) || {}),
      instagram_account_id: accountId,
      username,
      account_type: accountType,
    };

    if (existing?.id) {
      await supabase
        .from("integration_settings")
        .update({ credentials, config, is_active: true, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("integration_settings").insert({
        branch_id: branchId,
        provider: "instagram_login",
        integration_type: "instagram",
        credentials,
        config,
        is_active: true,
      });
    }

    return redirect(
      `${APP_BASE}/settings?tab=integrations&meta_oauth=success&ig=${encodeURIComponent(username || accountId)}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meta-oauth-callback] fatal:", msg);
    return htmlResponse(
      "Unexpected error",
      `<h1>❌ Unexpected error</h1><p>${msg}</p>
       <p><a href="${APP_BASE}/settings?tab=integrations">← Back to Integrations</a></p>`,
      500,
    );
  }
});
