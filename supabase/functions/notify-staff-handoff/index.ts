// v1.1.0 — Notify staff on personal WhatsApp when a chat handoff is requested.
// Supports targeted (staff_user_id) or broadcast (omit staff_user_id → all available staff in branch).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { staff_user_id, member_phone, reason, branch_id } = await req.json();
    if (!member_phone) return json({ error: "member_phone required" }, 400);
    if (!branch_id) return json({ error: "branch_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Resolve target staff: explicit one OR all available routing rows on the branch.
    let routes: Array<{ user_id: string; personal_phone: string | null; is_available: boolean }> = [];
    if (staff_user_id) {
      const { data } = await admin
        .from("staff_whatsapp_routing")
        .select("user_id, personal_phone, is_available")
        .eq("user_id", staff_user_id)
        .eq("branch_id", branch_id)
        .maybeSingle();
      if (data) routes = [data as any];
    } else {
      const { data } = await admin
        .from("staff_whatsapp_routing")
        .select("user_id, personal_phone, is_available")
        .eq("branch_id", branch_id)
        .eq("is_available", true);
      routes = (data as any[]) || [];
    }

    if (routes.length === 0) {
      return json({ delivered: false, reason: "no_available_staff" });
    }

    const link = `${supabaseUrl.replace(".supabase.co", "")}/whatsapp-chat?phone=${member_phone}`;
    const body = `🔔 *Chat Handoff*\nMember: ${member_phone}\nReason: ${reason || "Member needs human assistance"}\nOpen chat: ${link}`;

    let delivered = 0;
    for (const r of routes) {
      // Always create the in-app notification.
      await admin.from("notifications").insert({
        user_id: r.user_id,
        title: "Chat assigned to you",
        message: `${member_phone} needs human assistance${reason ? `: ${reason}` : ""}`,
        action_url: `/whatsapp-chat?phone=${member_phone}`,
      });

      if (!r.personal_phone || !r.is_available) continue;
      const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ to: r.personal_phone, branch_id, message: body }),
      });
      if (resp.ok) delivered++;
    }

    return json({ delivered: delivered > 0, count: delivered, total: routes.length });
  } catch (e: any) {
    return json({ error: e?.message }, 500);
  }
});

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
