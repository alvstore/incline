// v1.0.0 — Admin-trainable AI memory rules.
//
// Reads ai_dynamic_memory (UI-managed) and exposes:
//   • `loadDynamicMemory(supabase)`  — cached fetcher (TTL 60s)
//   • `.classify(text)`              — first matching rule (priority desc)
//   • `.promptBlock`                 — XML snippet for buildSystemPrompt()
//   • `.nameBlockSet`                — phrases that must NEVER become a first_name
//
// Cost budget: 1 indexed SELECT per minute per warm isolate, ~3-5ms.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface DynamicMemoryRow {
  id: string;
  phrase_or_pattern: string;
  intent_category: "location" | "pricing" | "timeline" | "handoff" | "decline" | "name_block" | "custom";
  correction_instruction: string;
  match_type: "exact" | "contains" | "regex";
  priority: number;
  is_active: boolean;
}

export interface DynamicMemoryBundle {
  rows: DynamicMemoryRow[];
  promptBlock: string;
  nameBlockSet: Set<string>;
  classify: (text: string) => DynamicMemoryRow | null;
}

const TTL_MS = 60_000;
let cache: { at: number; bundle: DynamicMemoryBundle } | null = null;

function compile(rows: DynamicMemoryRow[]): DynamicMemoryBundle {
  // priority desc, then exact > regex > contains
  const ordered = [...rows].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const score = (m: string) => (m === "exact" ? 3 : m === "regex" ? 2 : 1);
    return score(b.match_type) - score(a.match_type);
  });

  const nameBlockSet = new Set<string>();
  for (const r of ordered) {
    if (r.intent_category === "name_block" || r.intent_category === "location" ||
        r.intent_category === "pricing"    || r.intent_category === "timeline" ||
        r.intent_category === "handoff"    || r.intent_category === "decline") {
      nameBlockSet.add(r.phrase_or_pattern.trim().toLowerCase());
    }
  }

  const classify = (text: string): DynamicMemoryRow | null => {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return null;
    for (const r of ordered) {
      const phrase = r.phrase_or_pattern.toLowerCase().trim();
      try {
        if (r.match_type === "exact" && t === phrase) return r;
        if (r.match_type === "contains" && t.includes(phrase)) return r;
        if (r.match_type === "regex" && new RegExp(r.phrase_or_pattern, "i").test(text)) return r;
      } catch (_e) { /* malformed regex — skip */ }
    }
    return null;
  };

  let promptBlock = "";
  if (ordered.length > 0) {
    const bullets = ordered.slice(0, 50).map((r) =>
      `- When user says "${r.phrase_or_pattern}" (${r.intent_category}): ${r.correction_instruction}`
    ).join("\n");
    promptBlock = `<dynamic_training_rules>
The following rules are curated by admin staff and MUST take precedence over
any other interpretation. Apply them BEFORE answering or capturing data.
${bullets}
</dynamic_training_rules>`;
  }

  return { rows: ordered, promptBlock, nameBlockSet, classify };
}

export async function loadDynamicMemory(
  supabase: SupabaseClient,
  opts?: { force?: boolean },
): Promise<DynamicMemoryBundle> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.at < TTL_MS) return cache.bundle;

  const { data, error } = await supabase
    .from("ai_dynamic_memory")
    .select("id, phrase_or_pattern, intent_category, correction_instruction, match_type, priority, is_active")
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[ai-dynamic-memory] load failed:", error.message);
    const empty = compile([]);
    cache = { at: now, bundle: empty };
    return empty;
  }

  const bundle = compile((data ?? []) as DynamicMemoryRow[]);
  cache = { at: now, bundle };
  return bundle;
}

export function invalidateDynamicMemoryCache() { cache = null; }
