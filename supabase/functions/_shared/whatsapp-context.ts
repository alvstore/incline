// whatsapp-context.ts — v1.0.0
//
// Conversation Context & Message Provenance resolver.
//
// ONE WhatsApp number serves leads, members, campaigns, reminders, transactional
// messages, AI and humans. Before the unified AI brain is invoked for an inbound
// message we must know *why* the person is writing. This module resolves that,
// server-side, with Meta's `message.context.id` as the PRIMARY correlation signal.
//
// Correlation ladder (strongest first):
//   1. meta_context_id     — inbound.reply_to_message_id === outbound.whatsapp_message_id
//   2. stored_relationship — provenance columns on that outbound row (campaign / log)
//   3. thread_context      — unexpired context already stored on the thread
//   4. recent_outbound     — most recent non-AI outbound in window, only when unambiguous
//
// Never: text similarity, keyword matching against campaign copy, or "latest campaign".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ContactType = "member" | "lead" | "staff" | "unknown";

export type ConversationContext =
  | "human"
  | "campaign_reply"
  | "transactional"
  | "member_support"
  | "lead"
  | "unknown";

export type SourceType =
  | "campaign"
  | "ai"
  | "human"
  | "automation"
  | "transactional"
  | "system"
  | "inbound";

export type CorrelationMethod =
  | "meta_context_id"
  | "stored_relationship"
  | "thread_context"
  | "recent_outbound"
  | "none";

export type CorrelationConfidence = "exact" | "high" | "low" | "none";

export interface ResolvedWhatsAppContext {
  contactType: ContactType;
  memberId: string | null;
  leadId: string | null;
  contactName: string | null;

  conversationContext: ConversationContext;
  sourceType: SourceType | null;

  campaignId: string | null;
  campaignName: string | null;
  campaignType: string | null;
  campaignRecipientId: string | null;
  communicationLogId: string | null;

  originalMessageId: string | null;        // provider (wamid) id of the correlated outbound
  originalOutboundMessage: string | null;  // its rendered body
  eventMeta: Record<string, unknown> | null;

  correlationMethod: CorrelationMethod;
  correlationConfidence: CorrelationConfidence;

  shouldInvokeAI: boolean;
  noReplyReason: string | null;
  /** Deterministic hint only — the AI makes the final no-reply call. */
  noReplyCandidate: boolean;

  contextExpiresAt: string | null;
  /** True when the thread moved off a previously stored context this turn. */
  contextTransitioned: boolean;
}

// ─── Windows ──────────────────────────────────────────────────────────────────
const CAMPAIGN_CONTEXT_HOURS = 24;
const TRANSACTIONAL_CONTEXT_HOURS = 72;
/** Fallback (non-context.id) correlation window. */
const RECENT_OUTBOUND_WINDOW_HOURS = 24;

const TRANSACTIONAL_CATEGORIES = [
  "payment_alert",
  "payment_receipt",
  "membership_reminder",
  "invoice",
  "transactional",
];

/** Unrelated member-support intents that break out of a campaign context. */
const SUPPORT_TRANSITION_RE =
  /\b(freeze|freezing|unfreeze|pause\s+my\s+(membership|plan)|cancel\s+my\s+(membership|plan)|refund|invoice|receipt|payment|due[s]?|outstanding|renew(al)?|upgrade\s+my\s+plan|transfer\s+my\s+membership|locker|complaint|not\s+working|charged)/i;

/** Pure acknowledgement / reaction — no question, no new request. */
const ACK_ONLY_RE =
  /^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\ufe0f\s]|thanks?|thank\s*you|thankyou|ty|tysm|shukriya|dhanyavad|ok(?:ay)?|k|kk|got\s*it|noted|sure|great|nice|good|cool|perfect|awesome|welcome|👍|🙏|❤️|done|yeah|yup|hmm+)*$/iu;

