// v1.1.0 — owners/admins/branch managers may view; cache key = goals + health only; refresh for managers only.
// v1.0.0 — AI precaution guide for a trainer's own client. Sends only health facts (no name/phone).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f-]{36}$/i;

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TOOL = {
  type: "function",
  function: {
    name: "precaution_guide",
    description: "Structured training precautions for a gym trainer.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "1-2 sentence overview" },
        warning_signs: { type: "array", items: { type: "string" }, description: "Signs to stop the session immediately" },
        avoid_or_modify: { type: "array", items: { type: "string" } },
        safer_alternatives: { type: "array", items: { type: "string" } },
        how_to_start: { type: "array", items: { type: "string" }, description: "Intensity, rest, progression" },
        ask_before_training: { type: "array", items: { type: "string" } },
        needs_doctor_clearance: { type: "boolean" },
      },
      required: ["summary", "warning_signs", "avoid_or_modify", "safer_alternatives", "how_to_start", "ask_before_training", "needs_doctor_clearance"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: cErr } = await userClient.auth.getClaims(auth.slice(7));
    if (cErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const uid = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const memberId = String(body?.member_id ?? "");
    const refreshRequested = body?.refresh === true;
    if (!UUID.test(memberId)) return json({ error: "member_id required" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: canView } = await admin.rpc("_can_view_member_health", { p_user: uid, p_member: memberId });
    if (!canView) return json({ error: "Not allowed to view this member" }, 403);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", uid);
    const isManager = (roleRows ?? []).some((r) => ["owner", "admin", "manager"].includes(String(r.role)));
    const refresh = refreshRequested && isManager;

    const { data: m } = await admin.from("members")
      .select("branch_id, health_conditions, fitness_goals, fitness_level, user_id")
      .eq("id", memberId).maybeSingle();
    if (!m) return json({ error: "Not found" }, 404);

    // Kill switch
    const { data: flags } = await admin.from("settings").select("branch_id, value")
      .eq("key", "trainer_health_ai").or(`branch_id.eq.${m.branch_id},branch_id.is.null`);
    const flag = (flags ?? []).find((f) => f.branch_id === m.branch_id) ?? (flags ?? [])[0];
    const fv = flag?.value as unknown;
    if (fv === false || fv === "false" || (typeof fv === "object" && fv && (fv as { enabled?: boolean }).enabled === false)) {
      return json({ error: "AI precautions are switched off for this branch" }, 403);
    }

    const { data: sig } = await admin.from("member_onboarding_signatures").select("par_q")
      .eq("member_id", memberId).order("signed_at", { ascending: false }).limit(1).maybeSingle();
    const parq = sig?.par_q && typeof sig.par_q === "object" && !Array.isArray(sig.par_q) ? sig.par_q as Record<string, string> : {};
    const parqYes = Object.entries(parq).filter(([, v]) => /^(yes|true)$/i.test(String(v))).map(([k]) => k).sort();
    let ageBand = "unknown";
    if (m.user_id) {
      const { data: p } = await admin.from("profiles").select("date_of_birth").eq("id", m.user_id).maybeSingle();
      if (p?.date_of_birth) {
        const age = Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / 31_557_600_000);
        ageBand = `${Math.floor(age / 10) * 10}s`;
      }
    }

    const facts = {
      health_conditions: m.health_conditions ?? "",
      parq_yes: parqYes,
      fitness_level: m.fitness_level ?? "",
      goals: m.fitness_goals ?? "",
      age_band: ageBand,
    };
    const hash = await sha(JSON.stringify({ goals: facts.goals, health: facts.health_conditions, parq: facts.parq_yes }));
    if (!String(facts.health_conditions).split(",").map((x) => x.trim()).filter((x) => x && !/^none\b/i.test(x)).length && !parqYes.length) {
      return json({ guidance: null, none_needed: true });
    }

    if (!refresh) {
      const { data: cached } = await admin.from("trainer_health_guidance").select("content, created_at")
        .eq("member_id", memberId).eq("conditions_hash", hash).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cached) return json({ guidance: cached.content, generated_at: cached.created_at, cached: true, can_regenerate: isManager });
    }

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "AI is not configured" }, 500);
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a cautious strength & conditioning coach advising a gym personal trainer in India. Give practical, conservative, specific precautions. Short bullet phrases (max 15 words each, 3-6 items per list). Never diagnose or prescribe medication. Recommend doctor clearance for heart, chest pain, dizziness/fainting, pregnancy, recent surgery or uncontrolled BP/diabetes." },
          { role: "user", content: `Client health facts from registration:\n${JSON.stringify(facts, null, 2)}` },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "precaution_guide" } },
      }),
    });
    if (resp.status === 429) return json({ error: "Too many requests — try again in a minute." }, 429);
    if (resp.status === 402) return json({ error: "AI credits are used up. Ask the owner to top up." }, 402);
    if (!resp.ok) return json({ error: "AI request failed" }, 502);
    const out = await resp.json();
    const args = out?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return json({ error: "AI returned no guidance" }, 502);
    const guidance = JSON.parse(args);

    const { data: saved } = await admin.from("trainer_health_guidance")
      .insert({ member_id: memberId, generated_by: uid, conditions_hash: hash, content: guidance })
      .select("created_at").single();
    await admin.from("audit_logs").insert({
      action: "health_guidance.generated", table_name: "members", record_id: memberId,
      user_id: uid, branch_id: m.branch_id, action_description: "Trainer generated AI health precautions",
    });
    return json({ guidance, generated_at: saved?.created_at, cached: false, can_regenerate: isManager });
  } catch (e) {
    console.error("trainer-health-guidance", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
