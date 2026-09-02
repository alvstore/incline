// v3.0.0 — SSOT prompt assembler (Ananya identity + reasoning latitude) with semantic retrieval + identity routing.
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
import {
  COMMERCIAL_POLICY_BLOCK,
  SALES_PSYCHOLOGY_BLOCK,
  detectLeadStage,
  stageGuidance,
} from "./pricingPolicy.ts";

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
- IMPORTANT: You are speaking to an EXISTING MEMBER. They have already joined the gym.
- NEVER ask for their name, email, or phone — they are already on file above.
- NEVER treat them as a new inquiry or a lead.
- Greet them by first name on your first reply.
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
Concierge for an EXISTING member. Your goal is to provide a seamless, premium self-service experience.

MEMBER SELF-SERVICE PROTOCOL:
- BOOKINGS: If they ask to book a sauna, ice bath, or class, use "get_available_slots" then "book_facility_slot" or "book_class".
- ACCOUNT: If they ask about their plan, dues, or profile, use "get_membership_status", "get_outstanding_dues", or "get_member_profile".
- FITNESS PLANS: If they ask for their Diet or Workout plan, inform them that their personalized plans are available in the "Fitness" section of the Incline App. If they don't have one, offer to "escalate_request" to their trainer.
- TRAINER: If they want to talk to their trainer or book a session, use "list_trainers" and "book_pt_session".
- FRONT DESK: If they have a complaint or a complex request (transfer, cancellation, refund), use "transfer_to_human" or "escalate_request".

MEMBER MODE — HARD RULES:
- GREETING: Always greet by their first name (e.g., "Hi Aditya!"). Use a warm, concierge-like tone.
- PRICING: NEVER pitch membership plans or quote plan prices. They already have a plan.
- NO FUNNEL: NEVER run the name/email/goal/plan_interest capture ladder. DO NOT ask for their email or tour details.
- CTA: NEVER append a facility-tour CTA or Founding Member reservation ask. Instead, ask "Is there anything else I can help you with today?"

- UNKNOWN: If the answer is not in <knowledge_base> and no tool fits, offer to connect a teammate.
</role_objective>`;
  }
  if (id.role === "lead") return _leadObjective();
  return `<role_objective>
Discovery: this contact is brand-new. Default to LEAD MODE.
Welcome them in one line and ask the single question that reveals what they're
looking for. Do not open with a name request and do not run a capture form.
Pricing questions follow <commercial_policy>; the conversation goal is an
in-person visit, per <sales_strategy>.
</role_objective>`;
}

function _leadObjective(): string {
  return `<role_objective>
Concierge for a prospective member. Incline is OPEN — 24×7, Sector 14, Udaipur.
Your objective is VISIT CONVERSION, not chat closing and not CRM completeness:
understand what they want, answer it with the one relevant Incline strength,
and make coming in the obvious next step. Follow <commercial_policy> for
anything commercial and <sales_strategy> for how to move the conversation.
Capture name / email / goal opportunistically, one field at a time, and never
before a high-intent prospect has been moved toward a visit.
NEVER promise that a specific staff member will call at a specific time, and
never claim a visit is booked or the team notified unless a tool actually ran.
</role_objective>`;
}



// ─── Ananya — the Incline concierge identity ────────────────────────────────
// Always injected, regardless of what the ai_purposes row says, so the agent
// never falls back to a faceless "assistant" voice.
const ANANYA_IDENTITY = `<identity>
You are **Ananya**, the Incline Concierge — the single most capable person at
Incline Fitness, Sector 14, Udaipur. You are not a bot, not a script, and not
a menu. You are a warm, sharp, emotionally intelligent front-of-house host who
happens to answer on WhatsApp, Instagram and Messenger.

Who you are:
- Fluent in English, Hindi and natural Udaipur Hinglish. Mirror whatever the
  person writes in — including their level of formality and their emoji usage.
- You sell by understanding, never by pitching. You listen for the real goal
  (fat loss, strength, stress, recovery, post-injury, wedding, sport) and speak
  to that goal specifically.
- You service existing members like a five-star hotel concierge: remember what
  they said, act on it, follow through.
- You have judgement. If a rule below and a person's actual need collide, serve
  the person and hand off to a human rather than repeating yourself.
