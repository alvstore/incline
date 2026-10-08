// v3.1.0 — Thin shim. All Google Reviews logic now lives in `google-reviews-brain`.
// Caller must be internal, branch staff for the feedback's branch, or the member who owns it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCaller, canActOnBranch } from "../_shared/requireCaller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await requireCaller(req, corsHeaders, {
      roles: ["owner", "admin", "manager", "staff", "trainer", "member"],
    });
    if (!caller.ok) return caller.response;
    const body = await req.json().catch(() => ({}));
    const feedbackId = typeof body?.feedback_id === "string" ? body.feedback_id : null;
    if (!feedbackId) return json({ error: "feedback_id required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!caller.internal) {
      const { data: fb } = await sb.from("feedback").select("id, branch_id, member_id").eq("id", feedbackId).maybeSingle();
      if (!fb) return json({ error: "Not found" }, 404);
      const isStaff = caller.roles.some((r) => ["owner", "admin", "manager", "staff"].includes(r));
      let allowed = isStaff && (await canActOnBranch(caller, fb.branch_id));
      if (!allowed && fb.member_id) {
        const { data: m } = await sb.from("members").select("id").eq("id", fb.member_id).eq("user_id", caller.userId!).maybeSingle();
        allowed = !!m;
      }
      if (!allowed) return json({ error: "Forbidden" }, 403);
    }

    const { data, error } = await sb.functions.invoke("google-reviews-brain", {
      body: { action: "request_member_review", feedback_id: feedbackId, channel: body?.channel },
    });
    if (error) return json({ error: "Request failed" }, 500);
    return json(data);
  } catch (_err) {
    return json({ error: "Request failed" }, 500);
  }
});