const CONFIRM_RE = /^(?:yes|y|yeah|yep|yup|sure|ok(?:ay)?|haan|han|ha|confirm(?:ed)?|i'?ll\s+come|coming|count\s+me\s+in)[\s.!]*$/i;

// ─── helpers ──────────────────────────────────────────────────────────────────

export function phoneVariants(raw: string): string[] {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return [];
  const last10 = digits.slice(-10);
  const set = new Set<string>([digits, last10, `91${last10}`, `+91${last10}`, `+${digits}`, `0${last10}`]);
  return [...set].filter(Boolean);
}

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function hasQuestion(text: string): boolean {
  const t = String(text || "");
  if (t.includes("?")) return true;
  return /\b(what|when|where|which|how|why|can\s+i|may\s+i|is\s+it|are\s+you|do\s+you|kya|kab|kaha|kaise|kitna|kitne)\b/i.test(t);
}

/** Pure acknowledgement AND no question anywhere in the message. */
export function looksAcknowledgementOnly(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length > 60) return false;
  if (hasQuestion(t)) return false;
  return ACK_ONLY_RE.test(t);
}

export function looksLikeConfirmation(text: string): boolean {
  return CONFIRM_RE.test(String(text || "").trim());
}

// ─── main resolver ────────────────────────────────────────────────────────────

export interface ResolveInput {
  branchId: string;
  phoneNumber: string;
  /** DB id of the inbound whatsapp_messages row. */
  inboundMessageId: string;
  inboundContent: string;
  /** Meta `message.context.id` — the provider id the user replied to. */
  replyToMessageId?: string | null;
  platform?: "whatsapp" | "instagram" | "messenger";
}

