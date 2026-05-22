// v2.0.0 — SSOT prompt assembler with semantic retrieval + identity routing.
//
// What changed vs v1:
//   • No more 60s in-memory cache. Retrieval is per inbound message.
//   • No more wholesale dump of every ai_knowledge row. We embed the user's
//     message and pull only the rows whose cosine similarity ≥ 0.75 (capped
//     at 12), plus all priority<=10 "rule" rows. If nothing passes the
//     threshold the RPC falls back to top-3 by distance so the model is
//     never empty-handed. See migration `match_ai_knowledge`.
//   • Final prompt is wrapped in strict XML tags (<persona> / <strict_rules>
//     / <user_context> / <role_objective> / <knowledge_base> / <runtime>)
//     to keep the model grounded and stop it from parroting the user.
//   • Identity routing: callers pass an `Identity` discriminated union; the
//     prompt's <role_objective> changes for member vs lead vs unknown.
//
// Callers (ai-agent-brain, lead-nurture-followup, ai-test-purpose) MUST pass
// `userMessage` for retrieval to be meaningful. Without it we degrade to
// "rules only" (still grounded, just no semantic context).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPurpose, type Purpose } from "./ai-runtime.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KnowledgeRow {
  id?: string;
  topic: string;
  title: string;
  content: string;
  source?: string;
  source_data?: Record<string, unknown> | null;
  priority: number;
  similarity?: number;
  is_rule?: boolean;
}

export type Identity =
  | {
      role: "member";
      senderId: string;
      memberId?: string | null;
      name?: string | null;
      planLabel?: string | null;
      planEndsAt?: string | null;
      branchName?: string | null;
    }
  | {
      role: "lead";
      senderId: string;
      leadId?: string | null;
      name?: string | null;
      funnelStage?: string | null;
      branchName?: string | null;
    }
  | {
      role: "unknown";
      senderId: string;
      branchName?: string | null;
    };

export interface BuildSystemPromptInput {
  supabase: SupabaseClient;
  purpose: Purpose;
  branchId?: string | null;
  /** The inbound user message — used to retrieve relevant knowledge. */
  userMessage?: string;
  /** Identity routing — drives <user_context> + <role_objective>. */
  identity?: Identity;
  /** Anything else the caller wants the model to see (tool docs, lead-capture
   *  protocol, etc.). Rendered inside <runtime>. */
  dynamicContext?: string;
  /** Fallback persona if no ai_purposes row exists yet. */
  defaultPersona?: string;
}

export interface BuildSystemPromptResult {
  prompt: string;
  persona: string;
  knowledge: KnowledgeRow[];
  used_default_persona: boolean;
  retrieval_mode: "semantic" | "rules_only";
}

// ─── Retrieval ──────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** Embed the user message via the embed-knowledge edge fn (query mode). */
async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-knowledge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ mode: "query", text }),
    });
    if (!res.ok) {
      console.warn("[ai-prompt] embedQuery failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    return Array.isArray(json?.embedding) ? json.embedding as number[] : null;
  } catch (e) {
    console.warn("[ai-prompt] embedQuery threw", (e as Error).message);
    return null;
  }
}

/** Always-include rules + semantically matched knowledge for this message. */
async function retrieveKnowledge(
  supabase: SupabaseClient,
  purpose: Purpose,
  branchId: string | null,
  userMessage: string | undefined,
): Promise<{ rows: KnowledgeRow[]; mode: "semantic" | "rules_only" }> {
  const msg = (userMessage || "").trim();
  if (!msg) {
    // No message → rules only (priority<=10) so we at least keep persona/rules.
    const { data } = await supabase
      .from("ai_knowledge")
      .select("id, topic, title, content, source, source_data, priority")
      .eq("is_active", true).eq("status", "active")
      .overlaps("applies_to", [purpose, "all"])
      .lte("priority", 10)
      .or(branchId ? `branch_id.is.null,branch_id.eq.${branchId}` : "branch_id.is.null")
      .order("priority", { ascending: true });
    return {
      rows: (data ?? []).map((r) => ({ ...r, is_rule: true, similarity: 0 })),
      mode: "rules_only",
    };
  }

  const embedding = await embedQuery(msg);
  if (!embedding) {
    // Fall back to rules only on embed failure — never block the reply.
    return retrieveKnowledge(supabase, purpose, branchId, undefined);
  }

  // pgvector wire format: bracketed array string is accepted by PostgREST.
  const literal = `[${embedding.join(",")}]`;
  const { data, error } = await supabase.rpc("match_ai_knowledge", {
    query_embedding: literal,
    p_purpose: purpose,
    p_branch_id: branchId,
  });
  if (error) {
    console.warn("[ai-prompt] match_ai_knowledge failed", error.message);
    return retrieveKnowledge(supabase, purpose, branchId, undefined);
  }
  return { rows: (data ?? []) as KnowledgeRow[], mode: "semantic" };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderSourceDataMarkdown(d: unknown): string {
  if (!d || typeof d !== "object") return "";
  const obj = d as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return "";
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    if (typeof v === "object") lines.push(`- **${k}**: ${JSON.stringify(v)}`);
    else lines.push(`- **${k}**: ${String(v)}`);
  }
  return lines.length ? lines.join("\n") : "";
}

