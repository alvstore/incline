// v4.6.0 — Two fixes for the "Rsss" repro:
//          (1) intentPivotPrefix() no longer ships internal meta-labels like
//              "Location intent —" to the user. Strips "<Category> intent —/:"
//              prefixes from curated ai_dynamic_memory rows and falls back to
//              the canonical INTENT_ANSWERS map when the cleaned text is empty
//              or still looks like an instruction.
//          (2) Name-ask de-duplication: the deterministic onboarding
//              short-circuit no longer repeats the full "Hi! I'm Ananya, the
//              member concierge…" greeting on every turn. Counts prior bot
//              name-asks in the last 10 messages and softens at turn 2,
//              acknowledges at turn 3, and stops re-asking from turn 4. Pure
//              acknowledgements ("thank you", "ok", "nevertheless") get a
//              graceful close, no name funnel. Same logic mirrored into
//              enforceNoRepeatNameAsk so model-generated replies are gated.
// v4.5.0 — Opening-date redaction: bot must NEVER quote a month/year
//          opening or launch date. Sanitizer strips any "<month> 20XX" or
//          "open/launch ... 20XX" phrase and replaces with a neutral
//          "date to be announced" line. ai_knowledge rows scrubbed in
//          companion migration. SEO files (llms.txt/llms-full.txt/ai.txt)
//          intentionally untouched.
// v4.4.0 — Hinglish intent override + answer-and-pivot. Questions like
//          "Kha pr h" / "kitna" / "kab khulega" are now classified BEFORE the
//          name funnel; the canned answer is prepended to the next capture
//          prompt and the question is blocked from ever becoming first_name
//          (deterministic guard + LLM-enrichment guard). New observability log
//          "[AI Tool Call Attempt] capture_first_name" emits accepted+rejected.
// v4.1.0 — Brain SSOT cleanup. Removed hardcoded copy for non-fitness redirect,

//          pricing/PT velvet rope, and the onboarding-order prose. All of that
//          now lives in ai_knowledge (rows: lead_capture_flow / pricing_rules /
//          pt_rules / non_membership_intent / facts) and reaches the LLM via
//          buildSystemPrompt → <knowledge_base>. Inline scaffold only enforces
//          protocol shape (interactive_list JSON contract + lead_captured
//          payload + known-fields gate). Opening date corrected to July 2026.
// v4.0.0 — Pre-Fetch Identity Injection: <user_context> now carries name/phone/email
//          across WhatsApp + IG + Messenger. resolveMemberContext falls back to
//          whatsapp_chat_settings.captured_lead_id and ai_memory.profile.phone so
//          a lead captured on one channel is recognised on every other channel.
// v3.9.0 — Lead hydration: brain now reads existing leads row by phone variants
//          and seeds ai_memory + do_not_ask BEFORE the auto-learn pass, so a
//          contact already captured via website/Meta-Ads/prior chat is NOT
//          re-asked name/email/goal/plan. Adds POST-CAPTURE NURTURE persona
//          for fully-captured / engaged leads (no onboarding, warm assist,
//          Founding Member CTA). Links existing lead to chat_settings on msg 1.
// v3.8.0 — Memory-grounded onboarding: KNOWN SO FAR hard rule in the prompt
//          + enforceNoRepeatNameAsk post-process guard. Stops the bot from
//          re-asking "What's your name?" on IG/Messenger when memory already
//          has a real first name (root cause: phone-key format mismatch made
//          history lookups return zero rows; fixed in meta-webhook v3.x).
// 3.7.0: Non-fitness guard now dedupes + pauses nurture (DNC + bot_active)
// 3.7.0: Non-fitness redirect (a) reads pattern/message/window from
//        ai_purposes.guards (no inline hardcoding), (b) dedupes against the
//        last outbound within configurable window so the same canned reply is
//        not re-sent on every follow-up, (c) calls mark_do_not_contact RPC +
//        flips whatsapp_chat_settings.bot_active=false so lead-nurture and
//        retention crons stop pinging the contact, (d) writes current_intent
//        'non_fitness' to ai_memory.
// 3.6.0: Goal & plan_interest captured via Meta interactive_list (4 rows each)
//        after name+email — eliminates dirty free-text and matches the original
//        onboarding UX that staff signed off on.
// 3.5.0: Re-enabled goal + plan_interest capture as plain-text free-form
//        questions (Name → Email → Goal → Plan Interest). Non-annual leads
//        are captured & nurtured, never refused. Sanitizer now blocks only
//        prices/PT package names/send-details — plan-duration words are
//        allowed so we can ask & acknowledge. Annual answers get the
//        Founding Member confirm pitch; non-annual answers get a soft note.
// 3.4.0: Removed plan_interest interactive list emission, replaced lead capture
//        wording with "Founding Member invite" CTA, added plain-text outbound
//        sanitizer (sanitizeFoundersPhaseText) that rewrites any reply leaking
//        Monthly/Quarterly/Half-Yearly/Annual/price/PT-package text to the next
//        deterministic missing-field ask. Webhook sender no longer auto-promotes
//        plan-duration text into the canonical 4-row Meta list.
// 3.3.0: Placeholder-name guard — never greet user by Sample/Test/User/phone/

// 3.2.0: Hard server-side guards against repeated questions —
//        (a) canonicalized do_not_ask aliases ("membership duration" → "plan_interest"),
//        (b) deterministic plan_interest capture from list_reply titles,
//        (c) KNOWN PLAN_INTEREST + DO_NOT_ASK_LIST runtime rules,
//        (d) enforceOutboundInteractiveGuards strips duplicate / gate-violating
//            interactive blocks before they reach Meta.

// 3.1.0: Routes ALL model calls through `_shared/ai-dispatcher.ts → callAI`
//        with scope='whatsapp_ai' so providers in `ai_provider_configs` are
//        honored (no more hardcoded Lovable fetch). Legacy whatsapp_ai_config
//        system_prompt is APPENDED to the purpose prompt as overlay context.
// 3.0.0: Reads config (system_prompt, model, delays, tools_allowed, lead_capture)
//        from `ai_purposes` table (purpose='whatsapp_reply') with branch fallback
//        to global. Legacy `organization_settings.whatsapp_ai_config` is used
//        only as a final fallback. WhatsApp webhook + meta webhook both route
//        through `runUnifiedAgent`; the duplicate brain in whatsapp-webhook
//        is gone.
// 2.2.0: Non-fitness intent guard — job/CV, vendor, press, partnership,
//        complaint, wrong-number replies redirect to info@theinclinelife.com
//        and skip the lead-capture flow. Hardened "JSON-only" rule.
// 2.1.0: Variant-aware phone matching, member-first dedupe.
// Shared across meta-webhook (Instagram/Messenger) and whatsapp-webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllToolDefinitions } from "./ai-tools.ts";
import { executeSharedToolCall } from "./ai-tool-executor.ts";
import {
  CALLBACK_YES_RE,
  lastBotOfferedCallback,
  requestFounderHandoff,
} from "./handoff.ts";
import { phoneVariants } from "./phone.ts";
import { callAI } from "./ai-dispatcher.ts";
import {
  loadMemory,
  upsertMemory,
  renderMemoryBlock,
  resolveLeadContext,
  firstNameOf,
  type LeadContext,
} from "./ai-memory.ts";

import { buildSystemPrompt } from "./ai-prompt.ts";
import { loadDynamicMemory, type DynamicMemoryBundle } from "./ai-dynamic-memory.ts";

// Per-request dynamic memory snapshot. Loaded once at the top of runUnifiedAgent
// and read synchronously by classifyHinglishIntent / looksLikeRealName.
let _dynMemSnapshot: DynamicMemoryBundle | null = null;
export function _setDynMemSnapshot(b: DynamicMemoryBundle | null) { _dynMemSnapshot = b; }

// ─── Placeholder-name guard ────────────────────────────────────────────────────
// Reject WhatsApp/IG profile names that aren't real human names so the brain
// doesn't greet anyone as "Sample", "Test", a phone number, or emoji-only handle.
const FAKE_NAME_TOKENS = new Set([
  "sample", "test", "testing", "tester", "user", "demo", "customer",
  "unknown", "na", "none", "null", "n/a", "admin", "guest", "anon",
  "anonymous", "default", "client", "whatsapp", "instagram",
  // v4.3.0 — Short answers / greetings / control words. These were being
  // captured as first_name when the funnel asked "what's your name?".
  "yes", "no", "nope", "yep", "yeah", "ok", "okay", "sure", "maybe",
  "hi", "hello", "hey", "thanks", "thank", "please", "stop", "wait",
  "cancel", "sorry", "why", "what", "who", "when", "where", "how",
  "can", "cant", "dont", "human", "agent", "person", "manager", "staff",
  "haan", "nahi", "nahin", "theek", "accha", "bilkul", "kya", "kaun", "kaise",
  // v4.4.0 — Hinglish intent words (location/pricing/timeline) that must
  // NEVER be captured as a first_name.
  "kha", "khan", "kahan", "kaha", "kidhar", "kab", "kitna", "kitne",
  "paisa", "paise", "fees", "fee", "price", "cost", "rate", "rates",
  "location", "address", "open", "khulega", "khulta", "start", "launch",
  "reach", "direction", "directions", "kharcha", "kharch",
]);

// ─── Human-handoff / decline intent (deterministic, runs BEFORE the funnel) ──
// English + Hinglish + Hindi. Matched on inbound user text only. v4.3.0
export const HUMAN_HANDOFF_RE =
  /\b(live\s+(?:person|agent|human)|real\s+(?:person|human)|speak\s+(?:to|with)\s+(?:a\s+)?(?:person|human|someone|staff|manager|team)|talk\s+to\s+(?:a\s+)?(?:person|human|someone|staff|manager)|call\s+me|connect\s+me|insaan\s+se\s+baat|kisi\s+se\s+baat|manager\s+se\s+baat|human\s+please|real\s+human)\b/i;
