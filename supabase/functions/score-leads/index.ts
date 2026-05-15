// v2.0.0 — AI Lead Scoring Edge Function (SSOT: routes through ai-runtime)
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateOnce } from "../_shared/ai-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lead_id, lead_ids } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

      const prompt = `You are a gym CRM lead scoring assistant. Analyze this lead and return a JSON object with:
- score: number 0-100 (likelihood to convert to paying gym member)
- reasoning: brief 1-2 sentence explanation
- next_best_action: specific actionable suggestion

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
