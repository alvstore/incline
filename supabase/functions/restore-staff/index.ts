// v1.0.0 — Staff reinstatement (mirror of offboard-staff).
// Body: { person_id?, user_id?, roles: ('manager'|'staff'|'trainer')[], unban_auth?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Role = "manager" | "staff" | "trainer";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const { data: userRes } = await admin.auth.getUser(jwt);
    if (!userRes?.user) return json({ error: "Unauthorized" }, 401);
    const actorId = userRes.user.id;

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", actorId);
    const actorRoles = (roleRows || []).map((r: any) => r.role);
    if (!actorRoles.includes("owner") && !actorRoles.includes("admin")) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { person_id, user_id, roles, unban_auth } = body as {
      person_id?: string;
      user_id?: string;
      roles?: Role[];
      unban_auth?: boolean;
    };
    if (!roles?.length) return json({ error: "Missing roles" }, 400);

    let employeeRow: any = null;
    let trainerRow: any = null;
    let resolvedUserId: string | null = user_id || null;
    if (user_id) {
      const [{ data: emp }, { data: tr }] = await Promise.all([
        admin.from("employees").select("id, user_id").eq("user_id", user_id).maybeSingle(),
        admin.from("trainers").select("id, user_id").eq("user_id", user_id).maybeSingle(),
      ]);
      employeeRow = emp; trainerRow = tr;
    } else if (person_id) {
      const [{ data: emp }, { data: tr }] = await Promise.all([
        admin.from("employees").select("id, user_id").eq("id", person_id).maybeSingle(),
        admin.from("trainers").select("id, user_id").eq("id", person_id).maybeSingle(),
      ]);
      employeeRow = emp; trainerRow = tr;
      resolvedUserId = emp?.user_id || tr?.user_id || null;
    }

    const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];
    const restorePayload = { is_active: true, exit_date: null, exit_type: null, exit_reason: null, exit_notes: null, exited_by: null };

    if (employeeRow && (roles.includes("manager") || roles.includes("staff"))) {
      const r = await invokeMipsRestore(SUPABASE_URL, SERVICE_KEY, "employee", employeeRow.id);
      steps.push({ step: "mips_restore_employee", ok: r.ok, detail: r.detail });
      const { error } = await admin.from("employees").update(restorePayload).eq("id", employeeRow.id);
      steps.push({ step: "restore_employee_row", ok: !error, detail: error?.message });
    }
    if (trainerRow && roles.includes("trainer")) {
      const r = await invokeMipsRestore(SUPABASE_URL, SERVICE_KEY, "trainer", trainerRow.id);
      steps.push({ step: "mips_restore_trainer", ok: r.ok, detail: r.detail });
      const { error } = await admin.from("trainers").update(restorePayload).eq("id", trainerRow.id);
      steps.push({ step: "restore_trainer_row", ok: !error, detail: error?.message });
    }

    if (resolvedUserId) {
      for (const r of roles) {
        const { error } = await admin
          .from("user_roles")
          .upsert({ user_id: resolvedUserId, role: r }, { onConflict: "user_id,role" });
        steps.push({ step: `reinstate_role_${r}`, ok: !error, detail: error?.message });
      }
      if (unban_auth !== false) {
        try {
          await admin.auth.admin.updateUserById(resolvedUserId, { ban_duration: "none" } as any);
          steps.push({ step: "unban_auth_user", ok: true });
        } catch (e: any) {
          steps.push({ step: "unban_auth_user", ok: false, detail: e?.message });
        }
      }
    }

    try {
      await admin.from("audit_logs").insert({
        action: "staff_reinstated",
        actor_id: actorId,
        target_type: trainerRow && !employeeRow ? "trainer" : "employee",
        target_id: employeeRow?.id || trainerRow?.id,
        details: { user_id: resolvedUserId, roles_reinstated: roles, steps },
      });
    } catch (_) { /* non-fatal */ }

    return json({ success: steps.every((s) => s.ok), steps });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeMipsRestore(
  url: string,
  key: string,
  person_type: "employee" | "trainer",
  person_id: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const r = await fetch(`${url}/functions/v1/mips-access`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore_staff", person_type, person_id, reason: "Reinstated" }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data?.success !== false, detail: data?.error || data?.message };
  } catch (e: any) {
    return { ok: false, detail: e?.message };
  }
}
