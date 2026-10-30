// v1.3.0 — Exercise video library lookup for the workout plan builder.
// Staff/trainer callers search (1) the exercise_video_library table, which
// holds Incline exercise names mapped to demo media, then (2) the bundled
// full Incline ExerciseDB catalog (incline-exercise-catalog.json, ~580 exercises). Each result
// carries an MP4 demo (video_url) and a light WebP preview (thumbnail_url).
// Read-only, branch-independent. Machine names are never part of the result.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { requireCaller } from "../_shared/requireCaller.ts";
import catalog from "./incline-exercise-catalog.json" with { type: "json" };

// Media lives in the private "inclineexercisedb" bucket under exercisedb/<slug>/;
// clients turn these paths into short-lived signed URLs.
const MEDIA_BASE = "";

interface CatalogEntry { s: string; t: string; m: string[]; v: string; p: string }

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

/** Mirrors public.normalize_exercise_name(). */
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

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
    const normalized = normalize(query);
    if (!normalized) return json(200, { results: [] });

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

    type Row = {
      id: string; name: string; muscle_group: string | null; equipment: string | null;
      video_url: string | null; thumbnail_url: string | null; form_cues: unknown; source: string;
    };
    const results: Row[] = [...((data ?? []) as Row[])];
    const seenVideos = new Set(results.map((r) => r.video_url));

    const words = normalized.split(" ");
    for (const e of catalog as CatalogEntry[]) {
      if (results.length >= limit * 2) break;
      const t = normalize(e.t);
      if (!words.every((w) => t.includes(w))) continue;
      const video = MEDIA_BASE + e.v;
      if (seenVideos.has(video)) continue;
      seenVideos.add(video);
      results.push({
        id: `incline:${e.s}`, name: e.t, muscle_group: e.m[0] ?? null, equipment: null,
        video_url: video, thumbnail_url: e.p ? MEDIA_BASE + e.p : null, form_cues: [], source: "incline",
      });
    }

    const rank = (n: string) => {
      const x = normalize(n);
      return x === normalized ? 0 : x.startsWith(normalized) ? 1 : 2;
    };
    results.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

    return json(200, { results: results.slice(0, limit) });
  } catch (e) {
    console.error("exercise-videos unhandled", e);
    return json(500, { error: "internal_error", message: "Something went wrong" });
  }
});
