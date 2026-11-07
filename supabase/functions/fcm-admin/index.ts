// v1.0.0 — Owner/admin management of direct Firebase phone push: save · test · enable · status.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { requireCaller } from "../_shared/requireCaller.ts";
import { loadFcmConfig, parseServiceAccount, resetTokenCache, sendFcm } from "../_shared/fcm.ts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("save"), service_account: z.string().min(50).max(20000) }),
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("set_enabled"), enabled: z.boolean() }),
]);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await requireCaller(req, corsHeaders, { roles: ["owner", "admin"], allowInternal: false });
    if (!caller.ok) return caller.response;
    if (caller.internal) return json(403, { error: "Owner or admin sign-in required" });
    const db = caller.admin;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(400, { error: "Invalid request", details: parsed.error.flatten().fieldErrors });
    const input = parsed.data;
    const audit = (action: string, desc: string, data: Record<string, unknown>) =>
      db.from("audit_logs").insert({ user_id: caller.userId, action, table_name: "push_provider_settings", action_description: desc, target_name: "Firebase phone push", new_data: data });

    if (input.action === "status") {
      const since = new Date(Date.now() - 86400000).toISOString();
      const [{ data: settings }, phones, browsers, sent, failed] = await Promise.all([
        db.from("push_provider_settings").select("project_id,client_email,enabled,last_test_ok,last_test_at,last_test_error,key_uploaded_at").eq("id", true).maybeSingle(),
        db.from("web_push_subscriptions").select("id", { count: "exact", head: true }).eq("kind", "fcm"),
        db.from("web_push_subscriptions").select("id", { count: "exact", head: true }).neq("kind", "fcm"),
        db.from("web_push_deliveries").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", since),
        db.from("web_push_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
      ]);
      return json(200, { settings, counts: { phones: phones.count ?? 0, browsers: browsers.count ?? 0, sent24h: sent.count ?? 0, failed24h: failed.count ?? 0 } });
    }

    if (input.action === "save") {
      const sa = parseServiceAccount(input.service_account);
      if (!sa.ok) return json(400, { error: sa.error });
      const now = new Date().toISOString();
      const k = await db.from("push_provider_secrets").upsert({ id: true, private_key: sa.value.private_key, updated_at: now });
      if (k.error) throw k.error;
      // A new key must pass a fresh test before phone push is switched on.
      const s = await db.from("push_provider_settings").upsert({ id: true, project_id: sa.value.project_id, client_email: sa.value.client_email, enabled: false, last_test_ok: null, last_test_at: null, last_test_error: null, key_uploaded_at: now, updated_by: caller.userId, updated_at: now });
      if (s.error) throw s.error;
      resetTokenCache();
      await audit("push_settings_saved", "Uploaded Firebase service account", { project_id: sa.value.project_id, client_email: sa.value.client_email });
      return json(200, { ok: true, project_id: sa.value.project_id, client_email: sa.value.client_email });
    }

    if (input.action === "test") {
      const cfg = await loadFcmConfig(db);
      if (!cfg) return json(400, { error: "Upload the service account file first" });
      // Dry run with a syntactically valid fake token: Firebase checks auth + project, delivers nothing.
      let ok = false, error: string | null = null, status = 0;
      try {
        const r = await sendFcm(cfg.sa, { token: "validate-only-dry-run-token", notification: { title: "Incline", body: "Test" } }, true);
        status = r.status;
        // An INVALID_ARGUMENT about the fake token still proves credentials and project are correct.
        ok = r.ok || (r.status === 400 && /registration token|INVALID_ARGUMENT/i.test(r.body));
        if (!ok) error = `Firebase [${r.status}]: ${r.body.slice(0, 400)}`;
      } catch (e) { error = e instanceof Error ? e.message.slice(0, 400) : "Test failed"; }
      const now = new Date().toISOString();
      await db.from("push_provider_settings").update({ last_test_ok: ok, last_test_at: now, last_test_error: error, updated_at: now }).eq("id", true);
      await audit(ok ? "push_test_succeeded" : "push_test_failed", ok ? "Firebase test passed" : "Firebase test failed", { status });
      return json(200, { ok, error });
    }

    // set_enabled
    const { data: s } = await db.from("push_provider_settings").select("last_test_ok").eq("id", true).maybeSingle();
    if (input.enabled && !s?.last_test_ok) return json(400, { error: "Run a successful test before switching phone push on" });
    const u = await db.from("push_provider_settings").update({ enabled: input.enabled, updated_by: caller.userId, updated_at: new Date().toISOString() }).eq("id", true);
    if (u.error) throw u.error;
    await audit("push_settings_toggled", input.enabled ? "Phone push switched on" : "Phone push switched off", { enabled: input.enabled });
    return json(200, { ok: true, enabled: input.enabled });
  } catch (e) {
    console.error("fcm-admin failed", e instanceof Error ? e.message : e);
    return json(500, { error: "Push settings temporarily unavailable. Please retry." });
  }
});
