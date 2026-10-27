// v1.0.0 — Exercise video library lookup for the workout plan builder.
// Staff/trainer callers search the curated exercise_video_library catalog by
// name; results include an optional demo video URL and form cues that the
// builder can attach to a plan exercise. Read-only, branch-independent.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { requireCaller } from "../_shared/requireCaller.ts";

const QuerySchema = z.object({
  query: z.string().trim().min(1).max(80),
  limit: z.number().int().min(1).max(20).optional().default(8),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireCaller(req, corsHeaders, {
      roles: ["owner", "admin", "manager", "staff", "trainer"],
      allowInternal: true,
    });
    if (!caller.ok) return caller.response;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return json(400, { error: "invalid_input", message: "Body must be valid JSON" });
    }
    const parsed = QuerySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json(400, { error: "invalid_input", details: parsed.error.flatten() });
    }
    const { query, limit } = parsed.data;

    // Prefix match first (uses the text_pattern_ops index), then substring.
    const normalized = query.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim();
    const { data, error } = await caller.admin
      .from("exercise_video_library")
      .select("id, name, muscle_group, equipment, video_url, thumbnail_url, form_cues, source")
      .eq("active", true)
      .ilike("normalized_name", `%${normalized}%`)
      .order("name", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("exercise-videos query failed", { code: error.code });
      return json(500, { error: "internal_error", message: "Lookup failed" });
    }

    // Rank: exact > prefix > substring.
    const ranked = (data ?? []).sort((a, b) => {
      const score = (n: string) =>
        n.normalized === undefined ? 0 : 0; // placeholder, replaced below
      void score;
      const an = (a.name as string).toLowerCase();
      const bn = (b.name as string).toLowerCase();
      const rank = (n: string) =>
        n === normalized ? 0 : n.startsWith(normalized) ? 1 : 2;
      return rank(an) - rank(bn) || an.localeCompare(bn);
    });

    return json(200, { results: ranked });
  } catch (e) {
    console.error("exercise-videos unhandled", e);
    return json(500, { error: "internal_error", message: "Something went wrong" });
  }
});