function renderKnowledgeBlock(rows: KnowledgeRow[]): string {
  if (!rows.length) return "<knowledge_base>\n(no relevant knowledge for this question)\n</knowledge_base>";
  const lines: string[] = ["<knowledge_base>"];
  for (const r of rows) {
    lines.push(`\n## [${r.topic}] ${r.title}`);
    if (r.content?.trim()) lines.push(r.content.trim());
    const md = renderSourceDataMarkdown(r.source_data);
    if (md) lines.push(md);
  }
  lines.push("\n</knowledge_base>");
  return lines.join("\n");
}

function renderUserContext(id: Identity | undefined): string {
  if (!id) return "";
  if (id.role === "member") {
    return `<user_context role="member">
- name: ${id.name ?? "(unknown)"}
- member_id: ${id.memberId ?? "(n/a)"}
- plan: ${id.planLabel ?? "(no active plan)"}
- plan_ends_at: ${id.planEndsAt ?? "(n/a)"}
- branch: ${id.branchName ?? "(default)"}
- channel_id: ${id.senderId}
</user_context>`;
  }
  if (id.role === "lead") {
    return `<user_context role="lead">
- name: ${id.name ?? "(unknown)"}
- lead_id: ${id.leadId ?? "(n/a)"}
- funnel_stage: ${id.funnelStage ?? "new"}
- branch: ${id.branchName ?? "(default)"}
- channel_id: ${id.senderId}
</user_context>`;
  }
  return `<user_context role="unknown">
- channel_id: ${id.senderId}
- branch: ${id.branchName ?? "(default)"}
</user_context>`;
}

function renderRoleObjective(id: Identity | undefined): string {
  if (!id) return "";
  if (id.role === "member") {
    return `<role_objective>
Concierge for an existing member. Help with bookings, account questions, plan
extensions, recovery slots, classes, and retention. Use tools when asked about
their account. Never re-pitch them as a lead. If they ask something outside the
<knowledge_base>, offer to connect a teammate.
</role_objective>`;
  }
  if (id.role === "lead") {
    return `<role_objective>
Sales concierge for a prospective member. Qualify warmly: capture the missing
field (name → email → goal → plan interest, one at a time), then share only the
plan / facility info that appears in <knowledge_base>. Goal is to book a tour
or hand off to a human — never invent prices.
</role_objective>`;
  }
  return `<role_objective>
Discovery: this contact is brand-new. Greet briefly, capture name first, then
email. Do not pitch plans or prices until name+email are captured.
</role_objective>`;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function buildSystemPrompt(
  input: BuildSystemPromptInput,
): Promise<BuildSystemPromptResult> {
  const { supabase, purpose, branchId, userMessage, identity, dynamicContext, defaultPersona } = input;

  // 1. Persona (ai_purposes row, or caller-supplied default).
  const purposeRow = await loadPurpose(supabase, purpose, branchId ?? null);
  const personaFromDb = purposeRow?.system_prompt?.trim() ?? "";
  const usedDefault = personaFromDb.length === 0;
  const persona = personaFromDb || (defaultPersona?.trim() ?? "");

  // 2. Retrieve grounded knowledge for THIS message.
  const { rows: knowledge, mode } = await retrieveKnowledge(
    supabase,
    purpose,
    branchId ?? null,
    userMessage,
  );

  // 3. Assemble XML-tagged prompt. Order matters: persona → strict_rules →
  //    identity → role_objective → knowledge → runtime context.
  const sections: string[] = [];
  if (persona) sections.push(`<persona>\n${persona}\n</persona>`);

  sections.push(`<strict_rules>
- Never invent prices, durations, plan names, or facilities not present in <knowledge_base>.
- Never restate, paraphrase, or summarize what the user just said before answering.
- Never repeat a question already asked in the last 6 turns of conversation history.
- If the answer is not in <knowledge_base>, say so honestly and offer to connect a teammate.
- Default reply: 1 short message, ≤ 3 sentences, plain conversational text.
- Reply in the user's language (English / Hindi / Hinglish).
</strict_rules>`);

  const userCtx = renderUserContext(identity);
  if (userCtx) sections.push(userCtx);

  const objective = renderRoleObjective(identity);
  if (objective) sections.push(objective);

  sections.push(renderKnowledgeBlock(knowledge));

  if (dynamicContext?.trim()) {
    sections.push(`<runtime>\n${dynamicContext.trim()}\n</runtime>`);
  }

  return {
    prompt: sections.join("\n\n"),
    persona,
    knowledge,
    used_default_persona: usedDefault,
    retrieval_mode: mode,
  };
}
