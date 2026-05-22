// v1.0.0 — Single Source of Truth prompt assembler.
//
// Every AI purpose (whatsapp_reply, lead_nurture, review_reply, …) builds its
// final system prompt through `buildSystemPrompt`. The assembly order is fixed:
//
//   1. ai_purposes.system_prompt   — the persona for THIS handle
//   2. ai_knowledge rows where applies_to contains <purpose> or 'all'
//      (ordered by priority asc, then updated_at desc) — the SHARED BRAIN
//   3. Caller-supplied dynamic context (member identity, missing fields, …)
//
// Callers (ai-agent-brain, lead-nurture-followup) must NOT inline persona text
// or behavior rules — store those in ai_purposes / ai_knowledge instead.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPurpose, type Purpose } from "./ai-runtime.ts";

export interface KnowledgeRow {
  topic: string;
  title: string;
  content: string;
  tags: string[];
  priority: number;
  applies_to: string[];
}

export interface BuildSystemPromptInput {
  supabase: SupabaseClient;
  purpose: Purpose;
  branchId?: string | null;
  /** Extra ad-hoc context appended at the end (e.g. member greeting, missing fields). */
  dynamicContext?: string;
  /** Optional fallback persona if no ai_purposes row exists yet. */
  defaultPersona?: string;
}

export interface BuildSystemPromptResult {
  prompt: string;
  persona: string;
  knowledge: KnowledgeRow[];
  used_default_persona: boolean;
}

const _kbCache = new Map<string, { rows: KnowledgeRow[]; ts: number }>();
const KB_TTL_MS = 60_000;

/** Load ai_knowledge rows applicable to a purpose+branch. Cached 60s. */
export async function loadBrainKnowledge(
  supabase: SupabaseClient,
  purpose: Purpose,
  branchId?: string | null,
): Promise<KnowledgeRow[]> {
  const key = `${purpose}:${branchId ?? "_"}`;
  const hit = _kbCache.get(key);
  if (hit && Date.now() - hit.ts < KB_TTL_MS) return hit.rows;

  const rows: KnowledgeRow[] = [];

  // Pull branch-specific first, then global. Postgres array overlap `&&` on
  // applies_to lets a row target many purposes (or `{all}`).
  const targets = [purpose, "all"];

  async function fetchScope(scope: "branch" | "global") {
    let q = supabase
      .from("ai_knowledge")
      .select("topic, title, content, tags, priority, applies_to")
      .eq("is_active", true)
      .eq("status", "active")
      .overlaps("applies_to", targets)
      .order("priority", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(30);
    q = scope === "branch" && branchId ? q.eq("branch_id", branchId) : q.is("branch_id", null);
    const { data, error } = await q;
    if (error) {
      console.warn(`[ai-prompt] loadBrainKnowledge(${scope}) failed:`, error.message);
      return;
    }
    if (data) rows.push(...(data as KnowledgeRow[]));
  }

  if (branchId) await fetchScope("branch");
  await fetchScope("global");

  _kbCache.set(key, { rows, ts: Date.now() });
  return rows;
}

function renderKnowledge(rows: KnowledgeRow[]): string {
  if (!rows.length) return "";
  const lines: string[] = ["### GYM BRAIN — KNOWLEDGE & RULES"];
  for (const r of rows) {
    lines.push(`\n[${r.topic}] ${r.title}\n${r.content.trim()}`);
  }
  return lines.join("\n");
}

/** Assemble the full system prompt for a purpose. */
export async function buildSystemPrompt(
  input: BuildSystemPromptInput,
): Promise<BuildSystemPromptResult> {
  const { supabase, purpose, branchId, dynamicContext, defaultPersona } = input;

  const purposeRow = await loadPurpose(supabase, purpose, branchId ?? null);
  const personaFromDb = purposeRow?.system_prompt?.trim() ?? "";
  const usedDefault = personaFromDb.length === 0;
  const persona = personaFromDb || (defaultPersona?.trim() ?? "");

  const knowledge = await loadBrainKnowledge(supabase, purpose, branchId);
  const knowledgeBlock = renderKnowledge(knowledge);

  const segments = [persona, knowledgeBlock, dynamicContext?.trim() ?? ""].filter(
    (s) => s && s.length > 0,
  );

  return {
    prompt: segments.join("\n\n"),
    persona,
    knowledge,
    used_default_persona: usedDefault,
  };
}
