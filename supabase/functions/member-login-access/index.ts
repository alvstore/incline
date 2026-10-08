// v1.0.0 — Member app-login access: manual disable/enable (staff) + automatic
// revoke/restore sweep (Automation Brain, service role). No messages are sent.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireCaller, canActOnBranch, STAFF_ROLES, type CallerResult } from "../_shared/requireCaller.ts";

const BAN = "876000h";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Admin = CallerResult["admin"];

async function setBan(admin: Admin, userId: string, banned: boolean) {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? BAN : "none" });
  if (error) throw new Error(error.message);
  if (banned) {
    // Kill live sessions so an open app is signed out on next refresh.
    await admin.rpc("log_error_event", {
      p_source: "member-login-access", p_severity: "info",
      p_message: "member login revoked", p_context: { user_id: userId },
    }).then(() => null, () => null);
  }
}

async function logEvent(admin: Admin, ctx: Record<string, unknown>, message: string) {
  await admin.rpc("log_error_event", {
    p_source: "member-login-access", p_severity: "error", p_message: message, p_context: ctx,
  }).then(() => null, () => null);
}

async function sweep(admin: Admin) {
  const { data: flag } = await admin.from("settings").select("value").is("branch_id", null)
    .eq("key", "member_login_autorevoke").maybeSingle();
  const enabled = (flag?.value as { enabled?: boolean } | null)?.enabled !== false;
  const { data, error } = await admin.rpc("member_login_access_candidates");
  if (error) throw new Error(error.message);
  let revoked = 0, restored = 0, failed = 0;
  for (const c of (data ?? []) as { member_id: string; user_id: string; action: string }[]) {
    if (c.action === "revoke" && !enabled) continue;
    try {
      const revoke = c.action === "revoke";
      await setBan(admin, c.user_id, revoke);
      await admin.from("members").update(revoke
        ? { login_disabled_at: new Date().toISOString(), login_disabled_source: "auto",
            login_disabled_reason: "Membership expired or inactive", login_disabled_by: null }
        : { login_disabled_at: null, login_disabled_source: null, login_disabled_reason: null, login_disabled_by: null },
      ).eq("id", c.member_id);
      revoke ? revoked++ : restored++;
    } catch (e) {
      failed++;
      await logEvent(admin, { member_id: c.member_id, action: c.action }, String((e as Error).message));
    }
  }
  return { enabled, revoked, restored, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "sweep");

    if (action === "sweep") {
      const caller = await requireCaller(req, corsHeaders, { roles: ["owner", "admin"] });
      if (!caller.ok) return caller.response;
      return json({ ok: true, ...(await sweep(caller.admin)) });
    }

    if (action !== "disable" && action !== "enable") return json({ error: "invalid_action" }, 400);
    const caller = await requireCaller(req, corsHeaders, { roles: STAFF_ROLES, allowInternal: false });
    if (!caller.ok) return caller.response;
    const memberId = String(body.member_id ?? "");
    const reason = String(body.reason ?? "").trim().slice(0, 300);
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json({ error: "invalid_member" }, 400);
    if (action === "disable" && reason.length < 3) return json({ error: "reason_required" }, 400);

    const { data: m } = await caller.admin.from("members").select("id, user_id, branch_id").eq("id", memberId).maybeSingle();
    if (!m) return json({ error: "member_not_found" }, 404);
    if (!(await canActOnBranch(caller, m.branch_id))) return json({ error: "forbidden" }, 403);
    if (!m.user_id) return json({ error: "no_login" }, 400);
    const { data: other } = await caller.admin.from("user_roles").select("role").eq("user_id", m.user_id).neq("role", "member");
    if ((other ?? []).length) return json({ error: "staff_account" }, 400);

    const disable = action === "disable";
    await setBan(caller.admin, m.user_id, disable);
    await caller.admin.from("members").update(disable
      ? { login_disabled_at: new Date().toISOString(), login_disabled_source: "manual", login_disabled_reason: reason, login_disabled_by: caller.userId }
      : { login_disabled_at: null, login_disabled_source: null, login_disabled_reason: null, login_disabled_by: caller.userId },
    ).eq("id", memberId);
    await caller.admin.from("audit_logs").insert({
      action: disable ? "member_login_disabled" : "member_login_enabled", table_name: "members", record_id: memberId,
      user_id: caller.userId, branch_id: m.branch_id, new_data: { reason: reason || null },
    }).then(() => null, () => null);
    return json({ ok: true, disabled: disable });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