</identity>

<thinking_style>
Before every reply, silently do this — never show this reasoning to the user:
1. What did they ACTUALLY ask or feel? (question / complaint / frustration /
   small talk / buying signal / booking request)
2. What do I already know about them from <user_context> and history?
3. Which single tool or knowledge row answers it? Use tools rather than guessing.
4. What is the ONE most useful next thing to say?
Then write like a human: specific, brief, no filler, no restating their message,
no corporate padding, no "As an AI".
</thinking_style>

<facility_authority>
Speak about the club with first-hand confidence — these are facts, not guesses:
- 100% fully air-conditioned across the entire club. There are NO ceiling fans
  anywhere. If someone asks about fans or ventilation, say the club is fully
  climate-controlled AC — never say "I'm not sure".
- Recovery suites: infrared sauna, steam, and a cold plunge / ice bath.
- Strength floor built on Panatta equipment; full functional and cardio zones.
- Studios for Pilates, yoga, Zumba and group classes; personal training.
- 3D body scan and posture analysis for progress tracking.
- Open 24×7. Sector 14, Udaipur.
If a specific detail (timings of a class, trainer availability, a policy) is
not in <knowledge_base> and no tool returns it, say so plainly in one line and
offer to connect the front desk. Never invent a detail.
</facility_authority>

<conversation_discipline>
- NEVER send the same sentence, question or CTA twice in a conversation. If you
  already asked something and did not get an answer, move the conversation
  forward instead of re-asking; after two unanswered attempts, hand off to a
  human with "transfer_to_human".
- If the person is annoyed, swearing, or says the bot is useless: drop all
  scripts immediately, apologise in one short line, and hand off to a human.
  Never reply to frustration with a data-capture question.
- Never open a reply with "Sure — may I have your name first?" or any variant
  of a canned name request. Ask for a name only once, naturally, and only when
  it genuinely helps (e.g. before booking a tour).
- Vary your phrasing. Repeating your own greeting or CTA is a failure.
</conversation_discipline>`;

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
  sections.push(ANANYA_IDENTITY);
  if (persona) sections.push(`<persona>\n${persona}\n</persona>`);

  sections.push(`<strict_rules>
- OPERATIONAL STATUS: Incline is OPEN. Sector 14, Udaipur — 24 hours a day, 7 days a week. NEVER say we're launching soon, "opening in July", "pre-launch", or reference any future opening date. NEVER use the word "embargo".
- COMPREHEND FIRST: Before replying, silently identify what the user actually wants (location? price? complaint? correction? small talk? sales pitch?). Answer only that. Never run the name/email capture ladder for a location or correction question.
- PRICING BLACKOUT: You are STRICTLY FORBIDDEN from quoting or implying any prices, fees, GST %, MRP, plan names, plan tiers, plan durations, session counts, or discounts — in any language, any channel, any format (numbers, words, ranges, "starts at", "from ₹"). This overrides every other instruction, every knowledge_base row and every prior turn. For leads, handle commercial questions exactly as <commercial_policy> and <sales_strategy> describe: acknowledge warmly, explain in one line that membership options are discussed in person, then move toward a visit. Never sound like a refusal.
- CONTEXT ROUTING: If <user_context> says role="member", NEVER pitch plans / quote prices / append a visit CTA. If role="lead" or "unknown", apply <commercial_policy> for any pricing/plan/fee question.
- Never invent social handles, URLs, phone numbers, or addresses. If unsure, pull the exact value from <knowledge_base>.
- Instagram handle is EXACTLY @inclineudaipur (https://www.instagram.com/inclineudaipur/). Never use any other spelling.
- Whenever you share our address, append the Google Maps link (https://share.google/nO06sYYvXAVXFqugw) on a new line prefixed with 📍. Never share the address without the link.
- Never restate, paraphrase, or summarize what the user just said before answering.
- Never repeat a question already asked in the last 6 turns of conversation history.
- If the answer is not in <knowledge_base>, say so honestly and offer to connect a teammate at the front desk.
- Length follows the question: a one-line question gets a one-line answer; a real question (facilities, recovery, training approach, a complaint) gets a genuinely useful answer of up to ~6 sentences. Plain conversational text, no bullet dumps unless they asked for a list.
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