export const DECLINE_RE =
  /\b(not\s+interested|don'?t\s+contact|leave\s+me\s+alone|unsubscribe|mat\s+karo|nahin?\s+chahiye)\b/i;

// ─── Hinglish intent classifier (v4.4.0) — answer-and-pivot ──────────────────
// Recognizes questions a user might ask mid-onboarding. Used in two places:
//   1. As a guard so questions never become first_name.
//   2. To prepend a canned answer to the next capture prompt (answer & pivot).
export const LOCATION_INTENT_RE =
  /\b(kha(?:a|n)?\s*pr?\s*h|kaha[ny]?|kahan|kidhar|location|address|where(?:\s+is)?|locate|reach|directions?)\b/i;
export const PRICING_INTENT_RE =
  /\b(kitna|kitne|paisa|paise|fees?|price|cost|charges?|rate|rates|kharcha|kharch)\b/i;
export const TIMELINE_INTENT_RE =
  /\b(kab\s*(?:khul|start|open)|khulega|open(?:ing)?\s+(?:when|kab)|start\s*date|launch|kab\s*se|opens?\s+when|when\s+(?:do\s+you\s+)?open)\b/i;

export type HinglishIntent = "location" | "pricing" | "timeline" | null;
export function classifyHinglishIntent(text: string): HinglishIntent {
  const t = String(text || "");
  // 1. Admin-trained dynamic rules (DB-backed) win first.
  const dyn = _dynMemSnapshot?.classify(t);
  if (dyn) {
    if (dyn.intent_category === "location" || dyn.intent_category === "pricing" || dyn.intent_category === "timeline") {
      return dyn.intent_category;
    }
  }
  // 2. Hardcoded fallbacks (defense-in-depth).
  if (LOCATION_INTENT_RE.test(t)) return "location";
  if (PRICING_INTENT_RE.test(t)) return "pricing";
  if (TIMELINE_INTENT_RE.test(t)) return "timeline";
  return null;
}

// v4.7.0 — multi-intent. "When it is opening and address" needs BOTH the
// timeline + location canonical answers, not just the first one. Returns an
// ordered, de-duplicated array (priority: location → timeline → pricing).
export function classifyHinglishIntents(text: string): Array<Exclude<HinglishIntent, null>> {
  const t = String(text || "");
  const out = new Set<Exclude<HinglishIntent, null>>();
  const dyn = _dynMemSnapshot?.classify(t);
  if (dyn && (dyn.intent_category === "location" || dyn.intent_category === "pricing" || dyn.intent_category === "timeline")) {
    out.add(dyn.intent_category);
  }
  if (LOCATION_INTENT_RE.test(t)) out.add("location");
  if (TIMELINE_INTENT_RE.test(t)) out.add("timeline");
  if (PRICING_INTENT_RE.test(t)) out.add("pricing");
  const order: Array<Exclude<HinglishIntent, null>> = ["location", "timeline", "pricing"];
  return order.filter((k) => out.has(k)).slice(0, 2);
}

const INTENT_ANSWERS: Record<Exclude<HinglishIntent, null>, string> = {
  location: "We're at Sector 14, Udaipur, Rajasthan ✨",
  pricing: "Founding Member (Annual) is our only active enrollment right now — full pricing is shared by our team once you're on the Founder's list ✨",
  timeline: "Our opening date hasn't been announced publicly yet — Founding Members will be the first to know ✨",
};

// v4.6.0 — sanitize curated correction_instruction. Admin rows often start
// with an internal meta-label like "Location intent — Sector 14, Udaipur."
// We must NEVER show that label to the user.
const INTENT_META_PREFIX_RE =
  /^\s*(?:location|pricing|timeline|opening|launch|intent)\s+intent\s*[—\-:]\s*/i;
const INTENT_RESIDUAL_META_RE = /\bintent\s*[—\-:]\s*/i;
// v4.7.0 — strip admin instruction-style prefixes like "Share full address:",
// "Tell the user ...:", "Reply with ...:". These are operator notes, never
// user-facing copy. If the cleaned line still starts with such a verb, we
// fall back to the canonical answer.
const INTENT_INSTRUCTION_PREFIX_RE =
  /^\s*(?:share|tell|reply|say|mention|use|send|give|provide|inform|respond|answer|state|note|please)\b[^:\n]{0,80}:\s*/i;
const INTENT_INSTRUCTION_RESIDUAL_RE =
  /^\s*(?:share|tell|reply|say|mention|use|send|give|provide|inform|respond|answer|state|note)\b[^:\n]{0,80}:/i;

function intentPivotPrefix(text: string): string {
  const intents = classifyHinglishIntents(text);
  if (intents.length === 0) return "";

  const dyn = _dynMemSnapshot?.classify(text);
  // When admin has curated a row for the primary intent, prefer it (after sanitizing).
  if (dyn && intents.includes(dyn.intent_category as any)) {
    const raw = String(dyn.correction_instruction || "").trim();
    let cleaned = raw
      .replace(INTENT_META_PREFIX_RE, "")
      .replace(INTENT_INSTRUCTION_PREFIX_RE, "")
      .trim();
    // first sentence only
    cleaned = cleaned.split(/[.!?]\s/)[0].trim();
    if (INTENT_RESIDUAL_META_RE.test(cleaned) || INTENT_INSTRUCTION_RESIDUAL_RE.test(cleaned)) {
      console.log("[AI:guards] stripped admin-prefix (residual) — falling back to canonical");
      cleaned = "";
    }
    if (cleaned) {
      // append any OTHER intent's canonical line so multi-intent questions are fully answered
      const extras = intents
        .filter((i) => i !== dyn.intent_category)
        .map((i) => INTENT_ANSWERS[i]);
      return [cleaned, ...extras].join(" ") + " ";
    }
  }

  // No usable admin row — concatenate canonical answers in priority order.
  return intents.map((i) => INTENT_ANSWERS[i]).join(" ") + " ";
}

// v4.6.0 — shared regexes for name-ask de-duplication
const NAME_ASK_DETECT_RE =
  /(what'?s|may i (?:have|know)|can i (?:have|get|know)|could i (?:have|get|know)|tell me|share|your)\s+(?:your\s+)?(?:good\s+)?name\??/i;
const ACK_RE =
  /^(?:thanks?(?:\s+you)?|thank\s+you(?:\s+for[^.]*)?|thx|ty|ok(?:ay)?|k|kk|cool|nice|noted|got\s+it|alright|nevertheless|no\s*worries|no\s*problem|np|sure|hmm+|haan?|ji|theek\s*hai|thik\s+hai|👍|🙏|✨)\.?!?\s*$/i;

function countPriorNameAsks(history: Array<{ role: string; content: string }>): number {
  if (!Array.isArray(history) || history.length === 0) return 0;
  return history
    .slice(-10)
    .filter((m) => m && m.role !== "user" && typeof m.content === "string" && NAME_ASK_DETECT_RE.test(m.content))
    .length;
}



export function looksLikeRealName(name: unknown, phone?: string | null): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  // Pure digits / phone-like
  if (/^\+?\d[\d\s().-]{4,}$/.test(trimmed)) return false;
  // Equals the sender phone
  if (phone && trimmed.replace(/\D/g, "") === phone.replace(/\D/g, "") && trimmed.replace(/\D/g, "").length > 4) return false;
  // Blocklist (case-insensitive, ignoring punctuation). Union of hardcoded
  // FAKE_NAME_TOKENS and admin-curated name_block phrases from ai_dynamic_memory.
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9/]/g, "");
  if (FAKE_NAME_TOKENS.has(normalized)) return false;
  if (_dynMemSnapshot?.nameBlockSet.has(trimmed.toLowerCase())) return false;
  // Also reject if the entire name matches any dynamic intent rule (e.g. "kha pr h").
  if (_dynMemSnapshot?.classify(trimmed)) return false;
  // Must contain letters and be >50% letters
  const letters = (trimmed.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;
  if (letters / trimmed.length < 0.5) return false;
  return true;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type Platform = "whatsapp" | "instagram" | "messenger";

export interface AgentContext {
  senderId: string;           // phone number or IG/FB user ID
  branchId: string;
  platform: Platform;
  messageId: string;          // DB ID of the inbound message
  messageContent: string;
  contactName: string | null;
  messageType?: string;       // e.g. "story_reply", "text", "image"
}

export interface AgentResult {
  replyText: string | null;
  leadCaptured: boolean;
  leadId: string | null;
  handoffTriggered: boolean;
  skipped: boolean;
  skipReason?: string;
}

interface OrgAiConfig {
  auto_reply_enabled?: boolean;
  reply_delay_seconds?: number;
  system_prompt?: string;
  model?: string;
  lead_capture?: {
    enabled?: boolean;
    target_fields?: string[];
    handoff_message?: string;
  };
  instagram_story_reply_enabled?: boolean; // default false
  /** Per-channel AI DM reply toggles. Missing entry defaults to true (back-compat). */
  channels?: Partial<Record<'whatsapp' | 'instagram' | 'messenger', { enabled?: boolean }>>;
}


// ─── Main entry point ──────────────────────────────────────────────────────────

export async function runUnifiedAgent(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  // Note: provider routing is handled by callAI (ai-dispatcher) using the
  // `whatsapp_ai` scope from `ai_provider_configs`. We no longer hard-require
  // LOVABLE_API_KEY here — the dispatcher will resolve the active provider key
  // (Google/OpenRouter/Lovable/etc.) and fall back to Lovable if needed.

  // 1. Load org name + purpose row (SSOT — ai_purposes only)
  const orgConfig = await loadOrgConfig(supabase);
  const purposeRow = await loadAiPurpose(supabase, "whatsapp_reply", ctx.branchId);
  const aiConfig: OrgAiConfig = purposeToConfig(purposeRow);
  if (!aiConfig.auto_reply_enabled) {
    return skip("auto_reply_disabled");
  }
  // Per-channel kill-switch (WhatsApp / Instagram DM / Messenger DM). Missing
  // entry defaults to enabled for back-compat with pre-channel-toggle configs.
  const channelOn = aiConfig.channels?.[ctx.platform as 'whatsapp' | 'instagram' | 'messenger']?.enabled ?? true;
  if (!channelOn) {
    return skip(`channel_${ctx.platform}_disabled`);
  }

  // Load admin-trained dynamic memory rules (cached 60s). MUST happen before
  // classifyHinglishIntent / looksLikeRealName are called downstream.
  try {
    const dynMem = await loadDynamicMemory(supabase);
    _setDynMemSnapshot(dynMem);
    const matched = dynMem.classify(ctx.messageContent || "");
    console.log("[AI Tool Call Attempt] dynamic_memory_match", JSON.stringify({
      sender: ctx.senderId,
      platform: ctx.platform,
      raw: (ctx.messageContent || "").slice(0, 120),
      matched_rule_id: matched?.id ?? null,
      intent_category: matched?.intent_category ?? null,
      rules_loaded: dynMem.rows.length,
    }));
  } catch (e) {
    console.error("[ai-agent-brain] dynamic memory load failed:", (e as Error).message);
    _setDynMemSnapshot(null);
  }


  // 2. Check pause state — bot_active OR bot_paused_until (timed shut-up switch).
  //    Single source of truth: is_bot_paused() SQL helper.
  const { data: chatSettings } = await supabase
    .from("whatsapp_chat_settings")
    .select("bot_active, bot_paused_until, captured_lead_id, conversation_summary")
    .eq("branch_id", ctx.branchId)
    .eq("phone_number", ctx.senderId)
    .maybeSingle();
  const pausedUntilMs = chatSettings?.bot_paused_until ? new Date(chatSettings.bot_paused_until).getTime() : 0;
  const isTimedPause = pausedUntilMs > Date.now();
  if (chatSettings?.bot_active === false || isTimedPause) {
    return skip(isTimedPause ? "bot_paused_timed" : "bot_paused");
  }

  // 3. Story reply guard
  if (ctx.messageType === "story_reply" || ctx.messageType === "story_mention") {
    const storyEnabled = aiConfig.instagram_story_reply_enabled === true;
    // Only skip if no text content or feature disabled
    const hasTextContent = ctx.messageContent && !ctx.messageContent.startsWith("[Story reply") && !ctx.messageContent.startsWith("[Attachment]") && ctx.messageContent.trim().length > 5;
    if (!storyEnabled && !hasTextContent) {
      console.log(`[AI:${ctx.platform}] skipping story reply (no text / feature disabled)`);
      return skip("story_reply_no_text");
    }
  }

  // 3b. Deterministic non-fitness intent guard (defense-in-depth, applies to
  //     all platforms). Short-circuits BEFORE the LLM. All knobs live in
  //     ai_purposes.guards so copy/regex/window/pause can be tuned without redeploy.
  const guards = (purposeRow?.guards ?? {}) as Record<string, unknown>;
  const nonFitnessGuardOn = (guards.non_fitness_redirect ?? true) === true;
  // Regex stays inline (defense-in-depth — not user-editable copy). All
  // user-visible wording (REDIRECT) is sourced from ai_purposes.guards, which
  // mirrors the ai_knowledge `non_membership_intent` rule.
  const DEFAULT_NON_FITNESS_PATTERN =
    "\\b(job|jobs|vacancy|vacancies|hir(?:e|ing)|career|careers|cv|resume|biodata|bio[-\\s]?data|interview\\s+for|i(?:'?m)?\\s+(?:looking\\s+(?:for|out)\\s+)?(?:a\\s+)?(?:job|work|position|role|vacancy)|work(?:ing)?\\s+(?:at|with|in)\\s+(?:your|incline)|sales\\s+(?:job|department|position)|trainer\\s+(?:job|position|vacancy)|front\\s*desk\\s+(?:job|position)|vendor|supplier|wholesale|b2b|press|media|influencer|sponsor(?:ship)?|collaborat(?:e|ion)|partnership|franchise|tie[-\\s]?up|physio(?:therapist|therapy)?|sports\\s+physio|doctor|nutritionist|dietician|yoga\\s+teacher|instructor\\s+job)\\b";
  const FALLBACK_NON_FITNESS_MESSAGE =
    "Thanks for reaching out! This channel is for membership and fitness queries — for anything else, please email info@theinclinelife.com or call our front desk. 🙏";
  let NON_FITNESS_RE: RegExp;
  try {
    NON_FITNESS_RE = new RegExp((guards.non_fitness_pattern as string) || DEFAULT_NON_FITNESS_PATTERN, "i");
  } catch {
    NON_FITNESS_RE = new RegExp(DEFAULT_NON_FITNESS_PATTERN, "i");
  }
  if (nonFitnessGuardOn && NON_FITNESS_RE.test(ctx.messageContent || "")) {
    const REDIRECT = (guards.non_fitness_message as string) || FALLBACK_NON_FITNESS_MESSAGE;
    const pauseNurture = (guards.non_fitness_pause_nurture ?? true) === true;
    const dedupeWindowHours = Number(guards.non_fitness_dedupe_window_hours ?? 24) || 24;

    // 3b.i Dedupe: if the same redirect was sent within the window, skip
    //      silently so the contact doesn't get spammed on every reply.
    try {
      const since = new Date(Date.now() - dedupeWindowHours * 3600 * 1000).toISOString();
      const { data: lastOut } = await supabase
        .from("whatsapp_messages")
        .select("content, created_at")
        .eq("branch_id", ctx.branchId)
        .eq("phone_number", ctx.senderId)
        .eq("direction", "outbound")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastOut && String(lastOut.content || "").trim() === REDIRECT.trim()) {
        console.log(`[AI:${ctx.platform}] non-fitness redirect already sent within ${dedupeWindowHours}h, skipping`);
        return skip("non_fitness_already_redirected");
      }
    } catch (e) {
      console.warn(`[AI:${ctx.platform}] non-fitness dedupe check failed (continuing):`, (e as Error).message);
    }

    // 3b.ii Pause nurture: DNC across chat_settings/leads/members + bot_active=false.
    if (pauseNurture) {
      try {
        await supabase.rpc("mark_do_not_contact", {
          p_phone: ctx.senderId,
          p_branch_id: ctx.branchId,
          p_reason: "non_fitness_inquiry",
          p_source: "ai_guard",
        });
      } catch (e) {
        console.warn(`[AI:${ctx.platform}] mark_do_not_contact failed (continuing):`, (e as Error).message);
      }
      try {
        await supabase
          .from("whatsapp_chat_settings")
          .upsert(
            {
              branch_id: ctx.branchId,
              phone_number: ctx.senderId,
              platform: ctx.platform as any,
              bot_active: false,
              do_not_contact: true,
              paused_at: new Date().toISOString(),
              handoff_reason: "non_fitness_inquiry",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "branch_id,phone_number" },
          );
      } catch (e) {
        console.warn(`[AI:${ctx.platform}] pause bot_active failed (continuing):`, (e as Error).message);
      }
      try {
        await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
          current_intent: "non_fitness",
          do_not_ask_add: ["fitness_goal", "plan_interest"],
        });
      } catch (e) {
        console.warn(`[AI:${ctx.platform}] non-fitness memory write failed (continuing):`, (e as Error).message);
      }
    }

    return { replyText: REDIRECT, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
  }

  // 3c. HUMAN-HANDOFF / DECLINE intent gate. Runs BEFORE the deterministic
  //     name/email/goal/plan funnel so "Can I speak to a live person?" or "No"
  //     doesn't get walked through the onboarding script. v4.3.0
  const inboundText = String(ctx.messageContent || "").trim();
  const wantsHuman = HUMAN_HANDOFF_RE.test(inboundText);
  const declines = DECLINE_RE.test(inboundText);
  if (wantsHuman || declines) {
    const reason = wantsHuman ? "user_requested_human" : "user_declined_contact";
    const replyText = wantsHuman
      ? "Got it — a teammate from Incline will reach out shortly. 🙏"
      : "Understood — we won't message further. Reply START anytime to resume.";
    try {
      const pauseUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      await supabase
        .from("whatsapp_chat_settings")
        .upsert(
          {
            branch_id: ctx.branchId,
            phone_number: ctx.senderId,
            platform: ctx.platform as any,
            bot_active: false,
            bot_paused_until: pauseUntil,
            paused_at: new Date().toISOString(),
            handoff_reason: reason,
            do_not_contact: declines ? true : undefined,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "branch_id,phone_number" },
        );
    } catch (e) {
      console.warn(`[AI:${ctx.platform}] handoff pause write failed:`, (e as Error).message);
    }
    try {
      await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
        current_intent: reason,
        facts: { consent: { wants_human: wantsHuman, push_contact_ask: declines ? "declined" : "unknown" } },
        do_not_ask_add: ["name", "email", "goal", "plan_interest"],
      });
    } catch (e) {
      console.warn(`[AI:${ctx.platform}] handoff memory write failed:`, (e as Error).message);
    }
    if (declines) {
      try {
        await supabase.rpc("mark_do_not_contact", {
          p_phone: ctx.senderId,
          p_branch_id: ctx.branchId,
          p_reason: "user_declined",
          p_source: "ai_guard",
        });
      } catch (e) {
        console.warn(`[AI:${ctx.platform}] mark_do_not_contact failed:`, (e as Error).message);
      }
    }
    if (wantsHuman) {
      // Fire-and-forget staff alert.
      try {
        const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        fetch(`${baseUrl}/functions/v1/notify-staff-handoff`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            member_phone: ctx.senderId,
            branch_id: ctx.branchId,
            reason: `User asked to speak to a live person (${ctx.platform})`,
          }),
        }).catch(() => {});
      } catch { /* noop */ }
    }
    return { replyText, leadCaptured: false, leadId: null, handoffTriggered: true, skipped: false };
  }


  // 4. Optional delay
  const delaySeconds = aiConfig.reply_delay_seconds || 0;
  if (delaySeconds > 0 && delaySeconds <= 30) {
    await new Promise((r) => setTimeout(r, delaySeconds * 1000));
  }

  // 5. Resolve member/lead context + persistent ai_memory
  const memberCtx = await resolveMemberContext(supabase, ctx.senderId, ctx.branchId, ctx.platform);
  const alreadyCaptured = chatSettings?.captured_lead_id ? await loadCapturedSnapshot(supabase, chatSettings.captured_lead_id) : "";
  const summaryBlock = chatSettings?.conversation_summary ? `\n\n[PRIOR CONVERSATION SUMMARY]\n${chatSettings.conversation_summary}\n` : "";

  // 5b. Hydrate persistent contact memory (ai_memory)
  let memory = await loadMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId);

  // 5b.1 LEAD HYDRATION — if this phone already has a leads row (e.g. captured
  // via website form, Meta Ads, or prior AI conversation), seed ai_memory from
  // it BEFORE the auto-learn pass so KNOWN SO FAR / ADVANCE RULE in the prompt
  // skip fields already on file. Stops the bot from re-asking name/email/goal/
  // plan_interest when the CRM already has them. v1.0.0
  let leadCtx: LeadContext | null = null;
  if (!memberCtx.isMember) {
    try {
      const variants = phoneVariants(ctx.senderId);
      leadCtx = await resolveLeadContext(supabase, variants, ctx.branchId);
      if (leadCtx) {
        const profilePatch: Record<string, any> = {};
        const factsPatch: Record<string, any> = {
          lead_source: leadCtx.source,
          lead_captured_at: leadCtx.capturedAt,
          lead_status: leadCtx.status,
        };
        const dna: string[] = [];
        if (leadCtx.profile.full_name) {
          profilePatch.full_name = leadCtx.profile.full_name;
          const fn = firstNameOf(leadCtx.profile.full_name);
          if (fn) profilePatch.first_name = fn;
          dna.push("name", "full_name", "first_name");
        }
        if (leadCtx.profile.email) {
          profilePatch.email = leadCtx.profile.email;
          dna.push("email");
        }
        if (leadCtx.facts.fitness_goal) {
          factsPatch.fitness_goal = leadCtx.facts.fitness_goal;
          factsPatch.goal = leadCtx.facts.fitness_goal;
          dna.push("goal", "fitness_goal");
        }
        if (leadCtx.facts.plan_interest) {
          factsPatch.plan_interest = leadCtx.facts.plan_interest;
          dna.push("plan_interest", "membership duration");
        }
        if (leadCtx.facts.preferred_time) {
          factsPatch.preferred_time = leadCtx.facts.preferred_time;
          dna.push("preferred_time");
        }
        await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
          profile: profilePatch,
          facts: factsPatch,
          do_not_ask_add: dna,
        });
        memory = await loadMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId);

        // Link the existing lead to chat_settings so downstream handoff,
        // do-not-contact, and capture dedupe work on message one.
        if (!chatSettings?.captured_lead_id) {
          try {
            await supabase
              .from("whatsapp_chat_settings")
              .upsert(
                {
                  branch_id: ctx.branchId,
                  phone_number: ctx.senderId,
                  captured_lead_id: leadCtx.leadId,
                },
                { onConflict: "branch_id,phone_number" },
              );
          } catch (e) {
            console.warn(`[AI:${ctx.platform}] link chat_settings.captured_lead_id failed:`, (e as Error).message);
          }
        }
        console.log(`[AI:${ctx.platform}] hydrated brain from existing lead ${leadCtx.leadId} (status=${leadCtx.status}, source=${leadCtx.source})`);
      }
    } catch (e) {
      console.warn(`[AI:${ctx.platform}] lead hydration failed (continuing):`, (e as Error).message);
    }
  }


  // 5c. AUTO-LEARN: extract structured facts from the user's last message and
  // merge into ai_memory BEFORE building the prompt. This is what stops the
  // bot from re-asking phone / fitness goal / name on every turn and makes it
  // respect "first listen my query" style pushback.
  try {
    // We need recent messages for the extractor — fetch the last 6 inline.
    const { data: recentForExtract } = await supabase
      .from("whatsapp_messages")
      .select("content, direction")
      .eq("phone_number", ctx.senderId)
      .eq("branch_id", ctx.branchId)
      .order("created_at", { ascending: false })
      .limit(6);
    const extractHistory = (recentForExtract || []).reverse().map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: String(m.content || ""),
    }));
    const delta = await extractContextDelta(supabase, ctx, extractHistory, memory);
    if (delta && (Object.keys(delta.profile || {}).length || Object.keys(delta.facts || {}).length || delta.do_not_ask_add?.length || delta.current_intent || delta.summary)) {
      await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
        profile: delta.profile,
        facts: delta.facts,
        current_intent: delta.current_intent ?? undefined,
        do_not_ask_add: delta.do_not_ask_add,
        summary: delta.summary ?? undefined,
      });
      memory = await loadMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId);

      // v4.2.0 — Write-through newly captured email/name into the existing
      // lead row so future turns hydrate from CRM and the onboarding short-
      // circuit advances. Without this, ai_memory has the email but the
      // leads.email column stays NULL and the next session re-asks it.
      const newEmail = (delta.profile?.email || "").toString().trim();
      const newName = (delta.profile?.full_name || delta.profile?.first_name || "").toString().trim();
      if (leadCtx?.leadId && (newEmail || newName)) {
        try {
          const patch: Record<string, any> = { updated_at: new Date().toISOString() };
          if (newEmail && !leadCtx.profile.email) patch.email = newEmail;
          if (newName && !leadCtx.profile.full_name) patch.full_name = newName;
          if (Object.keys(patch).length > 1) {
            await supabase.from("leads").update(patch).eq("id", leadCtx.leadId);
            console.log(`[AI:${ctx.platform}] lead ${leadCtx.leadId} backfilled from chat:`, Object.keys(patch).filter(k => k !== "updated_at"));
          }
        } catch (e) {
          console.warn(`[AI:${ctx.platform}] lead backfill failed (non-fatal):`, (e as Error).message);
        }
      }
    }
  } catch (e) {
    console.warn(`[AI:${ctx.platform}] auto-learn pass failed (continuing):`, (e as Error).message);
  }
  const memoryBlock = renderMemoryBlock(memory);
  const runtimeRules = renderRuntimeRules(memory, ctx.platform);

  // 6. Build conversation history (cross-platform, no channel tags)
  const { data: recentMessages } = await supabase
    .from("whatsapp_messages")
    .select("content, direction, platform")
    .eq("phone_number", ctx.senderId)
    .eq("branch_id", ctx.branchId)
    .order("created_at", { ascending: false })
    .limit(20);

  const history = (recentMessages || []).reverse().map((m: any) => ({
    role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
    content: String(m.content || ""),
  }));

  // 7. Hydrate deterministic gym facts (plans, facilities, timings).
  //    Persona, behavior rules, FAQs and offers all come from the SSOT brain
  //    (ai_purposes.system_prompt + ai_knowledge) via buildSystemPrompt().
  const gymFacts = await hydrateGymFacts(supabase, ctx.branchId);

  // 8. Assemble system prompt via the single-source-of-truth helper.
  const gymName = orgConfig?.name || "Incline";
  const platformLabel =
    ctx.platform === "instagram"
      ? "Instagram DM"
      : ctx.platform === "messenger"
        ? "Facebook Messenger"
        : "WhatsApp";

  const dynamicSegments: string[] = [];
  if (memberCtx.contextPrompt) dynamicSegments.push(memberCtx.contextPrompt);
  if (summaryBlock) dynamicSegments.push(summaryBlock.trim());
  if (alreadyCaptured) dynamicSegments.push(alreadyCaptured.trim());
  if (memoryBlock) dynamicSegments.push(memoryBlock.trim());
  if (runtimeRules) dynamicSegments.push(runtimeRules.trim());
  if (gymFacts) dynamicSegments.push(gymFacts.trim());
  dynamicSegments.push(
    `You are responding on ${platformLabel}. Conversation history may include messages from other channels — treat them as one continuous conversation.`,
  );
  if (memberCtx.isMember && memberCtx.memberName) {
    dynamicSegments.push(
      `KNOWN MEMBER NAME: ${memberCtx.memberName}. Greet them by name on your first reply.`,
    );
  }

  // Build identity for SSOT prompt routing (member vs lead vs unknown).
  const identity: Parameters<typeof buildSystemPrompt>[0]["identity"] =
    memberCtx.isMember
      ? {
          role: "member",
          senderId: ctx.senderId,
          memberId: memberCtx.memberId ?? null,
          name: memberCtx.memberName ?? null,
          phone: memberCtx.memberPhone ?? null,
          email: memberCtx.memberEmail ?? null,
          planLabel: memberCtx.planName ?? null,
          planEndsAt: memberCtx.planEndsAt ?? null,
          branchName: orgConfig?.name ?? null,
        }
      : memberCtx.leadId
        ? {
            role: "lead",
            senderId: ctx.senderId,
            leadId: memberCtx.leadId,
            name: memberCtx.leadName ?? null,
            phone: memberCtx.leadPhone ?? null,
            email: memberCtx.leadEmail ?? null,
            funnelStage: memberCtx.leadStage ?? null,
            branchName: orgConfig?.name ?? null,
          }
        : {
            role: "unknown",
            senderId: ctx.senderId,
            branchName: orgConfig?.name ?? null,
          };

  const built = await buildSystemPrompt({
    supabase,
    purpose: "whatsapp_reply",
    branchId: ctx.branchId,
    userMessage: ctx.messageContent,
    identity,
    dynamicContext: dynamicSegments.join("\n\n"),
    defaultPersona: `You are a helpful gym assistant for "${gymName}". Answer questions about membership, timings, and facilities. Keep responses short and friendly.`,
  });
  let systemPrompt = built.prompt;


  // Member tool instructions — gated by ai_purposes.tools_allowed (SSOT, UI-managed).
  // Empty array means permissive (all tools allowed).
  let tools: any[] | undefined;
  if (memberCtx.isMember && memberCtx.memberId) {
    tools = getAllToolDefinitions();
    const allowList = (aiConfig as any)._tools_allowed as string[] | undefined;
    if (allowList && allowList.length > 0) {
      tools = tools.filter((t: any) => allowList.includes(t.function.name));
    }
    if (tools.length === 0) tools = undefined;

    if (tools) {
      systemPrompt += `\n\nIMPORTANT TOOL USAGE INSTRUCTIONS:
You have access to real tools that can query and modify the member's account. USE THEM when the member asks about membership status, benefits, bookings, PT sessions, etc.

SELF-SERVICE BOOKING FLOW:
1. When a member wants to book a facility (sauna, ice bath, etc.), ask for the facility, date, and preferred time range.
2. Use the available tools to check slot availability for that date.
3. Present available time slots in a clear, numbered list (e.g., 1️⃣ 10:00 AM, 2️⃣ 11:30 AM).
4. Once they pick a number or confirm a time, call book_facility_slot with the exact details.
5. Confirm the booking with a "Success" message including *facility*, *date*, and *time*.
6. If no slots are available, suggested the next available date or an alternative facility.

GENERAL RULES:
- Always confirm booking details with the member BEFORE calling book_facility_slot.
- If the member asks for a manager, complains, or you encounter errors twice, IMMEDIATELY use transfer_to_human.
- Be proactive: if a member says "book sauna tomorrow", infer tomorrow's date and check slots immediately.`;
    }
  }

  // Lead capture for non-members
  const leadCaptureConfig = aiConfig.lead_capture;
  // Compute "already fully captured" — name+email+goal+plan_interest all on file
  // (from leads row hydrated in 5b.1 OR from prior ai_memory). Skip onboarding
  // and switch to post-capture nurture persona. v1.0.0 (2026-06-06)
  const hasName = !!(memory?.profile?.full_name || memory?.profile?.first_name || memory?.profile?.name);
  const rawEmail = String(memory?.profile?.email || "").trim();
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
  const hasGoal = !!(memory?.facts?.fitness_goal || memory?.facts?.goal);
  // Only treat plan_interest as captured when the user explicitly confirmed it.
  // v1.2.0 — prevents LLM-inferred "annual" from skipping the duration prompt.
  const hasPlanInterest = !!memory?.facts?.plan_interest && memory?.facts?.plan_interest_confirmed === true;
  const hasUnconfirmedPlanInterest = !!memory?.facts?.plan_interest && !hasPlanInterest;
  const fullyCaptured = hasName && hasEmail && hasGoal && hasPlanInterest;
  // Treat a non-'new' lead status (contacted/qualified/won/lost) as captured too.
  const leadAlreadyEngaged = !!(leadCtx && leadCtx.status && leadCtx.status !== "new");
  const inPostCaptureNurture = !memberCtx.isMember && (fullyCaptured || leadAlreadyEngaged);

  const shouldCaptureLead = !memberCtx.isMember && !inPostCaptureNurture && leadCaptureConfig?.enabled && (leadCaptureConfig.target_fields?.length ?? 0) > 0;

  // v4.0.0 — Deterministic onboarding short-circuit. The LLM occasionally
  // stalls or emits malformed JSON when a lead replies in free text to an
  // interactive prompt (e.g. "Weight loss and body maintained" instead of
  // tapping the goal list). Once auto-learn has captured the missing fact,
  // we force the next deterministic step so the funnel never stops.
  if (shouldCaptureLead) {
    const _fn =
      memory?.profile?.first_name ||
      firstNameOf(memory?.profile?.full_name) ||
      "";

    // v4.1.0 — extend per-field short-circuit (was only annual-step).
    // Each captured field forces the NEXT deterministic step without an LLM
    // call so a stalled/timed-out Gemini turn cannot drop the funnel.
    // v4.4.0 — Answer-and-pivot: if the user asked a Hinglish question
    // (location/pricing/timeline), prepend the canned answer before re-asking.
    const _pivot = intentPivotPrefix(ctx.messageContent);

    // Step 1: nothing captured → ask name, but soften per turn count (v4.6.0).
    if (!hasName) {
      const askTurns = countPriorNameAsks(history);
      const userLast = String(ctx.messageContent || "").trim();
      const userIsAck = ACK_RE.test(userLast);

      // Pure acknowledgements after we already asked once → don't re-ask.
      if (askTurns >= 1 && userIsAck) {
        console.log(`[AI:guards] skipping name-ask on ack (turn=${askTurns})`);
        return {
          replyText: "Anytime ✨ I'm here whenever you'd like to continue.",
          leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false,
        };
      }

      let body: string;
      if (askTurns === 0) {
        body = "Hi! I'm Ananya, the member concierge at Incline. May I have your name to get started? ✨";
      } else if (askTurns === 1) {
        body = "…and may I have your name so I can help better? ✨";
      } else if (askTurns === 2) {
        body = "No problem — whenever you'd like to share your name, I'll line up your Founding Member invite. Meanwhile, anything specific I can help with? ✨";
      } else {
        // Turn 4+: stop pushing for the name. Let the pivot answer carry the
        // reply; if there's no pivot, send a neutral assist line.
        console.log(`[AI:guards] giving_up_name_ask (turn=${askTurns}) — pivot=${_pivot ? "yes" : "no"}`);
        body = _pivot ? "" : "Happy to help with anything specific — equipment, recovery suite, location, or our Founding Member list ✨";
        return {
          replyText: `${_pivot}${body}`.trim(),
          leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false,
        };
      }

      if (askTurns > 0) console.log(`[AI:guards] name-ask softened — turn=${askTurns}`);
      return {
        replyText: `${_pivot}${body}`,
        leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false,
      };
    }


    // Step 2: name captured, no email → ask email (plain text)
    if (hasName && !hasEmail) {
      return {
        replyText: _fn
          ? `${_pivot}Thanks, ${_fn} — what's the best email for your Founding Member invite? ✨`
          : `${_pivot}Could you share your email for your Founding Member invite? ✨`,
        leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false,
      };
    }

    // Step 3: name+email captured, no goal → ask goal (interactive list)
    if (hasName && hasEmail && !hasGoal) {
      const baseBody = _fn ? `Got it, ${_fn} — what's your main fitness goal?` : "What's your main fitness goal?";
      const reply = JSON.stringify({
        type: "interactive_list",
        body: `${_pivot}${baseBody}`,
        button: "Choose goal",
        sections: [{
          title: "Fitness Goal",
          rows: [
            { id: "weight_loss", title: "Weight Loss" },
            { id: "muscle_gain", title: "Muscle Gain" },
            { id: "endurance", title: "Endurance" },
            { id: "general", title: "Flexibility / General" },
          ],
        }],
      });
      return { replyText: reply, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
    }

    if (hasName && hasEmail && hasGoal && !hasPlanInterest) {
      // v1.2.0 — if we have an UNconfirmed plan_interest (e.g. LLM previously
      // inferred "annual" from "Founding"), soften the prompt to a confirm ask
      // so the user explicitly taps one of the four durations.
      const bodyText = hasUnconfirmedPlanInterest
        ? (_fn
            ? `Just to confirm, ${_fn} — which duration works best for you?`
            : "Just to confirm — which duration works best for you?")
        : (_fn
            ? `Perfect, ${_fn} — which membership duration are you thinking about?`
            : "Which membership duration are you thinking about?");
      const reply = JSON.stringify({
        type: "interactive_list",
        body: `${_pivot}${bodyText}`,
        button: "Choose duration",
        sections: [{
          title: "Membership Duration",
          rows: [
            { id: "monthly", title: "Monthly" },
            { id: "quarterly", title: "Quarterly" },
            { id: "half_yearly", title: "Half-Yearly" },
            { id: "annual", title: "Annual — Founding Member" },
          ],
        }],
      });
      return { replyText: reply, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
    }
    if (hasName && hasEmail && hasGoal && hasPlanInterest && !chatSettings?.captured_lead_id) {
      const plan = String(memory?.facts?.plan_interest || "").toLowerCase();
      const isAnnual = /annual|yearly|12\s*month/.test(plan);
      const reply = isAnnual
        ? (_fn
            ? `${_pivot}Perfect ${_fn} — Founding Member (Annual) is our only active enrollment right now with launch-day perks. Want our team to lock in your Founding spot? ✨`
            : `${_pivot}Founding Member (Annual) is our only active enrollment right now with launch-day perks. Want our team to lock in your Founding spot? ✨`)
        : (_fn
            ? `${_pivot}Noted ${_fn} — I've logged your interest. Our team will share full plan options closer to launch. The only active enrollment right now is Founding Member (Annual) with launch perks — happy to share more if you're open. ✨`
            : `${_pivot}Noted — I've logged your interest. Our team will share full plan options closer to launch. ✨`);
      return { replyText: reply, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
    }
  }


  if (inPostCaptureNurture) {
    const fn = memory?.profile?.first_name || firstNameOf(memory?.profile?.full_name) || "there";
    const planInt = memory?.facts?.plan_interest || leadCtx?.facts?.plan_interest || "—";
    const goal = memory?.facts?.fitness_goal || memory?.facts?.goal || leadCtx?.facts?.fitness_goal || "—";
    const src = leadCtx?.source || memory?.facts?.lead_source || "prior contact";
    systemPrompt += `\n\nPOST-CAPTURE NURTURE MODE (lead already in CRM — DO NOT re-onboard):
This contact is an EXISTING captured lead. Source: ${src}. Known plan_interest: ${planInt}. Known goal: ${goal}.

HARD RULES:
- DO NOT ask for name, email, fitness goal, or plan_interest again. They are on file.
- DO NOT emit any {"status":"lead_captured"...} JSON — the lead already exists.
- DO NOT run the Turn 1 → Turn 5 onboarding sequence.
- Greet warmly by first name (${fn}) and answer their question directly in ONE short sentence.
- If they ask about Founding Member / membership / pricing: "Our Founding Member (Annual) enrollment is the only active offer right now — happy to have our team call you to lock in your Founding spot. Sound good?"
- If their stored plan_interest is monthly/quarterly/half_yearly: do NOT hard-push annual. Acknowledge, offer human follow-up.
- VELVET ROPE still applies: NEVER mention ₹, Rs., prices, fees, PT package names, session counts, trainer names, or class schedules.
- If they want to speak to a person or you hit two errors: call transfer_to_human.
- Keep replies under 25 words, one question max, at most 1 emoji.`;
  }

  if (shouldCaptureLead) {

    const fieldLabels: Record<string, string> = {
      name: "Full Name", phone: "Phone Number", email: "Email Address",
      goal: "Fitness Goal (Weight Loss / Muscle Gain / Endurance / Flexibility / General Fitness)",
      start_date: "When do you plan to start?",
      experience: "Fitness Experience Level",
      preferred_time: "Preferred workout time slot",
    };
    // PROTOCOL SCAFFOLD ONLY — all editorial copy (onboarding order, pricing
    // velvet rope, PT rules, non-membership redirect, plan_interest list rows,
    // goal list rows) lives in ai_knowledge and is injected into <knowledge_base>
    // by buildSystemPrompt. Anything below is wire-protocol contract: JSON shape,
    // known-fields gate, and the lead_captured payload schema.
    const targetFields = leadCaptureConfig!.target_fields || [];
    const fieldNames = targetFields.map((f: string) => fieldLabels[f] || f).join(", ");
    systemPrompt += `\n\n[LEAD CAPTURE PROTOCOL — wire contract]
Follow the "Founder's Phase Onboarding Sequence", "Pricing Embargo", "Personal Training — Velvet Rope" and "Non-Membership Inquiry Redirect" rules from <knowledge_base>. They are authoritative — do not improvise or repeat their wording here.

Target fields to collect (in this order): ${fieldNames}.

INTERACTIVE JSON SHAPE (strict — only after BOTH name + email are present):
{"type":"interactive_list","body":"<question>","button":"<≤20 chars>","sections":[{"title":"<section>","rows":[{"id":"…","title":"…"}]}]}
NEVER wrap it in Meta's native envelope ({"type":"interactive","interactive":{"type":"list",...}}). NEVER use triple-backtick code fences. NEVER add header/footer/action fields.

LEAD_CAPTURED PAYLOAD (emit ONLY when name + email + goal + plan_interest are all present — no prose, no fences):
{"status":"lead_captured","data":{${targetFields.map((f: string) => `"${f}":"<actual_value>"`).join(",")}}}
- Use the exact field keys: ${targetFields.join(", ")}
- Normalize plan_interest to one of: monthly | quarterly | half_yearly | annual.
- The ${ctx.platform === "whatsapp" ? "phone number" : "platform contact ID"} is already known: ${ctx.senderId} — never re-ask.

KNOWN SO FAR (ground truth — NEVER re-ask any filled field):
- name: ${memory?.profile?.full_name || memory?.profile?.first_name || memory?.profile?.name || "—"}
- email: ${memory?.profile?.email || "—"}
- fitness_goal: ${memory?.facts?.fitness_goal || memory?.facts?.goal || "—"}
- plan_interest: ${memory?.facts?.plan_interest || "—"}
ADVANCE RULE: move to the FIRST missing field in order name → email → goal → plan_interest. If name is already known, acknowledge by first name and ask the next missing field — NEVER ask for name again.`;

  }

  // 8. Call AI via the SSOT dispatcher (respects ai_provider_configs scope=whatsapp_ai)
  const aiMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  let aiResult: any;
  try {
    const r = await callAI({
      scope: "whatsapp_ai",
      messages: aiMessages,
      supabase,
      model: aiConfig.model || undefined,
      tools: tools || undefined,
      tool_choice: tools ? "auto" : undefined,
    });
    aiResult = r.raw;
    // Log resolved provider for observability
    try { await supabase.from("ai_call_logs").insert({
      purpose: "whatsapp_reply",
      scope: "whatsapp_ai",
      branch_id: ctx.branchId,
      provider: r.provider,
      model: r.model,
      status: r.fallback_used ? "fallback" : "success",
      duration_ms: 0,
      fallback_used: r.fallback_used,
      platform: ctx.platform ?? null,
      contact_key: ctx.senderId ?? null,
    }); } catch { /* noop */ }
  } catch (e) {
    console.error(`[AI:${ctx.platform}] dispatcher failed:`, e);
    return skip("ai_gateway_error");
  }

  const choice = aiResult?.choices?.[0];
  const toolCalls = choice?.message?.tool_calls;
  let replyText: string | null = choice?.message?.content || null;

  // 9. Handle tool calls
  if (toolCalls?.length && tools && memberCtx.memberId) {
    const toolMessages: any[] = [];
    for (const tc of toolCalls) {
      let parsedArgs: any = {};
      try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }
      const toolStart = Date.now();
      let toolResult: any = null;
      let toolStatus: "success" | "error" = "success";
      let toolError: string | null = null;
      try {
        toolResult = await executeSharedToolCall(
          supabase, supabaseUrl, serviceKey,
          tc.function.name, parsedArgs,
          {
            isMember: true,
            memberId: memberCtx.memberId,
            memberName: memberCtx.memberName || "Member",
            branchId: ctx.branchId,
            membershipId: memberCtx.membershipId ?? null,
            planId: memberCtx.planId ?? null,
            contextPrompt: memberCtx.contextPrompt,
          },
          ctx.senderId, ctx.branchId, ctx.platform,
        );
        if (toolResult && typeof toolResult === "object" && (toolResult as any).success === false) {
          toolStatus = "error";
          toolError = String((toolResult as any).error || (toolResult as any).message || "tool_returned_failure").slice(0, 500);
        }
      } catch (toolErr) {
        toolStatus = "error";
        toolError = (toolErr as Error)?.message?.slice(0, 500) || String(toolErr);
        toolResult = { success: false, error: toolError };
      }
      // Live Activity Feed: one row per tool call (fire-and-forget)
      try {
        await supabase.from("ai_tool_logs").insert({
          tool_name: tc.function.name,
          status: toolStatus,
          execution_time_ms: Date.now() - toolStart,
          error_message: toolError,
          arguments: parsedArgs ?? {},
          result: toolResult ?? {},
          branch_id: ctx.branchId ?? null,
          phone_number: ctx.platform === "whatsapp" ? ctx.senderId : null,
          platform: ctx.platform ?? null,
          contact_key: ctx.senderId ?? null,
        });
      } catch { /* noop */ }
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(toolResult) });
    }
    try {
      const r2 = await callAI({
        scope: "whatsapp_ai",
        supabase,
        model: aiConfig.model || undefined,
        messages: [...aiMessages, choice.message, ...toolMessages],
      });
      replyText = r2.raw?.choices?.[0]?.message?.content || replyText;
    } catch (e) {
      console.error(`[AI:${ctx.platform}] tool follow-up failed:`, e);
    }
  }

  // v3.6.0 — silent-drop fix. The model occasionally returns only a tool_call
  // (with empty `content`) and the follow-up `callAI` also yields empty
  // content. Previously this hit `skip("no_reply_text")` and the user got
  // nothing. We now (a) write a diagnostic to error_logs so we can see it
  // happen, and (b) compose a deterministic next-step reply from `memory` so
  // the conversation never stalls silently.
  if (!replyText) {
    try {
      await supabase.rpc("log_error_event", {
        p_source: "ai_agent_brain",
        p_severity: "warning",
        p_message: `Empty reply from AI for ${ctx.platform} ${ctx.senderId} — falling back to deterministic next-step`,
        p_context: {
          branch_id: ctx.branchId,
          platform: ctx.platform,
          sender: ctx.senderId,
          had_tool_calls: Array.isArray((choice as any)?.message?.tool_calls) && (choice as any).message.tool_calls.length > 0,
          message_id: ctx.messageId ?? null,
        },
      });
    } catch { /* noop */ }
    const fallback = buildNoReplyFallback(memory, shouldCaptureLead);
    if (!fallback) return skip("no_reply_text");
    replyText = fallback;
  }

  // 9b. OUTBOUND GUARDS — strip / replace interactive blocks the LLM emitted that
  // would violate the hard onboarding gate or duplicate a question already asked.
  // v1.0.0 — defense-in-depth: prompt rules can fail, this cannot.
  replyText = enforceOutboundInteractiveGuards({
    replyText,
    memory,
    history,
    platform: ctx.platform,
    leadCaptureEnabled: shouldCaptureLead,
  });

  // 9c. FOUNDER'S PHASE plain-text sanitizer — final line of defense.
  replyText = sanitizeFoundersPhaseText({
    replyText,
    memory,
    leadCaptureEnabled: shouldCaptureLead,
  });

  // 9d. NAME-REPEAT GUARD — if memory already has a real first name and the
  // model is still asking for it (history fetch can be empty, model can ignore
  // the prompt), rewrite the reply to thank the user and advance to the next
  // missing field. This is the last barrier and never depends on the LLM.
  replyText = enforceNoRepeatNameAsk({
    replyText,
    memory,
    leadCaptureEnabled: shouldCaptureLead,
  });




  // 10. Lead capture parsing
  if (shouldCaptureLead) {
    const leadResult = await tryParseAndCaptureLead(
      supabase, replyText, ctx, leadCaptureConfig!, supabaseUrl, serviceKey,
    );
    if (leadResult.captured) {
      // Persist captured fields into ai_memory + mark do-not-ask for those keys
      const capturedKeys = leadResult.partialData ? Object.keys(leadResult.partialData) : [];
      await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
        profile: leadResult.partialData || {},
        do_not_ask_add: capturedKeys,
        current_intent: "lead_captured",
        summary: memory?.summary ?? null,
      });
      const handoffMsg = leadCaptureConfig!.handoff_message || "Thanks for sharing! Our team will reach out to you shortly. 💪";
      return { replyText: handoffMsg, leadCaptured: true, leadId: leadResult.leadId, handoffTriggered: false, skipped: false };
    }
    // Store partial data even if not fully captured
    if (leadResult.partialData && Object.keys(leadResult.partialData).length > 0) {
      await supabase.from("whatsapp_chat_settings").upsert(
        { branch_id: ctx.branchId, phone_number: ctx.senderId, partial_lead_data: leadResult.partialData },
        { onConflict: "branch_id,phone_number" },
      );
      // Also persist partial fields into long-term memory
      await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
        profile: leadResult.partialData,
        current_intent: "lead_in_progress",
      });
    }
  }

  // 10b. Always touch memory with member identity + last-seen + last question asked
  const profilePatch: Record<string, any> = {};
  if (memberCtx.isMember) {
    profilePatch.is_member = true;
    if (memberCtx.memberId) profilePatch.member_id = memberCtx.memberId;
    if (memberCtx.memberName) profilePatch.name = memberCtx.memberName;
  }
  // Heuristic: if the reply ends with "?" treat it as an asked question we remember
  const askedNow: string[] = [];
  const trimmed = (replyText || "").trim();
  if (trimmed.endsWith("?")) {
    const lastSentence = trimmed.split(/(?<=[.!?])\s+/).pop() || trimmed;
    askedNow.push(lastSentence.slice(0, 200));
  }
  // Also log emitted interactive_list/button body so duplicate detection can see it
  if (/"type"\s*:\s*"interactive(_list)?"/.test(trimmed)) {
    try {
      const j = trimmed.match(/\{[\s\S]*\}/)?.[0];
      if (j) {
        const p = JSON.parse(j);
        const b = String(p?.body?.text ?? p?.body ?? "").trim();
        if (b) askedNow.push(b.slice(0, 200));
      }
    } catch { /* noop */ }
  }

  await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
    profile: profilePatch,
    asked_questions_add: askedNow,
    current_intent: memberCtx.isMember ? "member_assist" : (memory?.current_intent ?? null),
  });

  return { replyText, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function skip(reason: string): AgentResult {
  return { replyText: null, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: true, skipReason: reason };
}

// ── Outbound interactive guards ──────────────────────────────────────────────
// Server-side defense for the prompt-only HARD GATE + duplicate interactive_list
// emissions. The LLM violates these rules occasionally; this function never does.
//
// Behavior:
//  1. If reply contains an interactive_list/interactive JSON whose body text
//     was already sent in the last 3 outbound turns → strip the JSON and fall
//     back to a plain-text "next missing field" question.
//  2. If reply contains interactive JSON but lead-capture HARD GATE prereqs
//     (name + email) are missing → strip and fall back to plain-text ask for
//     whichever field is missing first.
//  3. If reply is interactive_list for plan_interest but memory.facts.plan_interest
//     is already set → strip and acknowledge + advance.
function enforceOutboundInteractiveGuards(input: {
  replyText: string;
  memory: any;
  history: Array<{ role: string; content: string }>;
  platform: Platform;
  leadCaptureEnabled: boolean;
}): string {
  const { replyText, memory, history, leadCaptureEnabled } = input;
  const trimmed = (replyText || "").trim();

  // Cheap reject — not interactive JSON
  if (!/"type"\s*:\s*"interactive(_list)?"/.test(trimmed)) return replyText;

  // Try to parse the JSON envelope
  let parsed: any = null;
  let bodyText = "";
  try {
    const jsonStr = trimmed.startsWith("{") ? trimmed : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "");
    if (jsonStr) {
      parsed = JSON.parse(jsonStr);
      bodyText = String(
        parsed?.body?.text ?? parsed?.body ?? parsed?.text ?? "",
      ).trim();
    }
  } catch {
    return replyText; // malformed JSON — let downstream handle/log
  }
  if (!parsed || !bodyText) return replyText;

  const rawName = memory?.profile?.full_name || memory?.profile?.first_name || memory?.profile?.name || "";
  const realName = looksLikeRealName(rawName, (memory as any)?.profile?.phone) ? String(rawName) : "";
  const knownName = !!realName;
  const knownEmail = !!memory?.profile?.email;

  // v3.6.0 — goal & plan_interest fall back to interactive_list JSON (4 rows each).
  const goalListJson = (firstName: string) => JSON.stringify({
    type: "interactive_list",
    body: { text: firstName ? `Got it, ${firstName} — what's your main fitness goal? ✨` : "What's your main fitness goal? ✨" },
    button: "Choose goal",
    sections: [{
      title: "Fitness Goal",
      rows: [
        { id: "weight_loss", title: "Weight Loss" },
        { id: "muscle_gain", title: "Muscle Gain" },
        { id: "endurance", title: "Endurance" },
        { id: "general", title: "Flexibility / General" },
      ],
    }],
  });
  const planListJson = (firstName: string) => JSON.stringify({
    type: "interactive_list",
    body: { text: firstName ? `Perfect, ${firstName} — which membership duration are you thinking about?` : "Which membership duration are you thinking about?" },
    button: "Choose duration",
    sections: [{
      title: "Membership Duration",
      rows: [
        { id: "monthly", title: "Monthly" },
        { id: "quarterly", title: "Quarterly" },
        { id: "half_yearly", title: "Half-Yearly" },
        { id: "annual", title: "Annual — Founding Member" },
      ],
    }],
  });

  const askNextMissing = (): string => {
    if (!knownName) return "Sure — may I have your name first? ✨";
    const firstName = realName.split(/\s+/)[0];
    if (!knownEmail) {
      return firstName
        ? `Thanks, ${firstName} — what's the best email for your Founding Member invite? ✨`
        : "Could you share your email so our team can send your Founding Member invite?";
    }
    const knownGoal = !!(memory?.facts?.fitness_goal || memory?.facts?.goal);
    if (!knownGoal) return goalListJson(firstName);
    const knownPlan = !!memory?.facts?.plan_interest;
    if (!knownPlan) return planListJson(firstName);
    return firstName
      ? `You're locked in on the Founding Member list, ${firstName} ✨ One of our founders will personally walk you through your pre-launch onboarding right here on WhatsApp when your slot opens — no need to chase.`
      : "You're locked in on the Founding Member list ✨ One of our founders will personally walk you through your pre-launch onboarding right here on WhatsApp when your slot opens — no need to chase.";
  };



  // Look at last 6 outbound messages for the same body text
  const recentOutbound = history.filter((m) => m.role === "assistant").slice(-6);
  const sameBodyCount = recentOutbound.filter((m) => {
    const c = String(m.content || "");
    if (c.includes(bodyText)) return true;
    // Also match if the prior message was a JSON whose body equals bodyText
    try {
      const j = c.match(/\{[\s\S]*\}/)?.[0];
      if (j) {
        const p = JSON.parse(j);
        const b = String(p?.body?.text ?? p?.body ?? "").trim();
        return b && b === bodyText;
      }
    } catch { /* noop */ }
    return false;
  }).length;

  // (1) Duplicate interactive — fall back to plain text
  if (sameBodyCount >= 1) {
    console.log(`[AI:guards] dropping duplicate interactive — bodyText="${bodyText.slice(0, 60)}"`);
    return askNextMissing();
  }

  // (2) Hard gate — interactive before name + email is captured
  if (leadCaptureEnabled && (!knownName || !knownEmail)) {
    console.log(`[AI:guards] stripping interactive — hard gate (name=${knownName}, email=${knownEmail})`);
    return askNextMissing();
  }

  // (3) FOUNDER'S PHASE — only PT-package / day-pass interactives are forbidden.
  //     Duration/goal interactives are explicitly allowed (v3.6.0).
  if (/pt\s*package|personal\s*training\s*package|day\s*pass|session\s*pack/i.test(bodyText)) {
    console.log(`[AI:guards] dropping forbidden PT/day-pass interactive (founder's phase) — body="${bodyText.slice(0, 80)}"`);
    return askNextMissing();
  }

  return replyText;
}

