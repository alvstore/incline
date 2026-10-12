// zoho-oauth-callback v1.0.0 — Zoho redirects here after the owner approves.
// Validates the one-time state, swaps the code for a refresh token, stores it
// server-side and sends the owner back to Finance → GST.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { audit, loadCreds } from "../_shared/zohoDirect.ts";

const FALLBACK = "https://theincline.in";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let origin = FALLBACK;
  const back = (status: string, reason?: string) => {
    const q = new URLSearchParams({ tab: "gst", zoho: status, ...(reason ? { reason } : {}) });
    return new Response(null, { status: 302, headers: { Location: `${origin}/finance?${q}` } });
  };
  try {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    if (!state || state.length < 40) return back("error", "invalid_state");
    // Atomically claim the state so it can only be used once.
    const { data: st } = await admin.from("zoho_oauth_states")
      .update({ used_at: new Date().toISOString() })
      .eq("state", state).is("used_at", null).gt("expires_at", new Date().toISOString())
      .select("user_id, return_origin").maybeSingle();
    if (!st) return back("error", "expired_or_used");
    if (st.return_origin) origin = st.return_origin;
    if (url.searchParams.get("error") || !code) return back("error", url.searchParams.get("error") ?? "denied");

    const creds = await loadCreds(admin);
    if (!creds?.client_id || !creds.client_secret) return back("error", "no_credentials");
    const res = await fetch(`https://accounts.zoho.${creds.dc}/oauth/v2/token`, {
      method: "POST",
      body: new URLSearchParams({
        code, client_id: creds.client_id, client_secret: creds.client_secret,
        redirect_uri: `${supaUrl}/functions/v1/zoho-oauth-callback`, grant_type: "authorization_code",
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.refresh_token) {
      console.error("zoho token exchange failed", res.status, j.error);
      return back("error", String(j.error ?? "token_exchange_failed").slice(0, 60));
    }
    let orgId = creds.organization_id, orgName: string | null = null;
    try {
      const r = await fetch(`https://www.zohoapis.${creds.dc}/books/v3/organizations`, {
        headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` },
      });
      const oj = await r.json();
      const orgs = (oj.organizations ?? []) as { organization_id: string; name: string }[];
      const org = orgs.find((o) => o.organization_id === orgId) ?? orgs[0];
      if (org) { orgId = org.organization_id; orgName = org.name; }
    } catch { /* test step will retry */ }
    await admin.from("zoho_direct_credentials").update({
      refresh_token: j.refresh_token, connected_by: st.user_id, connected_at: new Date().toISOString(),
      organization_id: orgId, org_name: orgName, last_refresh_error: null,
      last_test_ok_at: orgName ? new Date().toISOString() : null,
    }).eq("id", true);
    await audit(admin, st.user_id, "zoho_connected", `Zoho Books connected directly${orgName ? ` (${orgName})` : ""}`);
    return back("connected");
  } catch (e) {
    console.error("zoho-oauth-callback error", (e as Error).message);
    return back("error", "server_error");
  }
});
