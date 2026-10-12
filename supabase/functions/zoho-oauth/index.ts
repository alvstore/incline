// zoho-oauth v1.0.0 — owner/admin control of the direct Zoho Books connection.
// Actions: status | save_credentials | start | test | set_mode | disconnect.
// Secrets are write-only from the browser; status never returns them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@3.23.8";
import { audit, getMode, loadCreds, refreshAccessToken, setMode } from "../_shared/zohoDirect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ORIGIN_RE = /^https:\/\/((www\.)?theincline\.in|[a-z0-9-]+\.lovable\.app|[a-z0-9-]+\.lovableproject\.com)$|^http:\/\/localhost:\d+$/;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({
    action: z.literal("save_credentials"),
    client_id: z.string().trim().min(10).max(200),
    client_secret: z.string().trim().min(10).max(200).optional(),
    dc: z.enum(["in", "com", "eu"]),
    organization_id: z.string().trim().regex(/^\d{5,20}$/).optional().or(z.literal("")),
  }),
  z.object({ action: z.literal("start"), origin: z.string().regex(ORIGIN_RE) }),
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("set_mode"), mode: z.enum(["connector", "direct"]) }),
  z.object({ action: z.literal("disconnect") }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json({ success: false, error: "Not authenticated" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!(roles ?? []).some((r) => r.role === "owner" || r.role === "admin")) {
      return json({ success: false, error: "Owner or admin access required" }, 403);
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ success: false, error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
    const b = parsed.data;
    const redirectUri = `${url}/functions/v1/zoho-oauth-callback`;
    const creds = await loadCreds(admin);

    switch (b.action) {
      case "status": {
        let connectedByName: string | null = null;
        if (creds?.connected_by) {
          const { data: p } = await admin.from("profiles").select("full_name").eq("id", creds.connected_by).maybeSingle();
          connectedByName = p?.full_name ?? null;
        }
        return json({
          success: true,
          mode: await getMode(admin),
          redirect_uri: redirectUri,
          has_client: Boolean(creds?.client_id && creds?.client_secret),
          client_id_hint: creds?.client_id ? `••••${creds.client_id.slice(-4)}` : null,
          connected: Boolean(creds?.refresh_token),
          dc: creds?.dc ?? "in",
          organization_id: creds?.organization_id ?? null,
          org_name: creds?.org_name ?? null,
          connected_at: creds?.connected_at ?? null,
          connected_by_name: connectedByName,
          last_test_ok_at: creds?.last_test_ok_at ?? null,
          last_refresh_error: creds?.last_refresh_error ?? null,
        });
      }
      case "save_credentials": {
        const changedClient = !creds || creds.client_id !== b.client_id || creds.dc !== b.dc;
        if (!b.client_secret && !creds?.client_secret) return json({ success: false, error: "Client Secret is required" }, 400);
        const row = {
          id: true, client_id: b.client_id, dc: b.dc,
          client_secret: b.client_secret ?? creds!.client_secret,
          organization_id: b.organization_id || null,
          updated_at: new Date().toISOString(),
          // A different Zoho app or data centre invalidates the old token.
          ...(changedClient ? { refresh_token: null, connected_at: null, org_name: null, last_test_ok_at: null } : {}),
        };
        const { error } = await admin.from("zoho_direct_credentials").upsert(row);
        if (error) throw error;
        if (changedClient && (await getMode(admin)) === "direct") await setMode(admin, "connector");
        await audit(admin, uid, "zoho_credentials_saved", `Zoho client credentials saved (data centre ${b.dc})`);
        return json({ success: true, needs_connect: changedClient || !creds?.refresh_token });
      }
      case "start": {
        if (!creds?.client_id || !creds.client_secret) return json({ success: false, error: "Save the Client ID and Secret first" }, 400);
        const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
        await admin.from("zoho_oauth_states").delete().lt("expires_at", new Date().toISOString());
        const { error } = await admin.from("zoho_oauth_states").insert({
          state, user_id: uid, return_origin: b.origin,
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        if (error) throw error;
        const q = new URLSearchParams({
          scope: "ZohoBooks.fullaccess.all", client_id: creds.client_id, response_type: "code",
          access_type: "offline", prompt: "consent", redirect_uri: redirectUri, state,
        });
        await audit(admin, uid, "zoho_connect_started", "Zoho Books approval started");
        return json({ success: true, url: `https://accounts.zoho.${creds.dc}/oauth/v2/auth?${q}` });
      }
      case "test": {
        if (!creds?.refresh_token) return json({ success: false, error: "Not connected to Zoho yet" }, 400);
        try {
          const { token: at } = await refreshAccessToken(creds);
          const r = await fetch(`https://www.zohoapis.${creds.dc}/books/v3/organizations`, {
            headers: { Authorization: `Zoho-oauthtoken ${at}` },
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.code !== 0) throw new Error(`[${r.status}] ${j.message ?? "Zoho rejected the request"}`);
          const orgs = (j.organizations ?? []) as { organization_id: string; name: string }[];
          const org = orgs.find((o) => o.organization_id === creds.organization_id) ?? orgs[0];
          if (!org) throw new Error("No Zoho Books organisation on this account");
          await admin.from("zoho_direct_credentials").update({
            last_test_ok_at: new Date().toISOString(), last_refresh_error: null,
            organization_id: org.organization_id, org_name: org.name,
          }).eq("id", true);
          await audit(admin, uid, "zoho_test_ok", `Zoho connection test passed (${org.name})`);
          return json({ success: true, org_name: org.name });
        } catch (e) {
          const msg = (e as Error).message;
          await admin.from("zoho_direct_credentials").update({ last_refresh_error: msg, last_test_ok_at: null }).eq("id", true);
          await audit(admin, uid, "zoho_test_failed", "Zoho connection test failed");
          return json({ success: false, error: msg }, 200);
        }
      }
      case "set_mode": {
        if (b.mode === "direct" && !creds?.last_test_ok_at) {
          return json({ success: false, error: "Run a successful connection test before switching to direct" }, 400);
        }
        await setMode(admin, b.mode);
        await audit(admin, uid, "zoho_mode_changed", `Zoho connection mode set to ${b.mode}`);
        return json({ success: true, mode: b.mode });
      }
      case "disconnect": {
        await setMode(admin, "connector");
        await admin.from("zoho_direct_credentials").delete().eq("id", true);
        await audit(admin, uid, "zoho_disconnected", "Direct Zoho connection removed; back to connector");
        return json({ success: true });
      }
    }
  } catch (e) {
    console.error("zoho-oauth error", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
