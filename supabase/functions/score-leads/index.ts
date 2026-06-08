// v2.1.0 — JWT + staff role gate added. Service-role bearer also accepted for future automation use.
// v2.0.0 — AI Lead Scoring Edge Function (SSOT: routes through ai-runtime)
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["owner", "admin", "manager", "staff"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth gate: service-role bearer OR authenticated staff/manager/admin/owner JWT.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    if (bearer !== serviceKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: claims, error: claimsErr } = await userClient.auth.getClaims(bearer);
      const userId = claims?.claims?.sub;
      if (claimsErr || !userId) {
        return json({ error: "Unauthorized" }, 401);
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", STAFF_ROLES)
        .limit(1);
      if (!roles?.length) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const { lead_id, lead_ids } = await req.json();

    const idsToScore = lead_ids || (lead_id ? [lead_id] : []);
    if (!idsToScore.length) {
      return json({ error: "Missing lead_id or lead_ids" }, 400);
    }

    const results = [];

    for (const id of idsToScore) {
      // Fetch lead
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("*")
        .eq("id", id)
        .single();
      if (leadErr || !lead) {
        results.push({ id, error: "Lead not found" });
        continue;
      }

      // Fetch activities
      const { data: activities } = await supabase
        .from("lead_activities")
        .select("activity_type, title, notes, created_at")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(20);

      // v2 — persona/rules come from ai_purposes.lead_score.system_prompt
      // (managed in Settings → AI Brain). Only the lead-data context lives here.
      const prompt = `Analyze this lead and call the score_lead tool.

Lead data:
- Name: ${lead.full_name || "Unknown"}
- Status: ${lead.status}
- Temperature: ${lead.temperature || "warm"}
- Source: ${lead.source || "direct"}
- Created: ${lead.created_at}
- Last contacted: ${lead.last_contacted_at || "never"}
- First response: ${lead.first_response_at || "none"}
- Phone: ${lead.phone ? "yes" : "no"}
- Email: ${lead.email ? "yes" : "no"}
- Goals: ${lead.goals || "not specified"}
- Budget: ${lead.budget || "not specified"}
- Tags: ${(lead.tags || []).join(", ") || "none"}
- Notes: ${lead.notes || "none"}

Recent activities (${(activities || []).length} total):
${(activities || []).slice(0, 10).map((a: any) => `- ${a.activity_type}: ${a.title || a.notes || "no details"} (${a.created_at})`).join("\n")}`;

      try {
        const r = await generateOnce({
          purpose: "lead_score",
          branchId: lead.branch_id ?? null,
          userMessage: prompt,
          supabase,
          tools: [{
            type: "function",
            function: {
              name: "score_lead",
              description: "Return lead score, reasoning, and next best action",
              parameters: {
                type: "object",
                properties: {
                  score: { type: "number", description: "Lead score 0-100" },
                  reasoning: { type: "string", description: "Brief explanation" },
                  next_best_action: { type: "string", description: "Specific actionable suggestion" },
                },
                required: ["score", "reasoning", "next_best_action"],
                additionalProperties: false,
              },
            },
          }],
          toolChoice: { type: "function", function: { name: "score_lead" } },
        });

        let parsed: any = r.toolCallArgs;
        if (!parsed) {
          const content = r.content || "";
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        }

        if (parsed && typeof parsed.score === "number") {
          const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
          await supabase.from("leads").update({ score }).eq("id", id);
          results.push({
            id,
            score,
            reasoning: parsed.reasoning || "",
            next_best_action: parsed.next_best_action || "",
          });
        } else {
          results.push({ id, error: "Failed to parse AI response" });
        }
      } catch (aiErr) {
        results.push({ id, error: `AI call failed: ${(aiErr as Error).message}` });
      }
    }

    return json({ success: true, results });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
