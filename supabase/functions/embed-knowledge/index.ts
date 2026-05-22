// v1.0.0 — Embed a single ai_knowledge row, OR embed a one-shot query.
//
// Two modes:
//   POST { id: "<uuid>" }                  → loads row, embeds, writes back.
//   POST { mode: "query", text: "..." }    → returns { embedding: number[] }.
//
// Called by:
//   • DB trigger `tg_ai_knowledge_enqueue_embed` after every insert/update.
//   • `ai-prompt.ts` per inbound message to embed the user's query.
//
// Uses Lovable AI Gateway (google/gemini-embedding-001, dim=1536).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-embedding-001",
      input: text.slice(0, 30_000),
      dimensions: 1536,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embedding ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data?.[0]?.embedding as number[];
}

function flattenSourceData(d: unknown): string {
  if (!d || typeof d !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "object") parts.push(`${k}: ${JSON.stringify(v)}`);
    else parts.push(`${k}: ${String(v)}`);
  }
  return parts.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json().catch(() => ({}));

    // Query mode: caller wants a vector back for a one-shot user message.
    if (body?.mode === "query") {
      const text = String(body.text || "").trim();
      if (!text) {
        return new Response(JSON.stringify({ error: "missing text" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const vec = await embed(text);
      return new Response(JSON.stringify({ embedding: vec }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Row mode: load row, embed, write back.
    const id = String(body?.id || "").trim();
    if (!id) {
      return new Response(JSON.stringify({ error: "missing id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: row, error } = await supa
      .from("ai_knowledge")
      .select("id, title, content, source_data")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return new Response(JSON.stringify({ ok: false, reason: "row_missing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const input = [
      String(row.title || "").trim(),
      String(row.content || "").trim(),
      flattenSourceData(row.source_data),
    ].filter(Boolean).join("\n\n");

    if (!input) {
      return new Response(JSON.stringify({ ok: false, reason: "empty_content" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vec = await embed(input);
    // pgvector wire format: stringified bracket array.
    const literal = `[${vec.join(",")}]`;
    const { error: upErr } = await supa
      .from("ai_knowledge")
      .update({ embedding: literal })
      .eq("id", id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, id, dims: vec.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[embed-knowledge] error", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
