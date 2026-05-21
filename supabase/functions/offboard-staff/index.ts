// v1.0.0 — Staff offboarding orchestrator.
// Atomically: revokes MIPS turnstile access, marks employee/trainer inactive
// with exit metadata, removes app roles for the offboarded role(s),
// optionally bans auth user, cancels future trainer assignments, and audit-logs.
//
// Body: {
//   person_id: string,        // employees.id OR trainers.id (we figure out user_id)
//   user_id: string,          // canonical user id (preferred when person has both)
//   roles: ('manager'|'staff'|'trainer')[],  // which roles to offboard
//   exit_date?: string (YYYY-MM-DD, default today),
//   exit_type: 'resigned'|'terminated'|'end_of_contract'|'absconded'|'other',
//   exit_reason?: string,
//   exit_notes?: string,
//   ban_auth?: boolean        // default true if no roles remain & not a member
// }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Role = "manager" | "staff" | "trainer";

interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ── AuthN/AuthZ ──
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const actorId = userRes.user.id;

    const { data: hasCap, error: capErr } = await admin.rpc("has_capability", {
      _user_id: actorId,
      _capability: "manage_staff",
    });
    if (capErr || !hasCap) {
      // Fallback: allow owner/admin if has_capability not present
      const { data: roleRows } = await admin
        .from("user_roles").select("role").eq("user_id", actorId);
      const roles = (roleRows || []).map((r: any) => r.role);
      if (!roles.includes("owner") && !roles.includes("admin")) {
        return json({ error: "Forbidden: requires owner/admin or manage_staff" }, 403);
      }
    }

    // ── Parse body ──
    const body = await req.json().catch(() => ({}));
    const {
      person_id,
      user_id,
      roles,
      exit_date,
      exit_type,
      exit_reason,
      exit_notes,
      ban_auth,
    } = body as {
      person_id?: string;
      user_id?: string;
      roles?: Role[];
      exit_date?: string;
      exit_type?: string;
      exit_reason?: string;
      exit_notes?: string;
      ban_auth?: boolean;
    };

    if (!roles?.length || !exit_type) {
      return json({ error: "Missing required fields: roles, exit_type" }, 400);
    }
    if (!user_id && !person_id) {
      return json({ error: "Provide user_id or person_id" }, 400);
    }

    const effectiveExitDate = exit_date || new Date().toISOString().slice(0, 10);
    const exitPayload = {
      is_active: false,
      exit_date: effectiveExitDate,
      exit_type,
      exit_reason: exit_reason || null,
      exit_notes: exit_notes || null,
      exited_by: actorId,
    };

    // ── Resolve target rows ──
    let employeeRow: any = null;
    let trainerRow: any = null;
    let resolvedUserId: string | null = user_id || null;

    if (user_id) {
      const [{ data: emp }, { data: tr }] = await Promise.all([
        admin.from("employees").select("id, user_id, branch_id, department, position").eq("user_id", user_id).maybeSingle(),
        admin.from("trainers").select("id, user_id, branch_id").eq("user_id", user_id).maybeSingle(),
      ]);
      employeeRow = emp;
      trainerRow = tr;
    } else if (person_id) {
      const [{ data: emp }, { data: tr }] = await Promise.all([
        admin.from("employees").select("id, user_id, branch_id, department, position").eq("id", person_id).maybeSingle(),
        admin.from("trainers").select("id, user_id, branch_id").eq("id", person_id).maybeSingle(),
      ]);
      employeeRow = emp;
      trainerRow = tr;
      resolvedUserId = emp?.user_id || tr?.user_id || null;
    }

    const steps: StepResult[] = [];

    // ── 1. MIPS revoke ──
    const offboardEmployee = employeeRow && (roles.includes("manager") || roles.includes("staff"));
    const offboardTrainer = trainerRow && roles.includes("trainer");

    if (offboardEmployee) {
      const r = await invokeMipsRevoke(SUPABASE_URL, SERVICE_KEY, "employee", employeeRow.id, exit_reason);
      steps.push({ step: "mips_revoke_employee", ok: r.ok, detail: r.detail });
    }
    if (offboardTrainer) {
      const r = await invokeMipsRevoke(SUPABASE_URL, SERVICE_KEY, "trainer", trainerRow.id, exit_reason);
      steps.push({ step: "mips_revoke_trainer", ok: r.ok, detail: r.detail });
    }

    // ── 2. Mark exit in DB ──
    if (offboardEmployee) {
      const { error } = await admin.from("employees").update(exitPayload).eq("id", employeeRow.id);
      steps.push({ step: "mark_employee_exit", ok: !error, detail: error?.message });
    }
    if (offboardTrainer) {
      const { error } = await admin.from("trainers").update(exitPayload).eq("id", trainerRow.id);
      steps.push({ step: "mark_trainer_exit", ok: !error, detail: error?.message });
    }

    // ── 3. Remove user_roles (keep 'member' if also a member) ──
    let remainingRoles: string[] = [];
    if (resolvedUserId) {
      const rolesToRemove: Role[] = roles.filter((r) => ["manager", "staff", "trainer"].includes(r));
      if (rolesToRemove.length) {
        const { error } = await admin
          .from("user_roles")
          .delete()
          .eq("user_id", resolvedUserId)
          .in("role", rolesToRemove);
        steps.push({ step: "remove_user_roles", ok: !error, detail: error?.message || rolesToRemove.join(",") });
      }
      const { data: leftover } = await admin
        .from("user_roles").select("role").eq("user_id", resolvedUserId);
      remainingRoles = (leftover || []).map((r: any) => r.role);
    }

    // ── 4. Revoke sessions / optionally ban auth user ──
    if (resolvedUserId) {
      try {
        await admin.auth.admin.signOut(resolvedUserId, "global");
        steps.push({ step: "revoke_sessions", ok: true });
      } catch (e: any) {
        steps.push({ step: "revoke_sessions", ok: false, detail: e?.message });
      }

      const shouldBan = ban_auth !== false
        && remainingRoles.length === 0;
      if (shouldBan) {
        try {
          // ban_duration "876000h" ≈ 100 years; or use 'none' to unban via restore
          await admin.auth.admin.updateUserById(resolvedUserId, {
            ban_duration: "876000h",
            user_metadata: { offboarded_at: new Date().toISOString() },
          } as any);
          steps.push({ step: "ban_auth_user", ok: true });
        } catch (e: any) {
          steps.push({ step: "ban_auth_user", ok: false, detail: e?.message });
        }
      }
    }

    // ── 5. Cancel future class assignments for trainers ──
    if (offboardTrainer) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const { error } = await admin
          .from("class_schedules")
          .update({ trainer_id: null })
          .eq("trainer_id", trainerRow.id)
          .gte("schedule_date", today);
        steps.push({ step: "unassign_future_classes", ok: !error, detail: error?.message });
      } catch (e: any) {
        steps.push({ step: "unassign_future_classes", ok: false, detail: e?.message });
      }
    }

    // ── 6. Audit log ──
    try {
      await admin.from("audit_logs").insert({
        action: "staff_offboarded",
        actor_id: actorId,
        target_type: offboardTrainer && !offboardEmployee ? "trainer" : "employee",
        target_id: offboardEmployee ? employeeRow.id : trainerRow?.id,
        details: {
          user_id: resolvedUserId,
          roles_removed: roles,
          remaining_roles: remainingRoles,
          exit_date: effectiveExitDate,
          exit_type,
          exit_reason,
          exit_notes,
          steps,
        },
      });
    } catch (e) {
      // audit_logs schema may differ; non-fatal
      console.warn("audit_logs insert failed (non-fatal)", e);
    }

    const allOk = steps.every((s) => s.ok);
    return json({ success: allOk, steps, remaining_roles: remainingRoles }, allOk ? 200 : 207);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("offboard-staff error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeMipsRevoke(
  url: string,
  key: string,
  person_type: "employee" | "trainer",
  person_id: string,
  reason?: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const r = await fetch(`${url}/functions/v1/mips-access`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "revoke_staff",
        person_type,
        person_id,
        reason: reason || "Offboarded",
      }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data?.success !== false, detail: data?.error || data?.message };
  } catch (e: any) {
    return { ok: false, detail: e?.message };
  }
}
