// provision-member-login v1.0.0 — mint an auth user + profile for a member that
// was converted from a lead (or is otherwise missing user_id). Idempotent: if
// an auth user with the same email already exists, links that user instead of
// erroring. Called by:
//   - leadService.convertToMember (after convert_lead_to_member RPC succeeds)
//   - Manual backfill for legacy rows

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
  if (bearer !== SERVICE_KEY) {
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const { data: userRes } = await admin.auth.getUser(bearer);
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    const allowed = new Set(["owner", "admin", "manager", "staff"]);
    if (!(roles || []).some((r: any) => allowed.has(r.role))) return json({ error: "Forbidden" }, 403);
  }

  try {
    const { member_id } = await req.json();
    if (!member_id) return json({ error: "member_id required" }, 400);

    const { data: member, error: mErr } = await admin
      .from("members")
      .select("id, user_id, lead_id, branch_id, leads:lead_id(full_name, phone, email, avatar_url, date_of_birth, gender)")
      .eq("id", member_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!member) return json({ error: "member_not_found" }, 404);
    if (member.user_id) return json({ success: true, user_id: member.user_id, action: "already_linked" });

    const lead = (member as any).leads || null;
    if (!lead) return json({ error: "no_lead_pii_available" }, 422);

    const fullName: string = lead.full_name || "Member";
    const email: string | null = lead.email || null;
    const phone: string | null = lead.phone || null;

    if (!email && !phone) return json({ error: "no_email_or_phone" }, 422);

    // Look up existing auth user by email first
    let userId: string | null = null;
    if (email) {
      // admin.listUsers filter by email
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (found) userId = found.id;
    }

    let action = "linked_existing";
    if (!userId) {
      // Create user
      const pwd = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: email || undefined,
        phone: phone || undefined,
        password: pwd,
        email_confirm: true,
        phone_confirm: !!phone,
        user_metadata: { full_name: fullName, source: "lead_conversion", member_id },
      });
      if (cErr) throw cErr;
      userId = created.user!.id;
      action = "created";
    }

    // Upsert profile
    const { error: pErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: fullName,
      email: email,
      phone: phone,
      avatar_url: lead.avatar_url || null,
    }, { onConflict: "id" });
    if (pErr) console.warn("profile upsert warn:", pErr.message);

    // Link user_id on member
    const { error: uErr } = await admin.from("members").update({ user_id: userId }).eq("id", member_id);
    if (uErr) throw uErr;

    // Assign member role (idempotent)
    await admin.from("user_roles").upsert({ user_id: userId, role: "member" }, { onConflict: "user_id,role" });

    return json({ success: true, user_id: userId, action });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("provision-member-login error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