export async function resolveConversationContext(
  supabase: SupabaseClient,
  input: ResolveInput,
): Promise<ResolvedWhatsAppContext> {
  const started = Date.now();
  const variants = phoneVariants(input.phoneNumber);

  const ctx: ResolvedWhatsAppContext = {
    contactType: "unknown",
    memberId: null,
    leadId: null,
    contactName: null,
    conversationContext: "unknown",
    sourceType: null,
    campaignId: null,
    campaignName: null,
    campaignType: null,
    campaignRecipientId: null,
    communicationLogId: null,
    originalMessageId: null,
    originalOutboundMessage: null,
    eventMeta: null,
    correlationMethod: "none",
    correlationConfidence: "none",
    shouldInvokeAI: true,
    noReplyReason: null,
    noReplyCandidate: false,
    contextExpiresAt: null,
    contextTransitioned: false,
  };

  // ── STEP 1 — contact identity ──────────────────────────────────────────────
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();
    if (prof?.id) {
      const { data: m } = await supabase
        .from("members")
        .select("id")
        .eq("user_id", prof.id)
        .limit(1)
        .maybeSingle();
      if (m?.id) {
        ctx.contactType = "member";
        ctx.memberId = m.id;
        ctx.contactName = (prof as { full_name?: string }).full_name ?? null;
      }
    }
  } catch { /* non-fatal */ }

  if (ctx.contactType === "unknown") {
    try {
      const { data: emp } = await supabase
        .from("employees")
        .select("id, full_name")
        .in("phone", variants)
        .limit(1)
        .maybeSingle();
      if (emp?.id) {
        ctx.contactType = "staff";
        ctx.contactName = (emp as { full_name?: string }).full_name ?? null;
      }
    } catch { /* non-fatal */ }
  }

  if (ctx.contactType === "unknown") {
    try {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, full_name")
        .in("phone", variants)
        .limit(1)
        .maybeSingle();
      if (lead?.id) {
        ctx.contactType = "lead";
        ctx.leadId = lead.id;
        ctx.contactName = (lead as { full_name?: string }).full_name ?? null;
      }
    } catch { /* non-fatal */ }
  }

  // ── STEP 2 — human handoff / bot pause (highest priority) ──────────────────
  let stored: {
    conversation_context?: string | null;
    context_ref_id?: string | null;
    context_expires_at?: string | null;
    contact_name?: string | null;
  } | null = null;

  try {
    const { data: cs } = await supabase
      .from("whatsapp_chat_settings")
      .select(
        "bot_active, bot_paused_until, founder_handoff_task_id, conversation_context, context_ref_id, context_expires_at, contact_name",
      )
      .eq("branch_id", input.branchId)
      .eq("phone_number", input.phoneNumber)
      .maybeSingle();

    stored = cs ?? null;
    if (!ctx.contactName && cs?.contact_name) ctx.contactName = cs.contact_name;

    const pausedUntilMs = cs?.bot_paused_until ? new Date(cs.bot_paused_until).getTime() : 0;
    const timedPause = pausedUntilMs > Date.now();
    if (cs?.bot_active === false || timedPause) {
      ctx.conversationContext = "human";
      ctx.shouldInvokeAI = false;
      ctx.noReplyReason = timedPause ? "human_handoff_timed" : "human_handoff";
      ctx.correlationMethod = "none";
      logContextResolution(ctx, input, Date.now() - started);
      return ctx;
    }
  } catch { /* non-fatal */ }

  // ── STEP 3 — PRIMARY: Meta message.context.id exact correlation ────────────
  type OutRow = {
    id: string;
    whatsapp_message_id: string | null;
    content: string | null;
    source_type: string | null;
    campaign_id: string | null;
    communication_log_id: string | null;
    media_meta: Record<string, unknown> | null;
    created_at: string;
    direction: string;
  };

  let outbound: OutRow | null = null;

  if (input.replyToMessageId) {
    try {
      const { data } = await supabase
        .from("whatsapp_messages")
        .select(
          "id, whatsapp_message_id, content, source_type, campaign_id, communication_log_id, media_meta, created_at, direction",
        )
        .eq("whatsapp_message_id", input.replyToMessageId)
        .eq("direction", "outbound")
        .limit(1)
        .maybeSingle();
      if (data) {
        outbound = data as OutRow;
        ctx.correlationMethod = "meta_context_id";
        ctx.correlationConfidence = "exact";
      }
    } catch { /* non-fatal */ }
  }

  // ── STEP 4/5 — fallbacks, only when context.id gave nothing ────────────────
  if (!outbound) {
    // 4. Unexpired thread context already stored (a continuing conversation).
    const storedAlive =
      stored?.conversation_context &&
      stored.conversation_context !== "human" &&
      stored.context_expires_at &&
      new Date(stored.context_expires_at).getTime() > Date.now();

    // 5. Most recent non-AI/non-human outbound in the window — only when the
    //    candidate is unambiguous (a single distinct campaign in the window).
    try {
      const { data: rows } = await supabase
        .from("whatsapp_messages")
        .select(
          "id, whatsapp_message_id, content, source_type, campaign_id, communication_log_id, media_meta, created_at, direction",
        )
        .eq("branch_id", input.branchId)
        .eq("phone_number", input.phoneNumber)
        .eq("direction", "outbound")
        .gte("created_at", hoursAgo(RECENT_OUTBOUND_WINDOW_HOURS))
        .order("created_at", { ascending: false })
        .limit(10);

      const candidates = ((rows ?? []) as OutRow[]).filter((r) =>
        ["campaign", "transactional", "automation"].includes(String(r.source_type ?? "")),
      );

      if (candidates.length > 0) {
        const distinctCampaigns = new Set(
          candidates.map((c) => c.campaign_id).filter(Boolean) as string[],
        );
        const top = candidates[0];
        const ambiguous = distinctCampaigns.size > 1;

        if (storedAlive && stored?.context_ref_id) {
          // Prefer the campaign the thread is already anchored to.
          const anchored = candidates.find((c) => c.campaign_id === stored!.context_ref_id);
          if (anchored) {
            outbound = anchored;
            ctx.correlationMethod = "thread_context";
            ctx.correlationConfidence = "high";
          }
        }

        if (!outbound && !ambiguous) {
          outbound = top;
          ctx.correlationMethod = "recent_outbound";
          ctx.correlationConfidence = "low";
        } else if (!outbound && ambiguous) {
          console.log(
            "[WhatsApp Context Resolver] ambiguous fallback — multiple campaigns in window, no context.id",
            JSON.stringify({ branch_id: input.branchId, campaigns: distinctCampaigns.size }),
          );
        }
      }
    } catch { /* non-fatal */ }
  }

  // ── Hydrate provenance from the correlated outbound row ────────────────────
  if (outbound) {
    ctx.sourceType = (outbound.source_type as SourceType | null) ?? null;
    ctx.originalMessageId = outbound.whatsapp_message_id ?? null;
    ctx.originalOutboundMessage = outbound.content ?? null;
    ctx.campaignId = outbound.campaign_id ?? null;
    ctx.communicationLogId =
      outbound.communication_log_id ??
      ((outbound.media_meta?.source_log_id as string | undefined) ?? null);

    // Legacy rows (pre-provenance): derive campaign from the linked log's dedupe key.
    if (!ctx.campaignId && ctx.communicationLogId) {
      try {
        const { data: log } = await supabase
          .from("communication_logs")
          .select("dedupe_key, category")
          .eq("id", ctx.communicationLogId)
          .maybeSingle();
        const key = String(log?.dedupe_key ?? "");
        if (key.startsWith("campaign:")) {
          const maybeId = key.split(":")[1];
          if (/^[0-9a-f-]{36}$/i.test(maybeId)) {
            ctx.campaignId = maybeId;
            ctx.sourceType = ctx.sourceType ?? "campaign";
          }
        }
        if (!ctx.sourceType && log?.category) {
          ctx.sourceType = TRANSACTIONAL_CATEGORIES.includes(String(log.category))
            ? "transactional"
            : "automation";
        }
        if (ctx.correlationMethod === "meta_context_id") ctx.correlationConfidence = "exact";
        else if (ctx.campaignId) ctx.correlationMethod = ctx.correlationMethod === "none"
          ? "stored_relationship"
          : ctx.correlationMethod;
      } catch { /* non-fatal */ }
    }

    // Campaign hydration
    if (ctx.campaignId) {
      try {
        const { data: c } = await supabase
          .from("campaigns")
          .select("id, name, campaign_type, message, event_meta")
          .eq("id", ctx.campaignId)
          .maybeSingle();
        if (c) {
          ctx.campaignName = c.name ?? null;
          ctx.campaignType = c.campaign_type ?? null;
          ctx.eventMeta = (c.event_meta as Record<string, unknown> | null) ?? null;
          if (!ctx.originalOutboundMessage) ctx.originalOutboundMessage = c.message ?? null;
        }
      } catch { /* non-fatal */ }

      // Recipient row is linked through the communication log (flushed in batches
      // after the send, so it may legitimately not exist yet — non-blocking).
      if (ctx.communicationLogId) {
        try {
          const { data: r } = await supabase
            .from("campaign_recipients")
            .select("id")
            .eq("communication_log_id", ctx.communicationLogId)
            .limit(1)
            .maybeSingle();
          ctx.campaignRecipientId = r?.id ?? null;
        } catch { /* non-fatal */ }
      }
      if (!ctx.campaignRecipientId) {
        try {
          const { data: r } = await supabase
            .from("campaign_recipients")
            .select("id")
            .eq("campaign_id", ctx.campaignId)
            .in("phone", variants)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          ctx.campaignRecipientId = r?.id ?? null;
        } catch { /* non-fatal */ }
      }
    }
  }

  // ── STEP 6 — decide the conversation context ───────────────────────────────
  const isCampaign = !!ctx.campaignId && ctx.sourceType === "campaign";
  const isTransactional =
    !isCampaign && (ctx.sourceType === "transactional" || ctx.sourceType === "automation");

  if (isCampaign) {
    ctx.conversationContext = "campaign_reply";
    ctx.contextExpiresAt = hoursFromNow(CAMPAIGN_CONTEXT_HOURS);
  } else if (isTransactional) {
    ctx.conversationContext = "transactional";
    ctx.contextExpiresAt = hoursFromNow(TRANSACTIONAL_CONTEXT_HOURS);
  } else if (ctx.contactType === "member" || ctx.contactType === "staff") {
    ctx.conversationContext = "member_support";
  } else if (ctx.contactType === "lead") {
    ctx.conversationContext = "lead";
  } else {
    ctx.conversationContext = "unknown";
  }

  // ── Context transition — an unrelated support intent breaks the campaign out
  if (
    (ctx.conversationContext === "campaign_reply" || ctx.conversationContext === "transactional") &&
    SUPPORT_TRANSITION_RE.test(input.inboundContent || "")
  ) {
    ctx.contextTransitioned = true;
    ctx.conversationContext = ctx.contactType === "member" || ctx.contactType === "staff"
      ? "member_support"
      : ctx.contactType === "lead"
        ? "lead"
        : "unknown";
    ctx.contextExpiresAt = null;
  } else if (
    stored?.conversation_context &&
    stored.conversation_context !== ctx.conversationContext
  ) {
    ctx.contextTransitioned = true;
  }

  // ── No-reply candidate (advisory only — the AI decides) ────────────────────
  if (looksAcknowledgementOnly(input.inboundContent)) {
    ctx.noReplyCandidate = true;
  }

  logContextResolution(ctx, input, Date.now() - started);
  return ctx;
}

