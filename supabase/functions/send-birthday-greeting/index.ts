// send-birthday-greeting v1.0.0
// Staff-triggered birthday greeting from the dashboard Birthdays widget.
// Delegates to the shared sender so the manual "Greet" button and the nightly
// automation deliver the exact same branded message on the same channels.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendBirthdayGreeting, type BirthdayPersonType } from "../_shared/birthday-greeting.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STAFF_ROLES = new Set(["owner", "admin", "manager", "staff", "trainer"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return json(401, { success: false, error: "Not authenticated" });

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!(roles ?? []).some((r: { role: string }) => STAFF_ROLES.has(r.role))) {
      return json(403, { success: false, error: "Staff access required" });
    }

    const body = await req.json().catch(() => ({}));
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    if (!userId) return json(400, { success: false, error: "user_id is required" });

    const result = await sendBirthdayGreeting(admin as never, {
      user_id: userId,
      person_id: typeof body.person_id === "string" ? body.person_id : null,
      person_type: (body.person_type as BirthdayPersonType) ?? "member",
      branch_id: typeof body.branch_id === "string" ? body.branch_id : null,
      full_name: typeof body.full_name === "string" ? body.full_name : null,
    }, { source_caller: "send-birthday-greeting" });

    return json(200, { success: true, ...result });
  } catch (e) {
    return json(500, { success: false, error: (e as Error).message });
  }
});
