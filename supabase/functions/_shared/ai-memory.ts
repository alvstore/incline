// v1.0.0 — AI Memory & Knowledge persistence helpers
// Single source of truth for reading/writing per-contact memory (ai_memory)
// and branch knowledge base (ai_knowledge) from edge functions.
//
// Why this exists: prior versions kept conversation context only in edge-fn
// memory + the whatsapp_messages table. ai_memory + ai_knowledge tables stayed
// empty. This module hydrates both on every agent turn and persists deltas
// (profile, facts, asked_questions, do_not_ask, summary, current_intent).

type SB = any;

export interface AiMemoryRow {
  id: string;
  branch_id: string | null;
  contact_key: string;
  platform: string;
  current_intent: string | null;
  profile: Record<string, any>;
  facts: Record<string, any>;
  asked_questions: string[];
  do_not_ask: string[];
  summary: string | null;
  last_seen_at: string;
}

export interface MemoryPatch {
  current_intent?: string | null;
  profile?: Record<string, any>;          // shallow-merged
  facts?: Record<string, any>;            // shallow-merged
  asked_questions_add?: string[];         // appended (dedup)
  do_not_ask_add?: string[];              // appended (dedup)
  summary?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeBranch(branchId?: string | null): string | null {
  if (!branchId) return null;
  return UUID_RE.test(branchId) ? branchId : null;
}

/** Load (or null) ai_memory row for a contact. */
export async function loadMemory(
  supabase: SB,
  branchId: string | null | undefined,
  platform: string,
  contactKey: string,
): Promise<AiMemoryRow | null> {
  if (!contactKey) return null;
  const branch = safeBranch(branchId);
  try {
    let q = supabase
      .from("ai_memory")
      .select("*")
      .eq("platform", platform)
      .eq("contact_key", contactKey)
      .limit(1);
    q = branch ? q.eq("branch_id", branch) : q.is("branch_id", null);
    const { data } = await q.maybeSingle();
    return (data as AiMemoryRow) || null;
  } catch (e) {
    console.warn("[ai-memory] loadMemory failed:", (e as Error).message);
    return null;
  }
}

/** Upsert a memory patch. Merges profile/facts JSONB and dedup-appends arrays. */
export async function upsertMemory(
  supabase: SB,
  branchId: string | null | undefined,
  platform: string,
  contactKey: string,
  patch: MemoryPatch,
): Promise<void> {
  if (!contactKey) return;
  const branch = safeBranch(branchId);
  try {
    const existing = await loadMemory(supabase, branch, platform, contactKey);
    const profile = { ...(existing?.profile || {}), ...(patch.profile || {}) };
    const facts = { ...(existing?.facts || {}), ...(patch.facts || {}) };
    const asked = Array.from(new Set([
      ...(existing?.asked_questions || []),
      ...(patch.asked_questions_add || []),
    ]));
    const dna = Array.from(new Set([
      ...(existing?.do_not_ask || []),
      ...(patch.do_not_ask_add || []),
    ]));
    const row = {
      branch_id: branch,
      contact_key: contactKey,
      platform,
      current_intent: patch.current_intent !== undefined
        ? patch.current_intent
        : existing?.current_intent ?? null,
      profile,
      facts,
      asked_questions: asked,
      do_not_ask: dna,
      summary: patch.summary !== undefined ? patch.summary : existing?.summary ?? null,
      last_seen_at: new Date().toISOString(),
    };
    // Unique index uses COALESCE(branch_id, zero-uuid), platform, contact_key.
    // Upsert via update-on-conflict isn't reliable across the COALESCE, so we
    // do a manual update / insert.
    if (existing?.id) {
      await supabase.from("ai_memory").update(row).eq("id", existing.id);
    } else {
      await supabase.from("ai_memory").insert(row);
    }
  } catch (e) {
    console.warn("[ai-memory] upsertMemory failed:", (e as Error).message);
  }
}

/** Render an ai_memory row as a system-prompt block (or empty string). */
export function renderMemoryBlock(mem: AiMemoryRow | null): string {
  if (!mem) return "";
  const lines: string[] = ["[CONTACT MEMORY — known from past conversations, treat as ground truth]"];
  if (mem.summary) lines.push(`Summary: ${mem.summary}`);
  if (mem.current_intent) lines.push(`Current intent: ${mem.current_intent}`);
  const profileEntries = Object.entries(mem.profile || {})
    .filter(([_, v]) => v !== null && v !== "" && v !== undefined);
  if (profileEntries.length) {
    lines.push(`Profile: ${profileEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  const factEntries = Object.entries(mem.facts || {})
    .filter(([_, v]) => v !== null && v !== "" && v !== undefined);
  if (factEntries.length) {
    lines.push(`Known facts: ${factEntries.map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s}`;
    }).join("; ")}`);
  }
  // Surface consent state explicitly so the model can't miss it
  const consent = (mem.facts as any)?.consent || {};
  if (consent.push_contact_ask === "declined") {
    lines.push(`CONSENT: user declined push for contact details — DO NOT ask for phone/email/callback in this reply.`);
  }
  if (consent.wants_human === true) {
    lines.push(`CONSENT: user wants a human — keep it short and acknowledge a teammate will follow up.`);
  }
  if (mem.do_not_ask?.length) {
    lines.push(`DO NOT re-ask for: ${mem.do_not_ask.join(", ")}`);
  }
  if (mem.asked_questions?.length) {
    const recent = mem.asked_questions.slice(-6);
    lines.push(`Already asked: ${recent.join(" | ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

// ─── Knowledge base ──────────────────────────────────────────────────────────

export interface AiKnowledgeRow {
  topic: string;
  title: string;
  content: string;
  tags: string[];
}

const _kbCache = new Map<string, { rows: AiKnowledgeRow[]; ts: number }>();

/** Load active ai_knowledge entries for a branch (branch-specific + global). */
export async function loadKnowledge(
  supabase: SB,
  branchId: string | null | undefined,
  topic?: string,
): Promise<AiKnowledgeRow[]> {
  const branch = safeBranch(branchId);
  const cacheKey = `${branch || "global"}:${topic || "*"}`;
  const cached = _kbCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60_000) return cached.rows;
  try {
    const rows: AiKnowledgeRow[] = [];
    // Branch-specific
    if (branch) {
      let q = supabase
        .from("ai_knowledge")
        .select("topic, title, content, tags")
        .eq("is_active", true)
        .eq("branch_id", branch)
        .limit(20);
      if (topic) q = q.eq("topic", topic);
      const { data } = await q;
      if (data) rows.push(...(data as AiKnowledgeRow[]));
    }
    // Global
    {
      let q = supabase
        .from("ai_knowledge")
        .select("topic, title, content, tags")
        .eq("is_active", true)
        .is("branch_id", null)
        .limit(20);
      if (topic) q = q.eq("topic", topic);
      const { data } = await q;
      if (data) rows.push(...(data as AiKnowledgeRow[]));
    }
    _kbCache.set(cacheKey, { rows, ts: Date.now() });
    return rows;
  } catch (e) {
    console.warn("[ai-memory] loadKnowledge failed:", (e as Error).message);
    return [];
  }
}

/** Render knowledge rows as a system-prompt block. */
export function renderKnowledgeBlock(rows: AiKnowledgeRow[]): string {
  if (!rows.length) return "";
  const byTopic = new Map<string, AiKnowledgeRow[]>();
  for (const r of rows) {
    const arr = byTopic.get(r.topic) || [];
    arr.push(r);
    byTopic.set(r.topic, arr);
  }
  const out = ["[CUSTOM KNOWLEDGE BASE — authoritative answers, prefer over generic info]"];
  for (const [topic, arr] of byTopic) {
    out.push(`\n# ${topic.toUpperCase()}`);
    for (const r of arr) out.push(`• ${r.title}: ${r.content}`);
  }
  return out.join("\n");
}
