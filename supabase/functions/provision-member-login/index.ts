// provision-member-login v2.0.0 — mint (or link) an auth user + profile for a
// member that has no `user_id` yet (typically lead→member conversions).
//
// Idempotent:
//   - member already linked      → returns the existing user_id
//   - auth user with same email  → links that user instead of erroring
//
// PII resolution order: explicit overrides in the request body → linked lead row.
//
// Callers:
//   - AdminRoles "Members without login" tab (staff-initiated)
//   - MemberProfileDrawer "Create Login" quick action
//   - MemberAvatarUpload (inline provisioning before photo upload)
//   - leadService.convertToMember (best-effort, right after conversion)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPA_URL, SERVICE_KEY);

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const isSystemCall = req.headers.get("x-lovable-system") === "1";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (bearer !== SERVICE_KEY) {
    if (isSystemCall && bearer && bearer === ANON_KEY) {
      // Trigger-initiated call from Postgres via pg_net (anon bearer + system header).
    } else {
      if (!bearer) return json({ error: "unauthorized", message: "Sign in required" }, 401);
      const { data: userRes } = await admin.auth.getUser(bearer);
      const uid = userRes?.user?.id;
      if (!uid) return json({ error: "unauthorized", message: "Sign in required" }, 401);
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
      const allowed = new Set(["owner", "admin", "manager", "staff"]);
      if (!(roles || []).some((r: any) => allowed.has(r.role))) {
        return json({ error: "forbidden", message: "You do not have permission to create member logins" }, 403);
      }
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const member_id: string | undefined = body?.member_id;
    if (!member_id) return json({ error: "member_id_required", message: "member_id is required" }, 400);

    const { data: member, error: mErr } = await admin
      .from("members")
      .select("id, member_code, user_id, lead_id, branch_id")
      .eq("id", member_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!member) return json({ error: "member_not_found", message: "Member not found" }, 404);
    if (member.user_id) {
      return json({ success: true, user_id: member.user_id, action: "already_linked" });
    }

    // ---- Resolve PII -------------------------------------------------------
    let lead: any = null;
    if (member.lead_id) {
      const { data: l } = await admin
        .from("leads")
        .select("full_name, phone, email, avatar_url, date_of_birth, gender")
        .eq("id", member.lead_id)
        .maybeSingle();
      lead = l || null;
    }

    const fullName: string =
      (body?.full_name as string | undefined)?.trim() ||
      lead?.full_name ||
      `Member ${member.member_code ?? ""}`.trim();
    const email: string | null =
      normalizeEmail(body?.email) ?? normalizeEmail(lead?.email) ?? null;
    const phone: string | null =
      normalizePhone(body?.phone) ?? normalizePhone(lead?.phone) ?? null;

    if (!email && !phone) {
      return json({
        error: "no_email_or_phone",
        message: "This member has no email or phone on file. Add one before creating a login.",
      }, 422);
    }

    // ---- Find an existing auth user (paginated — do not stop at page 1) ----
    let userId: string | null = null;
    let matchedBy: "email" | "phone" | null = null;
    for (let page = 1; page <= 25 && !userId; page++) {
      const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (lErr) break;
      const users = list?.users || [];
      if (email) {
        const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (found) { userId = found.id; matchedBy = "email"; }
      }
      if (!userId && phone) {
        const digits = phone.replace(/\D/g, "");
        const found = users.find((u) => (u.phone || "").replace(/\D/g, "") === digits);
        if (found) { userId = found.id; matchedBy = "phone"; }
      }
      if (users.length < 200) break;
    }

    // Guard: the matched auth user must not already belong to another member.
    if (userId) {
      const { data: clash } = await admin
        .from("members")
        .select("id, member_code")
        .eq("user_id", userId)
        .neq("id", member_id)
        .maybeSingle();
      if (clash) {
        return json({
          error: "identity_taken",
          message: `That ${matchedBy === "phone" ? "phone" : "email"} already belongs to member ${clash.member_code}. Use a different one.`,
        }, 409);
      }
    }

    let action = "linked_existing";
    if (!userId) {
      const pwd = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: email || undefined,
        phone: phone || undefined,
        password: pwd,
        email_confirm: true,
        phone_confirm: !!phone,
        user_metadata: { full_name: fullName, source: "member_provisioning", member_id },
      });
      if (cErr) {
        const msg = (cErr.message || "").toLowerCase();
        if (msg.includes("already registered") || msg.includes("already been registered")) {
          return json({
            error: "identity_taken",
            message: "An account already exists with this email/phone but could not be linked automatically.",
          }, 409);
        }
        throw cErr;
      }
      userId = created.user!.id;
      action = "created";
    }

    // ---- Profile -----------------------------------------------------------
    const { error: pErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: fullName,
      email,
      phone,
      avatar_url: lead?.avatar_url || null,
    }, { onConflict: "id" });
    if (pErr) console.warn("profile upsert warn:", pErr.message);

    // ---- Link + role -------------------------------------------------------
    const { error: uErr } = await admin.from("members").update({ user_id: userId }).eq("id", member_id);
    if (uErr) throw uErr;

    await admin.from("user_roles").upsert(
      { user_id: userId, role: "member" },
      { onConflict: "user_id,role" },
    );

    return json({ success: true, user_id: userId, action, email, phone, full_name: fullName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("provision-member-login error:", msg);
    return json({ error: "provisioning_failed", message: msg }, 500);
  }
});

function normalizeEmail(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function normalizePhone(v: unknown): string | null {
  let s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  s = s.replace(/[^\d+]/g, "");
  if (!s.startsWith("+")) {
    const digits = s.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length === 10) s = `+91${digits}`;
    else if (digits.length > 10) s = `+${digits}`;
    else return null;
  }
  return /^\+\d{10,15}$/.test(s) ? s : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