// ─── persistence ──────────────────────────────────────────────────────────────

export async function persistThreadContext(
  supabase: SupabaseClient,
  branchId: string,
  phoneNumber: string,
  ctx: ResolvedWhatsAppContext,
): Promise<void> {
  if (ctx.conversationContext === "human") return; // never overwrite handoff state
  try {
    await supabase
      .from("whatsapp_chat_settings")
      .upsert(
        {
          branch_id: branchId,
          phone_number: phoneNumber,
          conversation_context: ctx.conversationContext,
          context_ref_type: ctx.campaignId ? "campaign" : ctx.communicationLogId ? "communication_log" : null,
          context_ref_id: ctx.campaignId ?? null,
          context_set_at: new Date().toISOString(),
          context_expires_at: ctx.contextExpiresAt,
        },
        { onConflict: "branch_id,phone_number" },
      );
  } catch (e) {
    console.warn("[WhatsApp Context Resolver] persist failed:", (e as Error).message);
  }
}

// ─── prompt block ─────────────────────────────────────────────────────────────

export function renderConversationContextBlock(ctx: ResolvedWhatsAppContext): string {
  const lines: string[] = [];
  lines.push("<CURRENT_CONVERSATION_CONTEXT>");
  lines.push(`CONTACT TYPE: ${ctx.contactType.toUpperCase()}`);
  if (ctx.contactName) lines.push(`CONTACT NAME: ${ctx.contactName}`);
  lines.push(`CONVERSATION CONTEXT: ${ctx.conversationContext.toUpperCase()}`);

  if (ctx.campaignId) {
    lines.push(`CAMPAIGN: ${ctx.campaignName ?? ctx.campaignId}`);
    if (ctx.campaignType) lines.push(`CAMPAIGN TYPE: ${String(ctx.campaignType).toUpperCase()}`);
    if (ctx.eventMeta && Object.keys(ctx.eventMeta).length > 0) {
      lines.push(`CAMPAIGN EVENT DATA: ${JSON.stringify(ctx.eventMeta).slice(0, 600)}`);
    }
  }
  if (ctx.originalOutboundMessage) {
    lines.push(`ORIGINAL OUTBOUND MESSAGE: "${ctx.originalOutboundMessage.replace(/\s+/g, " ").slice(0, 900)}"`);
  }
  lines.push(`CORRELATION: ${ctx.correlationMethod}`);
  lines.push(`CORRELATION CONFIDENCE: ${ctx.correlationConfidence}`);

  lines.push("INSTRUCTIONS:");
  if (ctx.conversationContext === "campaign_reply") {
    lines.push("- The user is replying to the campaign/announcement message quoted above.");
    lines.push("- Interpret their message strictly within that context (e.g. \"YES\" means they are confirming for that class/event).");
    lines.push("- Do NOT treat this as a new lead. Do NOT restart onboarding. Do NOT ask for name, email, goal or plan interest.");
    lines.push("- Answer questions (timings, venue, guests, what to bring) using the campaign details above.");
    lines.push("- If they change the subject to an unrelated request, switch naturally to that topic.");
  } else if (ctx.conversationContext === "transactional") {
    lines.push("- The user is replying to a transactional/automated message (payment, booking, reminder) shown above.");
    lines.push("- Resolve their actual question about that item. Do NOT restart onboarding.");
  } else if (ctx.conversationContext === "member_support") {
    lines.push("- This is an existing member. Answer their request directly using member tools/context.");
    lines.push("- Never ask for name, email, goal or plan interest — they are already on file.");
  }
  if (ctx.contactType === "member" || ctx.contactType === "staff") {
    lines.push("- LEAD FUNNEL IS DISABLED for this contact. Never emit lead_captured JSON.");
  }

  lines.push("REPLY DECISION:");
  lines.push(
    '- If a reply would add no value (a pure acknowledgement, thanks, or emoji reaction with no question or request), respond with EXACTLY this JSON and nothing else: {"action":"no_reply","reason":"acknowledgement_only"}',
  );
  lines.push("- If the message contains ANY question or request, always answer it normally — never use no_reply in that case.");
  if (ctx.noReplyCandidate) {
    lines.push("- Signal: this message looks like a pure acknowledgement. Use no_reply unless you find a genuine question or request in it.");
  }
  lines.push("</CURRENT_CONVERSATION_CONTEXT>");
  return lines.join("\n");
}

