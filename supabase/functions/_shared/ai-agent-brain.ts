// v3.7.0 — Non-fitness guard now dedupes + pauses nurture (DNC + bot_active)
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
import { phoneVariants } from "./phone.ts";
import { callAI } from "./ai-dispatcher.ts";
import {
  loadMemory,
  upsertMemory,
  renderMemoryBlock,
} from "./ai-memory.ts";
import { buildSystemPrompt } from "./ai-prompt.ts";

// ─── Placeholder-name guard ────────────────────────────────────────────────────
// Reject WhatsApp/IG profile names that aren't real human names so the brain
// doesn't greet anyone as "Sample", "Test", a phone number, or emoji-only handle.
const FAKE_NAME_TOKENS = new Set([
  "sample", "test", "testing", "tester", "user", "demo", "customer",
  "unknown", "na", "none", "null", "n/a", "admin", "guest", "anon",
  "anonymous", "default", "client", "whatsapp", "instagram",
]);
export function looksLikeRealName(name: unknown, phone?: string | null): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  // Pure digits / phone-like
  if (/^\+?\d[\d\s().-]{4,}$/.test(trimmed)) return false;
  // Equals the sender phone
  if (phone && trimmed.replace(/\D/g, "") === phone.replace(/\D/g, "") && trimmed.replace(/\D/g, "").length > 4) return false;
  // Blocklist (case-insensitive, ignoring punctuation)
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9/]/g, "");
  if (FAKE_NAME_TOKENS.has(normalized)) return false;
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

  // 2. Check bot_active
  const { data: chatSettings } = await supabase
    .from("whatsapp_chat_settings")
    .select("bot_active, captured_lead_id, conversation_summary")
    .eq("branch_id", ctx.branchId)
    .eq("phone_number", ctx.senderId)
    .maybeSingle();
  if (chatSettings?.bot_active === false) {
    return skip("bot_paused");
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
  //     all platforms). Short-circuits BEFORE the LLM so a prose+JSON leak is
  //     impossible. Toggle via ai_purposes.guards.non_fitness_redirect.
  const nonFitnessGuardOn = (purposeRow?.guards?.non_fitness_redirect ?? true) === true;
  const NON_FITNESS_RE =
    /\b(job|jobs|vacancy|vacancies|hir(?:e|ing)|career|careers|cv|resume|biodata|bio[-\s]?data|interview\s+for|i(?:'?m)?\s+(?:looking\s+(?:for|out)\s+)?(?:a\s+)?(?:job|work|position|role|vacancy)|work(?:ing)?\s+(?:at|with|in)\s+(?:your|incline)|sales\s+(?:job|department|position)|trainer\s+(?:job|position|vacancy)|front\s*desk\s+(?:job|position)|vendor|supplier|wholesale|b2b|press|media|influencer|sponsor(?:ship)?|collaborat(?:e|ion)|partnership|franchise|tie[-\s]?up)\b/i;
  if (nonFitnessGuardOn && NON_FITNESS_RE.test(ctx.messageContent || "")) {
    const REDIRECT = (purposeRow?.guards?.non_fitness_message as string) ||
      "Thanks for reaching out! For careers, partnerships, vendor, media, or other non-membership inquiries please email *info@theinclinelife.com* or call our front desk. This channel is for membership and fitness queries only. 🙏";
    return { replyText: REDIRECT, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
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
  const gymName = orgConfig?.name || "Incline Fitness";
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
  const shouldCaptureLead = !memberCtx.isMember && leadCaptureConfig?.enabled && (leadCaptureConfig.target_fields?.length ?? 0) > 0;
  if (shouldCaptureLead) {
    const fieldLabels: Record<string, string> = {
      name: "Full Name", phone: "Phone Number", email: "Email Address",
      goal: "Fitness Goal (Weight Loss / Muscle Gain / Endurance / Flexibility / General Fitness)",
      start_date: "When do you plan to start?",
      experience: "Fitness Experience Level",
      preferred_time: "Preferred workout time slot",
    };
    // PRE-OPENING / FOUNDER'S PHASE (v3.5.0) — capture name → email → goal →
    // plan_interest (duration). Founding Member (Annual) is the only ACTIVE
    // offer, but we still capture monthly/quarterly/half-yearly interest so
    // sales can nurture them. Never quote prices.
    const targetFields = leadCaptureConfig!.target_fields || [];
    const fieldNames = targetFields.map((f: string) => fieldLabels[f] || f).join(", ");
    systemPrompt += `\n\nIMPORTANT LEAD CAPTURE INSTRUCTIONS (FOUNDER'S PHASE — PRE-OPENING):
${gymName} opens July 2026 (11,000 sq ft, Sector 14 Udaipur). The ONLY active offer right now is the **Founding Member (Annual)** invite. No ₹ amounts, fees, PT package names, trainer names, or class schedules have been published — never quote any of those.

Your secondary goal is to naturally collect: ${fieldNames}.

ONBOARDING ORDER (STRICT — DO NOT SKIP STEPS, DO NOT REORDER):
- Turn 1 (first inbound): Plain-text greeting in ONE short sentence as ${gymName}'s assistant, ask for their NAME. No JSON, no list, no buttons.
- Turn 2 (after name): Thank them by first name in one short line, ask for EMAIL "for your Founding Member invite". Plain text only. (Phone is already known from WhatsApp — never ask again.)
- Turn 3 (after email): Ask their FITNESS GOAL as a Meta interactive_list with EXACTLY these 4 rows: {id:"weight_loss",title:"Weight Loss"}, {id:"muscle_gain",title:"Muscle Gain"}, {id:"endurance",title:"Endurance"}, {id:"general",title:"Flexibility / General"}. Body: "What's your main fitness goal, {{first_name}}?". Button: "Choose goal".
- Turn 4 (after goal): Ask plan-duration interest as a Meta interactive_list with EXACTLY these 4 rows: {id:"monthly",title:"Monthly"}, {id:"quarterly",title:"Quarterly"}, {id:"half_yearly",title:"Half-Yearly"}, {id:"annual",title:"Annual — Founding Member"}. Body: "Which membership duration are you thinking about?". Button: "Choose duration". Capture whatever they tap.
- Turn 5 (after plan_interest captured):
    • If their answer maps to **annual / yearly / 12-month** → confirm warmly and pitch Founding Member: "Perfect — Founding Member (Annual) is our only active enrollment right now with launch-day perks. Want our team to lock in your Founding spot?"
    • If their answer is **monthly / quarterly / half-yearly** → acknowledge softly, capture as lead, do NOT push: "Noted — I've logged your interest in {duration}. Our team will share full plan options closer to launch. The only active enrollment right now is Founding Member (Annual) with launch perks — happy to share more if you're open." NEVER refuse or hard-redirect non-annual leads.
- Then emit the lead_captured JSON.

HARD GATE (non-negotiable): NEVER emit ANY interactive_list or button block until BOTH a real name AND an email are present. AFTER name+email are present, you MUST use interactive_list for goal (Turn 3) and plan_interest (Turn 4) — do NOT ask either of those as plain text.

PRICING VELVET ROPE (non-negotiable): NEVER mention ₹ amounts, Rs., fees, prices, cost, charges, PT package names, session counts, or "send the price/fee details". You MAY use the words "monthly / quarterly / half-yearly / annual / yearly / Founding Member / plan / goal" — those are required for capture and nurture. If the user directly asks for prices: "Our Founding Member pricing is reserved for our launch reveal — our team will share full details closer to opening. Can I lock in your Founding spot in the meantime?"

EMAIL ASK WORDING:
- "Thanks, <FirstName> — what's the best email for your Founding Member invite? ✨"
- "Could you share your email so our team can send your pre-launch walkthrough details?"

REPLY STYLE RULES:
- ONE short sentence (under 25 words), one question max, at most 1 emoji.
- Acknowledge in ≤4 words ("Sure!" / "Got it —" / "Perfect —") then ask the ONE missing field.
- Never restate or echo the user's request back.
- Never promise to share prices, fees, or PT package details.









NON-FITNESS INTENTS — DO NOT CAPTURE AS LEAD, DO NOT ASK FITNESS-GOAL/PLAN/BRANCH:
If the message is clearly about any of the following, you MUST NOT call the lead capture flow and MUST NOT ask the onboarding questions:
  • Job application / careers / hiring / CV / resume / "looking for a job" / "vacancy"
  • Vendor / supplier / wholesale / B2B inquiry
  • Press / media / interview / collaboration / influencer / sponsorship
  • Partnership / corporate tie-up
  • Complaint about an existing member's experience that needs human follow-up
  • Wrong number / spam / unrelated greeting with zero fitness intent
For any of these, reply with this single short message (plain text only, no JSON, no list, no buttons):
  "Thanks for reaching out! For careers, partnerships, vendor, media, or other non-membership inquiries please email *info@theinclinelife.com* or call our front desk. This channel is for membership and fitness queries only. 🙏"
Then stop — do NOT continue onboarding and do NOT output the lead_captured JSON.

- INTERACTIVE FORMAT (Meta Cloud API v25.0): only used AFTER name+email captured. Buttons cap at 3; lists for 4–10 rows. Never emit "1. … 2. …" plain text when ≥4 options exist.
- Goal (Turn 3) and plan_interest (Turn 4) MUST be emitted as interactive_list with the exact rows defined above. No free-text fallback.
- DO NOT emit any PT-package / personal-training / day-pass interactive list at any time.
- NEVER mention ₹/Rs./prices/fees/Day Pass/PT package names/trainer names.
- You MUST collect full name + email + goal + plan_interest before outputting lead_captured.
- The ${ctx.platform === "whatsapp" ? "phone number" : "platform contact ID"} is already known: ${ctx.senderId}
- When you have name + email + goal + plan_interest, respond with ONLY this JSON:
{"status":"lead_captured","data":{${targetFields.map((f: string) => `"${f}":"<actual_value>"`).join(",")}}}
- Use the exact field keys: ${targetFields.join(", ")}
- For plan_interest, normalize to one of: monthly | quarterly | half_yearly | annual.`;

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
      const result = await executeSharedToolCall(
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
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
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

  if (!replyText) return skip("no_reply_text");

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
      ? `You're on the Founding Member list, ${firstName} — our team will reach out for your pre-launch walkthrough. ✨`
      : "You're on the Founding Member list — our team will reach out for your pre-launch walkthrough. ✨";
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

// ─── Founder's Phase plain-text sanitizer (v3.5.0) ─────────────────────────
// We DO allow the words monthly/quarterly/half-yearly/annual/Founding/plan/goal
// because we now capture plan_interest as free text. We block only price
// mentions, fee mentions, PT package names, and "send the details" promises.
const FORBIDDEN_PLAN_TEXT_RE =
  /\b(pt\s+package|personal\s+training\s+package|session\s+pack|day\s*pass)\b/i;
const FORBIDDEN_PRICE_TEXT_RE = /(₹|\bRs\.?\b|\/-|\bINR\b|\brupees?\b|\bprice\b|\bfees?\b|\bcost\b|\bcharges?\b|\bamount\b)/i;
const SEND_DETAILS_RE = /\bsend\s+(?:you\s+)?the\s+(?:price|fee|cost|charges?)\s*(?:details|info)?/i;

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

  const hasForbiddenPlan = FORBIDDEN_PLAN_TEXT_RE.test(text);
  const hasForbiddenPrice = FORBIDDEN_PRICE_TEXT_RE.test(text);
  const hasSendDetails = SEND_DETAILS_RE.test(text);

  if (!hasForbiddenPlan && !hasForbiddenPrice && !hasSendDetails) return replyText;

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
    ? `You're on the Founding Member list, ${firstName} — our team will reach out for your pre-launch walkthrough closer to opening. ✨`
    : "You're on the Founding Member list — our team will reach out for your pre-launch walkthrough. ✨";
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
      parts.push(`Location: ${b.name || "Incline Fitness"}, ${b.address || ""}, ${b.city || "Udaipur"}. Phone: ${b.phone || "N/A"}.`);
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
  membershipId?: string;
  planId?: string;
  planName?: string;
  planEndsAt?: string;
  contextPrompt: string;
  // Set only when isMember=false and a lead row exists for this sender.
  leadId?: string;
  leadName?: string;
  leadStage?: string;
}

async function resolveMemberContext(supabase: any, senderId: string, branchId: string, platform: Platform): Promise<MemberResolveResult> {
  // For WhatsApp: senderId is a phone number — use full variant set so we
  // catch bare 10-digit, +91-prefixed, and 91-prefixed forms equally.
  // For IG/Messenger: senderId is a platform user ID — phone match will
  // simply not hit, which is correct.
  const variants = phoneVariants(senderId);

  let memberMatch: any = null;

  // Resolve member via profiles.phone → members.user_id
  if (variants.length > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();
    if (profile?.id) {
      const { data: member } = await supabase
        .from("members")
        .select("id, branch_id, member_code, profiles!inner(full_name)")
        .eq("user_id", profile.id)
        .limit(1)
        .maybeSingle();
      if (member) memberMatch = member;
    }
  }

  if (!memberMatch) {
    // Check existing lead for context (variant-aware)
    let leadContext = "";
    let leadId: string | undefined;
    let leadName: string | undefined;
    let leadStage: string | undefined;
    if (variants.length > 0) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, full_name, status, fitness_goal")
        .in("phone", variants)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lead) {
        leadId = (lead as any).id;
        leadName = (lead as any).full_name || undefined;
        leadStage = (lead as any).status || undefined;
        leadContext = `[Lead] ${lead.full_name || "Unknown"}, Status: ${lead.status || "-"}, Goal: ${lead.fitness_goal || "-"}`;
      }
    }
    return {
      isMember: false,
      contextPrompt: leadContext || "Speaking to a guest/lead.",
      leadId,
      leadName,
      leadStage,
    };
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

  for (const [goal, re] of Object.entries(GOAL_HINTS)) {
    if (re.test(lastUser) && !memory?.facts?.fitness_goal) {
      delta.facts!.fitness_goal = goal;
      delta.current_intent = "info_seeking";
      delta.do_not_ask_add!.push("goal");
      break;
    }
  }

  // Plan interest — capture from interactive list_reply titles (e.g. "🏆 Annual").
  // Only fires when prior bot turn was the duration prompt OR memory lacks it.
  if (!memory?.facts?.plan_interest) {
    for (const [plan, re] of Object.entries(PLAN_HINTS)) {
      if (re.test(lastUser)) {
        delta.facts!.plan_interest = plan;
        delta.do_not_ask_add!.push("plan_interest");
        break;
      }
    }
  } else {
    // Already known — make sure it stays in do_not_ask going forward.
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
      if (parsed.profile && typeof parsed.profile === "object") Object.assign(delta.profile!, parsed.profile);
      if (parsed.facts && typeof parsed.facts === "object") Object.assign(delta.facts!, parsed.facts);
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

