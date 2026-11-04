// v1.0.0 — MSG91 SMS template lifecycle (owners/admins/managers only).
// Actions: test | register | versions | add_version | mark_default | bulk_sync.
// MSG91 registration is NOT DLT approval — DLT approval happens in SmartPing first.
import { requireCaller, canActOnBranch, MANAGER_ROLES } from "../_shared/requireCaller.ts";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import {
  msg91Fetch, buildAddTemplateForm, toMsg91Content, contentHash, pickIntegration, registerBlocker,
} from "../_shared/msg91.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (p: unknown, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ACTIONS = ["test", "register", "versions", "add_version", "mark_default", "bulk_sync"] as const;
type Action = typeof ACTIONS[number];
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const caller = await requireCaller(req, cors, { roles: MANAGER_ROLES });
    if (!caller.ok) return caller.response;
    const db = caller.admin;
    const body = await req.json().catch(() => ({}));
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) return json({ error: "Unknown action" }, 400);
    const branchId: string | null = typeof body.branch_id === "string" && UUID.test(body.branch_id) ? body.branch_id : null;
    if (branchId && !(await canActOnBranch(caller, branchId))) return json({ error: "Forbidden" }, 403);

    const { data: ints } = await db.from("integration_settings").select("branch_id, credentials, is_active")
      .eq("integration_type", "sms").eq("provider", "msg91").eq("is_active", true);
    const integ = pickIntegration((ints || []) as Array<{ branch_id: string | null; credentials: any }>, branchId);
    const authKey: string = integ?.credentials?.auth_key || "";
    if (!authKey) return json({ error: "No active MSG91 integration with an Auth Key" }, 400);

    if (action === "test") {
      const r = await msg91Fetch(authKey, "/api/v5/flows", { method: "GET" });
      return r.ok ? json({ success: true }) : json({ success: false, error: r.error, status: r.status }, 502);
    }

    const loadTpl = async (id: unknown) => {
      if (typeof id !== "string" || !UUID.test(id)) return { err: json({ error: "Invalid template_id" }, 400) };
      const { data: t } = await db.from("templates")
        .select("id, name, type, branch_id, content, dlt_template_id, dlt_header, msg91_template_id, msg91_version_id")
        .eq("id", id).maybeSingle();
      if (!t || t.type !== "sms") return { err: json({ error: "SMS template not found" }, 404) };
      if (!(await canActOnBranch(caller, t.branch_id))) return { err: json({ error: "Forbidden" }, 403) };
      return { t };
    };

    const markFail = (id: string, error: string) =>
      db.from("templates").update({ msg91_sync_status: "failed", msg91_sync_error: error.slice(0, 500) }).eq("id", id);

    const syncOne = async (t: any): Promise<{ id: string; ok: boolean; error?: string }> => {
      const block = registerBlocker(t);
      if (block) { await markFail(t.id, block); return { id: t.id, ok: false, error: block }; }
      const hash = await contentHash(t);
      let templateId = t.msg91_template_id as string | null;
      let versionId: string | null = null;
      if (!templateId) {
        const r = await msg91Fetch(authKey, "/api/v5/sms/addTemplate", { method: "POST", body: buildAddTemplateForm(t) });
        if (!r.ok) { await markFail(t.id, r.error || "MSG91 error"); return { id: t.id, ok: false, error: r.error }; }
        templateId = String(r.data?.data?.template_id ?? r.data?.template_id ?? r.data?.data ?? "");
        if (!templateId) { await markFail(t.id, "MSG91 returned no template ID"); return { id: t.id, ok: false, error: "No template ID" }; }
      } else {
        const f = new FormData();
        f.append("template_id", templateId); f.append("sender_id", t.dlt_header);
        f.append("template", toMsg91Content(t.content)); f.append("dlt_template_id", t.dlt_template_id);
        const r = await msg91Fetch(authKey, "/api/v5/sms/addTemplateVersion", { method: "POST", body: f });
        if (!r.ok) { await markFail(t.id, r.error || "MSG91 error"); return { id: t.id, ok: false, error: r.error }; }
        versionId = String(r.data?.data?.id ?? r.data?.data?.version_id ?? r.data?.version_id ?? "") || null;
        if (versionId) {
          const m = await msg91Fetch(authKey, `/api/v5/sms/markActive?id=${encodeURIComponent(versionId)}&template_id=${encodeURIComponent(templateId)}`, { method: "GET" });
          if (!m.ok) { await markFail(t.id, m.error || "Could not mark version default"); return { id: t.id, ok: false, error: m.error }; }
        }
      }
      await db.from("templates").update({
        msg91_template_id: templateId, msg91_version_id: versionId, msg91_sync_status: "synced",
        msg91_sync_error: null, msg91_synced_at: new Date().toISOString(), msg91_synced_content_hash: hash,
      }).eq("id", t.id);
      return { id: t.id, ok: true };
    };

    if (action === "register" || action === "add_version") {
      const { t, err } = await loadTpl(body.template_id); if (err) return err;
      if (action === "register" && t.msg91_template_id) return json({ error: "Already registered — add a version instead" }, 409);
      if (action === "add_version" && !t.msg91_template_id) return json({ error: "Register the template first" }, 409);
      const r = await syncOne(t);
      return json(r, r.ok ? 200 : 502);
    }

    if (action === "versions") {
      const { t, err } = await loadTpl(body.template_id); if (err) return err;
      if (!t.msg91_template_id) return json({ versions: [] });
      const r = await msg91Fetch(authKey, "/api/v5/sms/getTemplateVersions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: t.msg91_template_id }),
      });
      return r.ok ? json({ versions: r.data?.data ?? [] }) : json({ error: r.error }, 502);
    }

    if (action === "mark_default") {
      const { t, err } = await loadTpl(body.template_id); if (err) return err;
      const vid = String(body.version_id || "");
      if (!t.msg91_template_id || !/^[A-Za-z0-9_-]{1,64}$/.test(vid)) return json({ error: "Invalid version" }, 400);
      const r = await msg91Fetch(authKey, `/api/v5/sms/markActive?id=${encodeURIComponent(vid)}&template_id=${encodeURIComponent(t.msg91_template_id)}`, { method: "GET" });
      if (!r.ok) return json({ error: r.error }, 502);
      // A manually chosen version may differ from current content → require resync before sending.
      await db.from("templates").update({ msg91_version_id: vid, msg91_sync_status: "needs_resync" }).eq("id", t.id);
      return json({ success: true });
    }

    // bulk_sync: DLT-ready SMS templates that are not synced / need resync.
    let q = db.from("templates")
      .select("id, name, type, branch_id, content, dlt_template_id, dlt_header, msg91_template_id, msg91_version_id")
      .eq("type", "sms").neq("msg91_sync_status", "synced").not("dlt_template_id", "is", null).not("dlt_header", "is", null).limit(50);
    q = branchId ? q.or(`branch_id.eq.${branchId},branch_id.is.null`) : q;
    const { data: rows } = await q;
    const results = [];
    for (const t of rows || []) {
      if (!(await canActOnBranch(caller, t.branch_id))) continue;
      results.push(await syncOne(t));
    }
    return json({ total: results.length, synced: results.filter((r) => r.ok).length, results });
  } catch (e) {
    await captureEdgeError("msg91-templates", e);
    return json({ error: "Internal error" }, 500);
  }
});
