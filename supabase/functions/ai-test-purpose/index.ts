// v1.0.0 — Test the resolved provider for a given AI purpose by sending a 1-token ping.
// Used by AI Purposes tab "Test" button. Owner/admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, type AIScope } from "../_shared/ai-dispatcher.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCOPE_MAP: Record<string, AIScope> = {
  whatsapp_reply: "whatsapp_ai",
  lead_nurture: "lead_nurture",
  lead_score: "lead_scoring",
  campaign_draft: "all",
  template_generate: "all",
  dashboard_insight: "dashboard_insights",
  fitness_plan: "fitness_plans",
  review_reply: "all",
  automation_rule: "all",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await userClient.auth.getUser();
    if (!authData?.user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", authData.user.id);
    if (!roles?.some((r: any) => ["owner", "admin"].includes(r.role))) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json();
    const purpose = String(body?.purpose || "");
    const scope = SCOPE_MAP[purpose];
    if (!scope) return json({ error: "Unknown purpose" }, 400);

    // Pull purpose model override (if any)
    const { data: purposeRow } = await supabase
      .from("ai_purposes")
      .select("model")
      .eq("purpose", purpose)
      .is("branch_id", null)
      .maybeSingle();

    const start = Date.now();
    try {
      const r = await callAI({
        scope,
        supabase,
        model: purposeRow?.model || undefined,
        max_tokens: 10,
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
      });
      return json({
        success: true,
        provider: r.provider,
        model: r.model,
        fallback_used: r.fallback_used,
        latency_ms: Date.now() - start,
        sample: r.content?.slice(0, 200) ?? "",
      });
    } catch (e) {
      return json({
        success: false,
        latency_ms: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      }, 200);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
