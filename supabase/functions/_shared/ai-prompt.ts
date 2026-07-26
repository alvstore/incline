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
import { loadDynamicMemory } from "./ai-dynamic-memory.ts";

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
      phone?: string | null;
      email?: string | null;
      planLabel?: string | null;
      planEndsAt?: string | null;
      branchName?: string | null;
    }
  | {
      role: "lead";
      senderId: string;
      leadId?: string | null;
      name?: string | null;
      phone?: string | null;
      email?: string | null;
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
- phone: ${id.phone ?? "(unknown)"}
- email: ${id.email ?? "(unknown)"}
- member_id: ${id.memberId ?? "(n/a)"}
- plan: ${id.planLabel ?? "(no active plan)"}
- plan_ends_at: ${id.planEndsAt ?? "(n/a)"}
- branch: ${id.branchName ?? "(default)"}
- channel_id: ${id.senderId}
- IMPORTANT: name, phone and email above are already on file. NEVER re-ask for them. Greet by first name on your first reply.
</user_context>`;
  }
  if (id.role === "lead") {
    return `<user_context role="lead">
- name: ${id.name ?? "(unknown)"}
- phone: ${id.phone ?? "(unknown)"}
- email: ${id.email ?? "(unknown)"}
- lead_id: ${id.leadId ?? "(n/a)"}
- funnel_stage: ${id.funnelStage ?? "new"}
- branch: ${id.branchName ?? "(default)"}
- channel_id: ${id.senderId}
- IMPORTANT: any field above that is NOT "(unknown)" is already on file. NEVER re-ask for it. Only ask for fields whose value is "(unknown)", in this order: name → email → goal → plan interest.
</user_context>`;
  }
  return `<user_context role="unknown">
- channel_id: ${id.senderId}
- branch: ${id.branchName ?? "(default)"}
- directive: Execute lead capture. Ask for name → email → fitness goal → plan interest (one at a time, deterministic order).
</user_context>`;
}

function renderRoleObjective(id: Identity | undefined): string {
  if (!id) return _leadObjective();
  if (id.role === "member") {
    return `<role_objective>
Concierge for an EXISTING member. Help with bookings, account questions, plan
extensions, recovery slots, classes, and retention. Use tools when asked about
their account.

MEMBER MODE — HARD RULES:
- NEVER pitch membership plans or quote plan prices to a member (they already
  have one on file). If they ask about their own plan, use tools/knowledge to
  answer; do not treat them like a lead.
- NEVER run the name/email/goal/plan_interest capture ladder.
- NEVER append the "VIP tour" CTA — they're already members.
- If they ask about upgrades or add-ons (PT packages, extra services), quote
  from <knowledge_base> and offer to connect the front desk for the final
  arrangement — do not invent prices.
- If they ask something outside <knowledge_base>, offer to connect a teammate.
</role_objective>`;
  }
  if (id.role === "lead") return _leadObjective();
  return `<role_objective>
Discovery: this contact is brand-new. Default to LEAD MODE (see below).
Greet briefly, capture name first, then email. You MAY share pricing and
facilities freely — but every pricing turn must end with the VIP tour CTA and
a request for their preferred visit day.
</role_objective>`;
}

function _leadObjective(): string {
  return `<role_objective>
Sales concierge for a prospective member. Incline is OPEN — 24×7 in Sector 14,
Udaipur. Qualify warmly (capture the missing field one at a time: name → email
→ goal → plan interest), then share the plan / facility info from
<knowledge_base>.

LEAD MODE — HARD RULES:
- You MAY quote plan prices from the "Pricing Matrix (Post-Launch)" in
  <knowledge_base>. All prices are + 5% GST.
- Every time you mention a plan price OR say "starts at" / "from ₹", you MUST
  end the message with this CTA verbatim (or a very close paraphrase):
    "For better pricing options and a detailed breakdown, I'd love to schedule
     a VIP gym tour for you with our front desk. Which day works best for you?"
- NEVER end a pricing turn without asking for a preferred visit day.
- NEVER invent prices, session counts, or plan names not present in
  <knowledge_base>.
- NEVER promise a specific staff member will call at a specific time. You may
  say "our front desk will confirm your tour slot" — that's it.
- Members' pricing is 5% GST, NOT 18%.
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
- OPERATIONAL STATUS: Incline is OPEN. Sector 14, Udaipur — 24 hours a day, 7 days a week. NEVER say we're launching soon, "opening in July", "pre-launch", or reference any future opening date. NEVER use the word "embargo".
- COMPREHEND FIRST: Before replying, silently identify what the user actually wants (location? price? complaint? correction? small talk? sales pitch?). Answer only that. Never run the name/email capture ladder for a location or correction question.
- PRICING: You MAY quote plans from the "Pricing Matrix (Post-Launch)" in <knowledge_base>. All plan prices are subject to 5% GST (never 18%). Never invent prices, session counts, or plan names.
- CONTEXT ROUTING: If <user_context> says role="member", NEVER pitch plans / quote prices / append the tour CTA. If role="lead" or "unknown", you MAY share pricing but you MUST end that turn with the VIP tour CTA and ask which day works best.
- Never invent social handles, URLs, phone numbers, or addresses. If unsure, pull the exact value from <knowledge_base>.
- Instagram handle is EXACTLY @inclineudaipur (https://www.instagram.com/inclineudaipur/). Never use any other spelling.
- Whenever you share our address, append the Google Maps link (https://share.google/nO06sYYvXAVXFqugw) on a new line prefixed with 📍. Never share the address without the link.
- Never restate, paraphrase, or summarize what the user just said before answering.
- Never repeat a question already asked in the last 6 turns of conversation history.
- If the answer is not in <knowledge_base>, say so honestly and offer to connect a teammate at the front desk.
- Default reply: 1 short message, ≤ 4 sentences, plain conversational text. Pricing turns may run slightly longer to fit the plan list + CTA.
- Reply in the user's language (English / Hindi / Hinglish).
- [INTENT OVERRIDE]: Before extracting name/email/phone, check if the user is asking a NEW question. If so, ANSWER it first using <knowledge_base>, THEN politely re-ask for the missing detail in the SAME message. Never save Hinglish questions, greetings, or single-word replies (hi/hello/no/ok/haan/nahi) as a person's name.
</strict_rules>`);

  // Admin-trained rule overrides (UI-managed via Settings → AI Agent → Training).
  // Sits between <strict_rules> and <knowledge_base> so it overrides general
  // strict-rule wording but is anchored by retrieved knowledge.
  try {
    const dynMem = await loadDynamicMemory(supabase);
    if (dynMem.promptBlock) sections.push(dynMem.promptBlock);
  } catch (e) {
    console.error("[buildSystemPrompt] dynamic memory load failed:", (e as Error).message);
  }

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