// ─── Name-repeat guard ────────────────────────────────────────────────────────
// If memory.profile already has a real first name and the LLM produced any
// variant of "what's your name?", rewrite the reply to acknowledge the user
// and ask for the next missing onboarding field.
// v4.6.0 — aliased to the shared NAME_ASK_DETECT_RE so the funnel and this
// post-process guard agree on what counts as a "name ask".
const NAME_ASK_RE = NAME_ASK_DETECT_RE;

function enforceNoRepeatNameAsk(input: {
  replyText: string;
  memory: any;
  leadCaptureEnabled: boolean;
}): string {
  const { replyText, memory, leadCaptureEnabled } = input;
  if (!leadCaptureEnabled) return replyText;
  const text = String(replyText || "");
  if (!text) return replyText;
  // Skip JSON-only payloads — handled by the interactive guards.
  if (/^\s*\{[\s\S]*"type"\s*:\s*"interactive/i.test(text.trim())) return replyText;

  const rawName = memory?.profile?.full_name || memory?.profile?.first_name || memory?.profile?.name || "";
  if (!looksLikeRealName(rawName, (memory as any)?.profile?.phone)) return replyText;
  if (!NAME_ASK_RE.test(text)) return replyText;

  const firstName = String(rawName).trim().split(/\s+/)[0];
  const knownEmail = !!memory?.profile?.email;
  const knownGoal = !!(memory?.facts?.fitness_goal || memory?.facts?.goal);
  const knownPlan = !!memory?.facts?.plan_interest;

  console.log(
    `[AI:guards] rewriting reply — name=${firstName} already captured but model re-asked for name`,
  );

  if (!knownEmail) {
    return `Thanks, ${firstName} — what's the best email for your Founding Member invite? ✨`;
  }
  if (!knownGoal) {
    return `Got it, ${firstName} — what's your main fitness goal? ✨`;
  }
  if (!knownPlan) {
    return `Perfect, ${firstName} — which membership duration are you thinking about (monthly, quarterly, half-yearly, or annual)?`;
  }
  return `You're locked in on our Founding Member list, ${firstName} ✨ One of our founders will personally walk you through your pre-launch onboarding right here on WhatsApp when your slot opens.`;
}



// ─── Founder's Phase plain-text sanitizer (v3.5.0) ─────────────────────────
// We DO allow the words monthly/quarterly/half-yearly/annual/Founding/plan/goal
// because we now capture plan_interest as free text. We block only price
// mentions, fee mentions, PT package names, and "send the details" promises.
const FORBIDDEN_PLAN_TEXT_RE =
  /\b(pt\s+package|personal\s+training\s+package|session\s+pack|day\s*pass)\b/i;
const FORBIDDEN_PRICE_TEXT_RE = /(₹|\bRs\.?\b|\/-|\bINR\b|\brupees?\b|\bprice\b|\bfees?\b|\bcost\b|\bcharges?\b|\bamount\b)/i;
const SEND_DETAILS_RE = /\bsend\s+(?:you\s+)?the\s+(?:price|fee|cost|charges?)\s*(?:details|info)?/i;
// v4.5.0 — opening/launch date redaction. We never disclose a date publicly.
const OPENING_DATE_RE =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s*,?\s*20\d{2}\b/gi;
const OPENING_VERB_YEAR_RE =
  /\b(?:opens?|opening|launch(?:es|ing)?|doors?\s+open|khulega|khul\s+raha|kab\s+khul)[^.!?\n]{0,60}\b20\d{2}\b/gi;
const OPENING_DATE_NEUTRAL =
  "Our opening date hasn't been announced publicly yet — our team will share it as soon as it's locked in ✨";

function redactOpeningDate(text: string): { redacted: string; hit: boolean } {
  if (!text) return { redacted: text, hit: false };
  const before = text;
  let out = text.replace(OPENING_VERB_YEAR_RE, "open soon");
  out = out.replace(OPENING_DATE_RE, "soon");
  return { redacted: out, hit: out !== before };
}

function sanitizeFoundersPhaseText(input: {
  replyText: string;
  memory: any;
  leadCaptureEnabled: boolean;
}): string {
  const { replyText, memory, leadCaptureEnabled } = input;
  if (!leadCaptureEnabled) return replyText;
  const text = String(replyText || "");
  // Skip JSON-only payloads — handled by enforceOutboundInteractiveGuards.
  if (/^\s*\{[\s\S]*"type"\s*:\s*"interactive/i.test(text.trim())) return replyText;

  // 0. Opening-date guard — runs before plan/price checks. Applies to ALL
  //    outbound text regardless of capture state.
  const dateScan = redactOpeningDate(text);
  if (dateScan.hit) {
    console.log("[AI:guards] redacted opening-date leak");
    // If date was the only issue, return neutral line; otherwise continue
    // sanitization on the redacted text.
    const redacted = dateScan.redacted;
    if (!FORBIDDEN_PLAN_TEXT_RE.test(redacted) && !FORBIDDEN_PRICE_TEXT_RE.test(redacted) && !SEND_DETAILS_RE.test(redacted)) {
      return OPENING_DATE_NEUTRAL;
    }
  }

  const scrubbed = dateScan.hit ? dateScan.redacted : text;
  const hasForbiddenPlan = FORBIDDEN_PLAN_TEXT_RE.test(scrubbed);
  const hasForbiddenPrice = FORBIDDEN_PRICE_TEXT_RE.test(scrubbed);
  const hasSendDetails = SEND_DETAILS_RE.test(scrubbed);

  if (!hasForbiddenPlan && !hasForbiddenPrice && !hasSendDetails) return dateScan.hit ? scrubbed : replyText;

  const rawName = memory?.profile?.full_name || memory?.profile?.first_name || memory?.profile?.name || "";
  const realName = looksLikeRealName(rawName, (memory as any)?.profile?.phone) ? String(rawName) : "";
  const firstName = realName ? realName.split(/\s+/)[0] : "";
  const knownName = !!realName;
  const knownEmail = !!memory?.profile?.email;
  const knownGoal = !!(memory?.facts?.fitness_goal || memory?.facts?.goal);
  const knownPlan = !!memory?.facts?.plan_interest;

  console.log(`[AI:guards] sanitizing founder's-phase leak (pt/pack=${hasForbiddenPlan}, price=${hasForbiddenPrice}, sendDetails=${hasSendDetails})`);

  if (!knownName) return "Sure — may I have your name first? ✨";
  if (!knownEmail) {
    return firstName
      ? `Thanks, ${firstName} — what's the best email for your Founding Member invite? ✨`
      : "Could you share your email for your Founding Member invite? ✨";
  }
  if (!knownGoal) {
    return JSON.stringify({
      type: "interactive_list",
      body: { text: firstName ? `Got it, ${firstName} — what's your main fitness goal? ✨` : "What's your main fitness goal? ✨" },
      button: "Choose goal",
      sections: [{ title: "Fitness Goal", rows: [
        { id: "weight_loss", title: "Weight Loss" },
        { id: "muscle_gain", title: "Muscle Gain" },
        { id: "endurance", title: "Endurance" },
        { id: "general", title: "Flexibility / General" },
      ] }],
    });
  }
  if (!knownPlan) {
    return JSON.stringify({
      type: "interactive_list",
      body: { text: firstName ? `Perfect, ${firstName} — which membership duration are you thinking about?` : "Which membership duration are you thinking about?" },
      button: "Choose duration",
      sections: [{ title: "Membership Duration", rows: [
        { id: "monthly", title: "Monthly" },
        { id: "quarterly", title: "Quarterly" },
        { id: "half_yearly", title: "Half-Yearly" },
        { id: "annual", title: "Annual — Founding Member" },
      ] }],
    });
  }
  return firstName
    ? `You're locked in on the Founding Member list, ${firstName} ✨ One of our founders will personally walk you through your pre-launch onboarding right here on WhatsApp closer to opening.`
    : "You're locked in on the Founding Member list ✨ One of our founders will personally walk you through your pre-launch onboarding right here on WhatsApp closer to opening.";
}

// Deterministic fallback when the model returns no text. Mirrors the
// onboarding sequence (Name → Email → Goal → Plan) so a missing field always
// gets re-asked instead of leaving the user with silence.
function buildNoReplyFallback(memory: any, leadCaptureEnabled: boolean): string | null {
  const rawName = memory?.profile?.full_name || memory?.profile?.first_name || memory?.profile?.name || "";
  const realName = looksLikeRealName(rawName, (memory as any)?.profile?.phone) ? String(rawName) : "";
  const firstName = realName ? realName.split(/\s+/)[0] : "";
  const knownName = !!realName;
  const knownEmail = !!memory?.profile?.email;
  const knownGoal = !!(memory?.facts?.fitness_goal || memory?.facts?.goal);
  const knownPlan = !!memory?.facts?.plan_interest;

  if (leadCaptureEnabled) {
    if (!knownName) return "Sure — may I have your name first? ✨";
    if (!knownEmail) {
      return firstName
        ? `Thanks, ${firstName} — what's the best email for your Founding Member invite? ✨`
        : "Could you share your email for your Founding Member invite? ✨";
    }
    if (!knownGoal) {
      return firstName
        ? `Got it, ${firstName} — what's your main fitness goal? ✨`
        : "What's your main fitness goal? ✨";
    }
    if (!knownPlan) {
      return firstName
        ? `Perfect, ${firstName} — which membership duration are you thinking about (monthly, quarterly, half-yearly, or annual)?`
        : "Which membership duration are you thinking about (monthly, quarterly, half-yearly, or annual)?";
    }
  }
  return firstName
    ? `Got it, ${firstName} — give me one sec while our team picks this up. ✨`
    : "Got it — give me one sec while our team picks this up. ✨";

}




// Gym knowledge cache (refreshes every 5 min)
let _gymFactsCache: string | null = null;
let _gymFactsTs = 0;
async function hydrateGymFacts(supabase: any, branchId: string): Promise<string> {
  if (_gymFactsCache && Date.now() - _gymFactsTs < 300_000) return _gymFactsCache;
  try {
    const [plansRes, facilitiesRes, branchRes] = await Promise.all([
      supabase.from("membership_plans").select("name, duration_days, price, discounted_price, admission_fee, description").eq("branch_id", branchId).eq("is_active", true).order("price"),
      supabase.from("facilities").select("name, capacity, description").eq("branch_id", branchId).eq("is_active", true),
      supabase.from("branches").select("name, address, city, phone, opening_time, closing_time").eq("id", branchId).maybeSingle(),
    ]);
    const parts: string[] = ["[GYM KNOWLEDGE — use this to answer questions directly]"];

    if (branchRes.data) {
      const b = branchRes.data;
      parts.push(`Location: ${b.name || "Incline"}, ${b.address || ""}, ${b.city || "Udaipur"}. Phone: ${b.phone || "N/A"}.`);
      if (b.opening_time && b.closing_time) parts.push(`Timings: ${b.opening_time} – ${b.closing_time}`);
    }

    if (plansRes.data?.length) {
      const planLines = plansRes.data.map((p: any) => {
        const dur = p.duration_days >= 365 ? `${Math.round(p.duration_days / 365)} year` : p.duration_days >= 30 ? `${Math.round(p.duration_days / 30)} month` : `${p.duration_days} day`;
        const price = p.discounted_price || p.price;
        const admission = p.admission_fee ? ` + ₹${p.admission_fee} admission` : "";
        return `• ${p.name} (${dur}): ₹${price}${admission}`;
      });
      parts.push(`\nMembership Plans:\n${planLines.join("\n")}`);
    }

    if (facilitiesRes.data?.length) {
      const facLines = facilitiesRes.data.map((f: any) => `• ${f.name} (capacity: ${f.capacity})`);
      parts.push(`\nRecovery Facilities:\n${facLines.join("\n")}`);
    }

    parts.push(`\nEquipment: 50+ machines including Panatta (Italy), Real Leader (USA), Hammer Strength. Full free-weight area, functional training zone.`);
    parts.push(`USP: 3D body scanning (HOWBODY), ice bath, sauna therapy, biomechanical precision equipment.`);

    _gymFactsCache = parts.join("\n");
    _gymFactsTs = Date.now();
    return _gymFactsCache;
  } catch (e) {
    console.error("[AI] hydrateGymFacts failed:", e);
    return "";
  }
}

let _orgConfigCache: any = null;
let _orgConfigTs = 0;
async function loadOrgConfig(supabase: any) {
  if (_orgConfigCache && Date.now() - _orgConfigTs < 60_000) return _orgConfigCache;
  const { data } = await supabase.from("organization_settings").select("name").limit(1).maybeSingle();
  _orgConfigCache = data;
  _orgConfigTs = Date.now();
  return data;
}

// ── ai_purposes loader (UI-managed single source of truth) ─────────────────
const _purposeCache = new Map<string, { row: any; ts: number }>();
export async function loadAiPurpose(supabase: any, purpose: string, branchId: string | null) {
  const key = `${purpose}:${branchId ?? "global"}`;
  const cached = _purposeCache.get(key);
  if (cached && Date.now() - cached.ts < 30_000) return cached.row;
  // Branch-specific row first, then global fallback
  let row: any = null;
  if (branchId) {
    const { data } = await supabase
      .from("ai_purposes")
      .select("*")
      .eq("purpose", purpose)
      .eq("branch_id", branchId)
      .maybeSingle();
    row = data;
  }
  if (!row) {
    const { data } = await supabase
      .from("ai_purposes")
      .select("*")
      .eq("purpose", purpose)
      .is("branch_id", null)
      .maybeSingle();
    row = data;
  }
  _purposeCache.set(key, { row, ts: Date.now() });
  return row;
}

// Translate an ai_purposes row into the runtime OrgAiConfig shape.
// SSOT: persona/tone comes from purpose.system_prompt + ai_knowledge;
// operational toggles come from purpose.ops_config; lead-capture from purpose.extra.
export function purposeToConfig(purpose: any): OrgAiConfig {
  if (!purpose) return { auto_reply_enabled: false } as OrgAiConfig;
  const ops = (purpose.ops_config ?? {}) as Record<string, any>;
  const extraLeadCapture = purpose.extra?.lead_capture as OrgAiConfig["lead_capture"] | undefined;
  return {
    auto_reply_enabled: ops.auto_reply_enabled ?? purpose.enabled ?? false,
    reply_delay_seconds: ops.reply_delay_seconds ?? purpose.reply_delay_seconds ?? 0,
    system_prompt: (purpose.system_prompt ?? "").trim(),
    model: purpose.model || undefined,
    lead_capture: extraLeadCapture,
    instagram_story_reply_enabled: ops.instagram_story_reply_enabled === true,
    channels: (ops.channels && typeof ops.channels === 'object') ? ops.channels : undefined,
    ...(Array.isArray(purpose.tools_allowed) && purpose.tools_allowed.length > 0
      ? { _tools_allowed: purpose.tools_allowed }
      : {}),
  } as OrgAiConfig & { _tools_allowed?: string[] };

}

async function loadCapturedSnapshot(supabase: any, leadId: string): Promise<string> {
  const { data: existingLead } = await supabase
    .from("leads")
    .select("full_name, email, goals, budget, preferred_time, fitness_goal, fitness_experience, expected_start_date")
    .eq("id", leadId)
    .maybeSingle();
  if (!existingLead) return "";
  const known = Object.entries(existingLead)
    .filter(([_, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}=${v}`).join(", ");
  return known ? `\n\n[KNOWN LEAD — DO NOT RE-ASK]\nThis person is already a captured lead. Known: ${known}. Do NOT ask for their name, email, goals, budget, or preferred time again.` : "";
}

interface MemberResolveResult {
  isMember: boolean;
  memberId?: string;
  memberName?: string;
  memberPhone?: string;
  memberEmail?: string;
  membershipId?: string;
  planId?: string;
  planName?: string;
  planEndsAt?: string;
  contextPrompt: string;
  // Set only when isMember=false and a lead row exists for this sender.
  leadId?: string;
  leadName?: string;
  leadStage?: string;
  leadPhone?: string;
  leadEmail?: string;
}

async function resolveMemberContext(supabase: any, senderId: string, branchId: string, platform: Platform): Promise<MemberResolveResult> {
  // For WhatsApp: senderId is a phone number — use full variant set so we
  // catch bare 10-digit, +91-prefixed, and 91-prefixed forms equally.
  // For IG/Messenger: senderId is a platform user ID — phone match will
  // simply not hit, which is correct.
  const variants = phoneVariants(senderId);

  let memberMatch: any = null;
  let memberPhone: string | undefined;
  let memberEmail: string | undefined;

  // Resolve member via profiles.phone → members.user_id
  if (variants.length > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, phone, email")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();
    if (profile?.id) {
      const { data: member } = await supabase
        .from("members")
        .select("id, branch_id, member_code, profiles!inner(full_name, phone, email)")
        .eq("user_id", profile.id)
        .limit(1)
        .maybeSingle();
      if (member) {
        memberMatch = member;
        memberPhone = (profile as any).phone || undefined;
        memberEmail = (profile as any).email || undefined;
      }
    }
  }

  if (!memberMatch) {
    let leadContext = "";
    let leadId: string | undefined;
    let leadName: string | undefined;
    let leadStage: string | undefined;
    let leadPhone: string | undefined;
    let leadEmail: string | undefined;

    // Step 1: variant-aware phone lookup (works for WhatsApp; usually misses on IG/Messenger).
    if (variants.length > 0) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, full_name, status, fitness_goal, phone, email")
        .in("phone", variants)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lead) {
        leadId = (lead as any).id;
        leadName = (lead as any).full_name || undefined;
        leadStage = (lead as any).status || undefined;
        leadPhone = (lead as any).phone || undefined;
        leadEmail = (lead as any).email || undefined;
        leadContext = `[Lead] ${lead.full_name || "Unknown"}, Status: ${lead.status || "-"}, Goal: ${lead.fitness_goal || "-"}`;
      }
    }

    // Step 1b (IG/Messenger only): fall back to whatsapp_chat_settings.captured_lead_id
    // so a lead captured via website/WhatsApp is still recognised on Instagram.
    if (!leadId && platform !== "whatsapp") {
      try {
        const { data: chat } = await supabase
          .from("whatsapp_chat_settings")
          .select("captured_lead_id")
          .eq("branch_id", branchId)
          .eq("phone_number", senderId)
          .limit(1)
          .maybeSingle();
        const linkedId = (chat as any)?.captured_lead_id;
        if (linkedId) {
          const { data: lead } = await supabase
            .from("leads")
            .select("id, full_name, status, fitness_goal, phone, email")
            .eq("id", linkedId)
            .limit(1)
            .maybeSingle();
          if (lead) {
            leadId = (lead as any).id;
            leadName = (lead as any).full_name || undefined;
            leadStage = (lead as any).status || undefined;
            leadPhone = (lead as any).phone || undefined;
            leadEmail = (lead as any).email || undefined;
            leadContext = `[Lead] ${lead.full_name || "Unknown"}, Status: ${lead.status || "-"}, Goal: ${lead.fitness_goal || "-"}`;
          }
        }
      } catch (_) { /* non-fatal */ }
    }

    // Step 1c: if still unknown, peek at ai_memory.profile for a previously
    // collected phone/email and re-run member + lead lookups against it.
    if (!leadId && !memberMatch) {
      try {
        const { data: mem } = await supabase
          .from("ai_memory")
          .select("profile")
          .eq("branch_id", branchId)
          .eq("platform", platform)
          .eq("contact_key", senderId)
          .limit(1)
          .maybeSingle();
        const memPhone = (mem as any)?.profile?.phone as string | undefined;
        const memEmail = (mem as any)?.profile?.email as string | undefined;
        if (memPhone) {
          const memVariants = phoneVariants(memPhone);
          if (memVariants.length > 0) {
            const { data: prof2 } = await supabase
              .from("profiles")
              .select("id, full_name, phone, email")
              .in("phone", memVariants)
              .limit(1)
              .maybeSingle();
            if (prof2?.id) {
              const { data: member2 } = await supabase
                .from("members")
                .select("id, branch_id, member_code, profiles!inner(full_name, phone, email)")
                .eq("user_id", prof2.id)
                .limit(1)
                .maybeSingle();
              if (member2) {
                memberMatch = member2;
                memberPhone = (prof2 as any).phone || undefined;
                memberEmail = (prof2 as any).email || undefined;
              }
            }
            if (!memberMatch) {
              const { data: lead2 } = await supabase
                .from("leads")
                .select("id, full_name, status, fitness_goal, phone, email")
                .in("phone", memVariants)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (lead2) {
                leadId = (lead2 as any).id;
                leadName = (lead2 as any).full_name || undefined;
                leadStage = (lead2 as any).status || undefined;
                leadPhone = (lead2 as any).phone || memPhone;
                leadEmail = (lead2 as any).email || memEmail || undefined;
                leadContext = `[Lead] ${lead2.full_name || "Unknown"}, Status: ${lead2.status || "-"}, Goal: ${lead2.fitness_goal || "-"}`;
              }
            }
          }
        }
        // If we still haven't found a lead but ai_memory has at least an email,
        // surface it so the prompt won't re-ask.
        if (!leadId && !memberMatch && memEmail) {
          leadEmail = memEmail;
        }
      } catch (_) { /* non-fatal */ }
    }

    if (!memberMatch) {
      return {
        isMember: false,
        contextPrompt: leadContext || "Speaking to a guest/lead.",
        leadId,
        leadName,
        leadStage,
        leadPhone,
        leadEmail,
      };
    }
  }


  const memberName = (memberMatch as any).profiles?.full_name || "Member";
  let membershipId: string | undefined;
  let planId: string | undefined;
  let planName: string | undefined;
  let endDate: string | undefined;
  let daysRemaining: number | null = null;
  const { data: ms } = await supabase
    .from("memberships")
    .select("id, plan_id, end_date, status, plans(name)")
    .eq("member_id", memberMatch.id)
    .eq("status", "active")
    .order("end_date", { ascending: false })
    .limit(1).maybeSingle();
  if (ms) {
    membershipId = (ms as any).id;
    planId = (ms as any).plan_id;
    planName = (ms as any).plans?.name;
    endDate = (ms as any).end_date;
    if (endDate) {
      daysRemaining = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    }
  }

  // Enrich: outstanding dues + last reminders sent + lifecycle hints
  let duesLine = "";
  try {
    const { data: dues } = await supabase
      .from("invoices")
      .select("total_amount, amount_paid")
      .eq("member_id", memberMatch.id)
      .in("status", ["pending", "partial", "overdue"]);
    const totalDue = (dues || []).reduce(
      (s: number, i: any) => s + (Number(i.total_amount || 0) - Number(i.amount_paid || 0)),
      0,
    );
    if (totalDue > 0) duesLine = ` · Outstanding dues: ₹${totalDue.toFixed(0)} across ${(dues || []).length} invoice(s)`;
  } catch (_) { /* non-fatal */ }

  let recentReminderLine = "";
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rem } = await supabase
      .from("whatsapp_messages")
      .select("template_name, created_at")
      .eq("phone_number", senderId)
      .eq("direction", "outbound")
      .gte("created_at", since)
      .not("template_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(3);
    if ((rem || []).length > 0) {
      const names = (rem as any[]).map((r) => r.template_name).filter(Boolean).slice(0, 3).join(", ");
      if (names) recentReminderLine = ` · Recent reminders sent (7d): ${names}`;
    }
  } catch (_) { /* whatsapp_messages may not exist; ignore */ }

  const lifecycle = daysRemaining === null
    ? "no active membership"
    : daysRemaining < 0
      ? `EXPIRED ${Math.abs(daysRemaining)}d ago — renewal needed`
      : daysRemaining <= 7
        ? `expiring in ${daysRemaining}d — renewal opportunity`
        : `${daysRemaining}d remaining`;

  const memberCode = (memberMatch as any).member_code || "";
  const contextPrompt = `Context: Speaking to ${memberName}, an Active Member${memberCode ? ` (Code: ${memberCode})` : ""}.${planName ? ` Plan: ${planName}.` : ""} ${lifecycle}.${duesLine}${recentReminderLine}`;

  return {
    isMember: true,
    memberId: memberMatch.id,
    memberName,
    memberPhone: memberPhone || ((memberMatch as any).profiles?.phone) || undefined,
    memberEmail: memberEmail || ((memberMatch as any).profiles?.email) || undefined,
    membershipId,
    planId,
    planName,
    planEndsAt: endDate,
    contextPrompt,
  };
}

// ─── Lead capture parsing ──────────────────────────────────────────────────────

interface LeadCaptureResult {
  captured: boolean;
  leadId: string | null;
  partialData: Record<string, any>;
}

async function tryParseAndCaptureLead(
  supabase: any,
  replyText: string,
  ctx: AgentContext,
  config: { target_fields?: string[]; handoff_message?: string },
  supabaseUrl: string,
  serviceKey: string,
): Promise<LeadCaptureResult> {
  let parsedLeadData: Record<string, any> | null = null;

  // Primary: JSON extraction
  try {
    const jsonMatch = replyText.match(/\{[\s\S]*"status"\s*:\s*"lead_captured"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.status === "lead_captured" && parsed.data) {
        parsedLeadData = parsed.data;
      }
    }
  } catch { /* continue to fallback */ }

  // Fallback: extract from natural language
  const partialData: Record<string, any> = {};
  if (!parsedLeadData && replyText.length > 20) {
    const nameMatch = replyText.match(/(?:name|Name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    const emailMatch = replyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const goalMatch = replyText.match(/(?:goal|Goal)[:\s]+([^\n,]+)/);
    const timeMatch = replyText.match(/(?:time|Time|prefer|Prefer)[:\s]+([^\n,]+)/);

    if (nameMatch) partialData.name = nameMatch[1];
    if (emailMatch) partialData.email = emailMatch[0];
    if (goalMatch) partialData.goal = goalMatch[1]?.trim();
    if (timeMatch) partialData.preferred_time = timeMatch[1]?.trim();
    if (ctx.contactName) partialData.contact_name = ctx.contactName;

    // Only capture with name + email + >=2 inbound messages
    const { count: msgCount } = await supabase
      .from("whatsapp_messages")
      .select("*", { count: "exact", head: true })
      .eq("phone_number", ctx.senderId)
      .eq("branch_id", ctx.branchId)
      .eq("direction", "inbound");

    if ((msgCount || 0) >= 2 && nameMatch && emailMatch) {
      parsedLeadData = {
        name: nameMatch[1],
        email: emailMatch[0],
        goal: goalMatch?.[1]?.trim() || null,
        preferred_time: timeMatch?.[1]?.trim() || null,
      };
    }
  }

  if (!parsedLeadData) {
    return { captured: false, leadId: null, partialData };
  }

  // Create lead
  const sourceMap: Record<Platform, string> = {
    whatsapp: "whatsapp_ai",
    instagram: "instagram_ai",
    messenger: "messenger_ai",
  };

  // For Instagram/Messenger, the senderId is a platform user ID, not a phone number
  const isPhoneLike = /^\d{10,15}$/.test(ctx.senderId.replace(/\+/g, ""));
  const phone = isPhoneLike ? ctx.senderId : `${ctx.platform}:${ctx.senderId}`;

  const leadData: any = {
    phone,
    source: sourceMap[ctx.platform],
    branch_id: ctx.branchId,
    status: "new",
    temperature: "warm",
    score: 50,
    full_name: parsedLeadData.name || parsedLeadData.full_name || ctx.contactName || `${ctx.platform} Lead`,
    email: parsedLeadData.email || null,
    goals: parsedLeadData.goal || parsedLeadData.fitness_goal || null,
    budget: parsedLeadData.budget || null,
    fitness_goal: parsedLeadData.fitness_goal || parsedLeadData.goal || null,
    expected_start_date: parsedLeadData.expected_start_date || parsedLeadData.start_date || null,
    fitness_experience: parsedLeadData.fitness_experience || parsedLeadData.experience || null,
    preferred_time: parsedLeadData.preferred_time || null,
    notes: `AI-captured via ${ctx.platform} conversation. Platform ID: ${ctx.senderId}`,
  };

  // ── Member-first guard ────────────────────────────────────────────────────
  // If this phone now resolves to an active member (e.g. they got registered
  // mid-conversation, or the original variant lookup missed earlier), DO NOT
  // create a lead.
  const variants = phoneVariants(ctx.senderId);
  if (variants.length > 0) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();
    if (prof?.id) {
      const { data: existingMember } = await supabase
        .from("members")
        .select("id")
        .eq("user_id", prof.id)
        .limit(1)
        .maybeSingle();
      if (existingMember) {
        console.log(`[AI:${ctx.platform}] phone matches existing member, skipping lead capture`);
        return { captured: false, leadId: null, partialData: {} };
      }
    }

    // Also dedupe by phone — if a lead row already exists, MERGE instead of inserting.
    const { data: existingByPhone } = await supabase
      .from("leads")
      .select("id")
      .in("phone", variants)
      .eq("branch_id", ctx.branchId)
      .limit(1)
      .maybeSingle();
    if (existingByPhone) {
      console.log(`[AI:${ctx.platform}] lead already exists by phone, merging instead of inserting`);
      const { full_name, email, goals, fitness_goal, budget, expected_start_date, fitness_experience, preferred_time } = leadData;
      await supabase.from("leads").update({
        full_name, email, goals, fitness_goal, budget,
        expected_start_date, fitness_experience, preferred_time,
        last_contacted_at: new Date().toISOString(),
      }).eq("id", existingByPhone.id);
      await supabase.from("whatsapp_chat_settings").upsert(
        { branch_id: ctx.branchId, phone_number: ctx.senderId, captured_lead_id: existingByPhone.id, bot_active: false, paused_at: new Date().toISOString() },
        { onConflict: "branch_id,phone_number" },
      );
      return { captured: true, leadId: existingByPhone.id, partialData };
    }
  }

  // Dedupe: check if lead with same email exists
  if (parsedLeadData.email) {
    const { data: existingByEmail } = await supabase
      .from("leads")
      .select("id")
      .eq("email", parsedLeadData.email)
      .eq("branch_id", ctx.branchId)
      .limit(1)
      .maybeSingle();
    if (existingByEmail) {
      console.log(`[AI:${ctx.platform}] lead already exists by email, skipping creation`);
      await supabase.from("whatsapp_chat_settings").upsert(
        { branch_id: ctx.branchId, phone_number: ctx.senderId, captured_lead_id: existingByEmail.id, bot_active: false, paused_at: new Date().toISOString() },
        { onConflict: "branch_id,phone_number" },
      );
      return { captured: true, leadId: existingByEmail.id, partialData };
    }
  }

  const { data: newLead, error: leadError } = await supabase
    .from("leads")
    .insert(leadData)
    .select("id")
    .single();

  if (leadError) {
    console.error(`[AI:${ctx.platform}] lead insert failed:`, leadError);
    return { captured: false, leadId: null, partialData };
  }

  // Record capture marker
  await supabase.from("whatsapp_messages").insert({
    branch_id: ctx.branchId,
    phone_number: ctx.senderId,
    contact_name: ctx.contactName,
    content: `[AI_LEAD_CAPTURED:${newLead.id}]`,
    direction: "outbound",
    status: "delivered",
    message_type: "text",
    platform: ctx.platform,
  });

  // Update chat settings
  await supabase.from("whatsapp_chat_settings").upsert(
    { branch_id: ctx.branchId, phone_number: ctx.senderId, captured_lead_id: newLead.id, bot_active: false, paused_at: new Date().toISOString() },
    { onConflict: "branch_id,phone_number" },
  );

  // Notify staff
  try {
    const { data: staffRoles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["owner", "admin", "manager"]);
    const seen = new Set<string>();
    const notifications = (staffRoles || [])
      .filter((r: any) => r.user_id && !seen.has(r.user_id) && seen.add(r.user_id))
      .map((r: any) => ({
        user_id: r.user_id,
        branch_id: ctx.branchId,
        title: `New ${ctx.platform === "instagram" ? "Instagram" : ctx.platform === "messenger" ? "Messenger" : "WhatsApp"} Lead`,
        message: `${leadData.full_name} was captured via ${ctx.platform} AI.`,
        type: "info",
        category: "lead",
        action_url: "/leads",
        metadata: { lead_id: newLead.id, source: sourceMap[ctx.platform] },
        is_read: false,
      }));
    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }
  } catch (e) {
    console.error(`[AI:${ctx.platform}] notification insert failed:`, e);
  }

  // Dispatch outbound notification
  try {
    fetch(`${supabaseUrl}/functions/v1/notify-lead-created`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ lead_id: newLead.id, branch_id: ctx.branchId }),
    }).catch((e: any) => console.error("Lead notification dispatch failed:", e));
  } catch { /* fire-and-forget */ }

  console.log(`[AI:${ctx.platform}] lead captured: ${newLead.id}`);
  return { captured: true, leadId: newLead.id, partialData };
}
// ─── Context auto-learning extractor ───────────────────────────────────────────
// v1.0.0 — silent per-turn LLM pass that pulls structured facts from the user's
// own words and feeds them into ai_memory. Lets the bot stop re-asking known
// info and respect explicit pushback ("first listen", "stop asking", etc.).
//
// Deterministic pre-checks fire BEFORE the LLM so we never push contact asks
// after the user told us to listen — even if the extractor stalls/fails.

const LISTENING_RE = /^\s*(first|please|wait|hold on|listen|sun(?:o|iye)|ruk|abhi nahi|pehle|let me|just|don'?t (?:ask|push))/i;
const DECLINE_PHONE_RE = /\b(no|not|don'?t|nahi|mat|won'?t)\b[^.?!]{0,40}\b(phone|number|call|callback|share|whatsapp)\b/i;
const GOAL_HINTS: Record<string, RegExp> = {
  weight_loss: /\b(weight\s*loss|fat\s*loss|lose\s*weight|slim|weight\s*reduce|leaner)\b/i,
  muscle_gain: /\b(muscle|bulk|mass\s*gain|build\s*strength|hypertrophy)\b/i,
  endurance:   /\b(stamina|endurance|cardio|running|marathon)\b/i,
  flexibility: /\b(flexibility|mobility|yoga\s*for|stretch)\b/i,
  general:     /\b(general\s*fitness|stay\s*fit|overall\s*health|toning)\b/i,
};
// v1.1.0 — plan_interest deterministic capture from interactive list_reply titles.
// Matches the EXACT row titles emitted by the brain (lines ~324-329).
const PLAN_HINTS: Record<string, RegExp> = {
  Monthly:       /\bmonthly\b/i,
  Quarterly:     /\bquarterly\b/i,
  "Half-Yearly": /\bhalf[\s-]?year(?:ly)?\b/i,
  Annual:        /\b(annual|yearly|12\s*month)\b/i,
};
// Normalize LLM-generated do_not_ask synonyms to canonical keys so downstream
// gates can reason about them consistently.
const DNA_ALIASES: Record<string, string> = {
  "membership duration": "plan_interest",
  "duration": "plan_interest",
  "plan": "plan_interest",
  "membership": "plan_interest",
  "fitness goal": "goal",
  "fitness_goal": "goal",
  "phone number": "phone",
  "mobile": "phone",
  "mobile number": "phone",
  "email address": "email",
  "full name": "name",
  "name": "name",
};
function canonicalizeDNA(keys: string[]): string[] {
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw || "").trim().toLowerCase();
    if (!k) continue;
    out.push(DNA_ALIASES[k] || k);
  }
  return Array.from(new Set(out));
}

interface ContextDelta {
  profile?: Record<string, any>;
  facts?: Record<string, any>;
  current_intent?: string | null;
  do_not_ask_add?: string[];
  summary?: string | null;
}

async function extractContextDelta(
  supabase: any,
  ctx: AgentContext,
  history: Array<{ role: string; content: string }>,
  memory: any,
): Promise<ContextDelta> {
  const delta: ContextDelta = { profile: {}, facts: {}, do_not_ask_add: [] };
  const lastUser = (ctx.messageContent || "").trim();

  // ── Deterministic signals (always run; cheap and reliable) ─────────────────
  // Phone is auto-known on WhatsApp — never re-ask.
  if (ctx.platform === "whatsapp") delta.do_not_ask_add!.push("phone");

  if (LISTENING_RE.test(lastUser) || DECLINE_PHONE_RE.test(lastUser)) {
    delta.facts!.consent = { ...(memory?.facts?.consent || {}), push_contact_ask: "declined" };
    delta.do_not_ask_add!.push("phone", "email", "callback");
  }

  // v4.2.0 — Deterministic inbound EMAIL capture. The previous flow only
  // extracted email from the bot's reply text (never the user's inbound),
  // so chats like "Ankit3093@gmail.com" stayed unrecorded and the brain
  // re-asked the same email question on every turn. Capture here so memory
  // is updated even when the LLM enrichment call below fails or returns nothing.
  if (!memory?.profile?.email) {
    const emailMatch = lastUser.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (emailMatch) {
      delta.profile!.email = emailMatch[0].trim();
      delta.do_not_ask_add!.push("email");
    }
  }

  // v4.2.0 — Deterministic inbound FIRST-NAME capture when the prior bot turn
  // explicitly asked for the user's name and the user replied with a short
  // alpha-only message (1–3 tokens). Mirrors the same conservative gate the
  // LLM enrichment uses, so we don't promote "ok" or "hey" to a name.
  if (!memory?.profile?.first_name && !memory?.profile?.full_name) {
    const lastBot = [...history].reverse().find((m) => m.role !== "user")?.content || "";
    const prevWasNamePrompt = /may I have your name|what's your name|what is your name|your name to get started/i.test(lastBot);
    if (prevWasNamePrompt) {
      // v4.3.0 — Reject obvious non-name replies (questions, handoff requests,
      // declines) before they get stored as first_name. "No", "Can I speak to
      // a person?", "haan", etc. must NEVER become a profile name.
      // v4.4.0 — Also reject Hinglish intent questions ("Kha pr h", "kitna").
      const looksLikeQuestion = /\?/.test(lastUser);
      const isHandoffOrDecline = HUMAN_HANDOFF_RE.test(lastUser) || DECLINE_RE.test(lastUser);
      const hinglishIntent = classifyHinglishIntent(lastUser);
      const trimmed = lastUser.replace(/[^\p{L}\s'.-]/gu, "").trim();
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      const candidate = tokens[0] || "";
      const passesShape =
        tokens.length >= 1 && tokens.length <= 3 &&
        /^[\p{L}][\p{L}'.-]{1,}$/u.test(candidate);
      const accepted =
        !looksLikeQuestion && !isHandoffOrDecline && !hinglishIntent &&
        passesShape && looksLikeRealName(candidate, memory?.profile?.phone);

      console.log(
        "[AI Tool Call Attempt] capture_first_name",
        JSON.stringify({
          sender: ctx.senderId,
          platform: ctx.platform,
          raw: lastUser.slice(0, 80),
          candidate,
          intent: hinglishIntent,
          handoff_or_decline: isHandoffOrDecline,
          looks_like_question: looksLikeQuestion,
          accepted,
        })
      );

      if (accepted) {
        delta.profile!.first_name = candidate;
        if (tokens.length > 1) delta.profile!.full_name = tokens.join(" ");
        delta.do_not_ask_add!.push("name");
      }
    }

  }

  for (const [goal, re] of Object.entries(GOAL_HINTS)) {
    if (re.test(lastUser) && !memory?.facts?.fitness_goal) {
      delta.facts!.fitness_goal = goal;
      delta.current_intent = "info_seeking";
      delta.do_not_ask_add!.push("goal");
      break;
    }
  }

  // Plan interest — capture ONLY from explicit tap/short-reply (e.g. interactive
  // list_reply title "Annual") OR a tap-style short message after the duration
  // prompt. Mentions like "Founding memberships" / "annual cost?" must NOT
  // auto-capture. v1.2.0 (2026-06-09) — gate by message length + intent verbs.
  if (!memory?.facts?.plan_interest) {
    const wordCount = lastUser.split(/\s+/).filter(Boolean).length;
    const lastBot = [...history].reverse().find((m) => m.role !== "user")?.content || "";
    const prevWasDurationPrompt = /which membership duration|choose duration|duration works best/i.test(lastBot);
    const explicitChoiceRe = /\b(i\s*(?:want|prefer|need|'?ll\s*take|am\s*interested\s*in)|interested\s*in|go\s*with|take\s*the|sign\s*me\s*up\s*for|opt\s*for)\b/i;
    const isTapStyle = wordCount <= 4 || prevWasDurationPrompt || explicitChoiceRe.test(lastUser);
    if (isTapStyle) {
      for (const [plan, re] of Object.entries(PLAN_HINTS)) {
        if (re.test(lastUser)) {
          delta.facts!.plan_interest = plan;
          delta.facts!.plan_interest_confirmed = true;
          delta.do_not_ask_add!.push("plan_interest");
          break;
        }
      }
    }
  } else if (memory?.facts?.plan_interest_confirmed) {
    // Already known AND user-confirmed — keep in do_not_ask.
    delta.do_not_ask_add!.push("plan_interest");
  }

  // ── LLM enrichment (best-effort; failure is silent) ────────────────────────
  try {
    const transcript = history.slice(-6).map((m) =>
      `${m.role === "user" ? "User" : "Bot"}: ${String(m.content || "").slice(0, 400)}`
    ).join("\n");
    const sys = `You extract structured CRM facts from a gym chat. Return ONLY compact JSON, no prose.
Schema:
{"profile":{"first_name"?:string,"language"?:string,"city"?:string},
 "facts":{"fitness_goal"?:"weight_loss"|"muscle_gain"|"endurance"|"flexibility"|"general","plan_interest"?:string,"experience"?:string,"preferred_time"?:string,"budget_band"?:string},
 "current_intent":"info_seeking"|"pricing"|"booking"|"complaint"|"careers"|"smalltalk"|null,
 "consent":{"push_contact_ask":"allowed"|"declined"|"unknown","wants_human":boolean},
 "do_not_ask_add":string[],
 "summary":string}
Only include keys you are confident about. "summary" ≤ 180 chars rolling.`;
    const usr = `Last user message: """${lastUser}"""\n\nRecent transcript:\n${transcript}\n\nCurrent memory facts: ${JSON.stringify(memory?.facts || {})}\nCurrent memory profile: ${JSON.stringify(memory?.profile || {})}`;

    const r = await callAI({
      scope: "whatsapp_ai",
      supabase,
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      response_format: { type: "json_object" },
      max_tokens: 400,
      timeoutMs: 15_000,
    });
    const raw = r.content?.trim() || "";
    const jsonStr = raw.startsWith("{") ? raw : raw.match(/\{[\s\S]*\}/)?.[0];
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      // v1.2.0 — STRIP fields the LLM must never set on its own. Contact info
      // (phone) comes from auth/webhook. Email is OK to set ONLY when memory
      // doesn't already have one (deterministic regex above is preferred).
      // plan_interest must come from an explicit tap/short-reply.
      if (parsed.profile && typeof parsed.profile === "object") {
        delete parsed.profile.phone;
        if (memory?.profile?.email) delete parsed.profile.email;
        // v4.3.0 — Validate name fields before merging; the LLM sometimes
        // echoes "No"/"Yes" from the user as first_name.
        // v4.4.0 — Also reject when last inbound was a Hinglish intent question.
        const phoneForGuard = memory?.profile?.phone;
        const hinglishIntentForGuard = classifyHinglishIntent(lastUser);
        if (parsed.profile.first_name && (hinglishIntentForGuard || !looksLikeRealName(parsed.profile.first_name, phoneForGuard))) {
          console.log("[AI Tool Call Attempt] capture_first_name", JSON.stringify({
            sender: ctx.senderId, platform: ctx.platform, source: "llm_enrichment",
            candidate: String(parsed.profile.first_name).slice(0, 40),
            intent: hinglishIntentForGuard, accepted: false,
          }));
          delete parsed.profile.first_name;
        }
        if (parsed.profile.full_name && (hinglishIntentForGuard || !looksLikeRealName(parsed.profile.full_name, phoneForGuard))) {
          delete parsed.profile.full_name;
        }

        Object.assign(delta.profile!, parsed.profile);
      }
      if (parsed.facts && typeof parsed.facts === "object") {
        delete parsed.facts.plan_interest;
        delete parsed.facts.plan_interest_confirmed;
        Object.assign(delta.facts!, parsed.facts);
      }
      if (parsed.consent && typeof parsed.consent === "object") {
        delta.facts!.consent = { ...(memory?.facts?.consent || {}), ...(delta.facts!.consent || {}), ...parsed.consent };
        if (parsed.consent.push_contact_ask === "declined") delta.do_not_ask_add!.push("phone", "email", "callback");
      }
      if (parsed.current_intent) delta.current_intent = String(parsed.current_intent);
      if (Array.isArray(parsed.do_not_ask_add)) delta.do_not_ask_add!.push(...parsed.do_not_ask_add.map((s: any) => String(s)));
      if (typeof parsed.summary === "string" && parsed.summary.length > 0) delta.summary = parsed.summary.slice(0, 220);
    }
    try {
      await supabase.from("ai_call_logs").insert({
        purpose: "context_extract", scope: "whatsapp_ai",
        branch_id: ctx.branchId, provider: r.provider, model: r.model,
        status: "success", duration_ms: 0, fallback_used: r.fallback_used,
        platform: ctx.platform ?? null, contact_key: ctx.senderId ?? null,
      });
    } catch { /* noop */ }
  } catch (e) {
    console.warn(`[AI:${ctx.platform}] context extract failed:`, (e as Error).message);
  }

  // Dedup + canonicalize do_not_ask
  delta.do_not_ask_add = canonicalizeDNA(delta.do_not_ask_add || []);
  return delta;
}

/** Render extra runtime rules into the system prompt based on learned memory. */
function renderRuntimeRules(memory: any, platform: Platform): string {
  const rules: string[] = [];
  const consent = memory?.facts?.consent || {};
  if (consent.push_contact_ask === "declined") {
    rules.push("LISTENING MODE: The user explicitly asked you to listen / declined a contact ask. Your next reply MUST answer their question with zero CTAs, zero interactive lists, zero contact requests. Plain prose only, end without a question mark unless absolutely required for clarification.");
  }
  if (platform === "whatsapp") {
    rules.push("PHONE GATE: Phone number is already known from WhatsApp. NEVER ask 'Could you share your phone number?', 'May I have your number?', or any variant. Only ask if the user explicitly requests a callback.");
  }
  rules.push("ONE-QUESTION RULE: Ask at most ONE question per reply. If you already answered, do not append a follow-up CTA.");
  if (memory?.facts?.fitness_goal) {
    rules.push(`KNOWN GOAL: User's fitness goal is "${memory.facts.fitness_goal}". Do NOT re-ask for goal. Tailor the answer to this goal.`);
  }
  if (memory?.facts?.plan_interest) {
    const plan = String(memory.facts.plan_interest).toLowerCase();
    const isAnnual = /\b(annual|yearly|12[\s-]?month)\b/.test(plan);
    if (isAnnual) {
      rules.push(`KNOWN PLAN_INTEREST: User chose "${memory.facts.plan_interest}" (annual). NEVER re-ask. Confirm warmly and pitch Founding Member (Annual) — "Want our team to lock in your Founding spot?". Never quote prices.`);
    } else {
      rules.push(`KNOWN PLAN_INTEREST: User chose "${memory.facts.plan_interest}" (non-annual). NEVER re-ask, NEVER refuse, NEVER push. Acknowledge softly: "Noted — I've logged your interest in ${memory.facts.plan_interest}. Full plan options will be shared closer to launch. The only active enrollment right now is Founding Member (Annual) with launch perks — happy to share more if you're open." Never quote prices.`);
    }
  }
  if (memory?.profile?.first_name) {
    if (looksLikeRealName(memory.profile.first_name, (memory as any)?.profile?.phone)) {
      rules.push(`KNOWN NAME: Greet/address user as "${memory.profile.first_name}". Do NOT ask their name again.`);
    } else {
      rules.push(`NAME UNVERIFIED: The stored profile name "${memory.profile.first_name}" looks like a placeholder (test/sample/phone/emoji). NEVER greet or address the user by that name. Greet generically ("Hi there!") and ask for their real first name as the first onboarding step.`);
    }
  }
  // Surface the canonical do_not_ask list so the LLM has a definitive blocklist.
  const dna = canonicalizeDNA(memory?.do_not_ask || []);
  if (dna.length > 0) {
    rules.push(`DO_NOT_ASK_LIST: [${dna.join(", ")}] — these fields are already known or refused. Do NOT ask them again in any form (plain text, button, or interactive_list).`);
  }
  return rules.length ? `\n\n[RUNTIME RULES — non-negotiable, override softer instructions below]\n- ${rules.join("\n- ")}` : "";
}