// ─── observability ────────────────────────────────────────────────────────────

function logContextResolution(
  ctx: ResolvedWhatsAppContext,
  input: ResolveInput,
  tookMs: number,
): void {
  console.log(
    "[WhatsApp Context Resolver]",
    JSON.stringify({
      branch_id: input.branchId,
      phone_suffix: String(input.phoneNumber || "").slice(-4),
      platform: input.platform ?? "whatsapp",
      contact_type: ctx.contactType,
      conversation_context: ctx.conversationContext,
      source_type: ctx.sourceType,
      campaign_id: ctx.campaignId,
      campaign_recipient_id: ctx.campaignRecipientId,
      communication_log_id: ctx.communicationLogId,
      correlation_method: ctx.correlationMethod,
      correlation_confidence: ctx.correlationConfidence,
      should_invoke_ai: ctx.shouldInvokeAI,
      no_reply_candidate: ctx.noReplyCandidate,
      context_transitioned: ctx.contextTransitioned,
      took_ms: tookMs,
    }),
  );
}

/** Structured AI decision log — no message bodies. */
export function logAiDecision(
  input: { branchId: string; phoneNumber: string; action: string; reason?: string | null; context: ConversationContext },
): void {
  console.log(
    "[WhatsApp AI Decision]",
    JSON.stringify({
      branch_id: input.branchId,
      phone_suffix: String(input.phoneNumber || "").slice(-4),
      action: input.action,
      reason: input.reason ?? null,
      conversation_context: input.context,
    }),
  );
}

/** Parse a structured no-reply decision from the model's raw reply. */
export function parseNoReplyDecision(
  replyText: string | null,
): { noReply: boolean; reason: string | null } {
  const t = String(replyText ?? "").trim();
  if (!t) return { noReply: false, reason: null };
  if (!/"action"\s*:\s*"no_reply"/i.test(t)) return { noReply: false, reason: null };
  // Only honour it when the reply is (essentially) just that JSON object.
  const jsonMatch = t.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { noReply: false, reason: null };
  const outside = t.replace(jsonMatch[0], "").replace(/[`\s]/g, "");
  if (outside.length > 0) return { noReply: false, reason: null };
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { action?: string; reason?: string };
    if (parsed?.action === "no_reply") {
      return { noReply: true, reason: parsed.reason ?? "no_reply" };
    }
  } catch { /* fall through */ }
  return { noReply: false, reason: null };
}
