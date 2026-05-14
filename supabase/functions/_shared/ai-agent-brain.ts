// v2.1.0 — Unified AI Agent Brain
// 2.1.0: Variant-aware phone matching (uses _shared/phone.ts), fixed broken
//        column refs (members.phone_number / profiles.user_id never existed),
//        member-first hard rule in system prompt, and member-first dedupe
//        guard inside lead capture so an existing member never gets re-
//        captured as a lead through IG/FB/Messenger.
// Shared across meta-webhook (Instagram/Messenger) and whatsapp-webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllToolDefinitions } from "./ai-tools.ts";
import { executeSharedToolCall } from "./ai-tool-executor.ts";
import { phoneVariants } from "./phone.ts";

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
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.log(`[AI:${ctx.platform}] LOVABLE_API_KEY missing`);
    return skip("no_api_key");
  }

  // 1. Load org AI config
  const orgConfig = await loadOrgConfig(supabase);
  const aiConfig: OrgAiConfig = (orgConfig?.whatsapp_ai_config as any) || {};
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

  // 4. Optional delay
  const delaySeconds = aiConfig.reply_delay_seconds || 0;
  if (delaySeconds > 0 && delaySeconds <= 30) {
    await new Promise((r) => setTimeout(r, delaySeconds * 1000));
  }

  // 5. Resolve member/lead context
  const memberCtx = await resolveMemberContext(supabase, ctx.senderId, ctx.branchId, ctx.platform);
  const alreadyCaptured = chatSettings?.captured_lead_id ? await loadCapturedSnapshot(supabase, chatSettings.captured_lead_id) : "";
  const summaryBlock = chatSettings?.conversation_summary ? `\n\n[PRIOR CONVERSATION SUMMARY]\n${chatSettings.conversation_summary}\n` : "";

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

  // 7. Hydrate gym facts (plans, facilities, timings)
  const gymFacts = await hydrateGymFacts(supabase, ctx.branchId);

  // 8. Build system prompt
  const gymName = orgConfig?.name || "Incline Fitness";
  const platformLabel = ctx.platform === "instagram" ? "Instagram DM" : ctx.platform === "messenger" ? "Facebook Messenger" : "WhatsApp";
  const customPrompt = aiConfig.system_prompt || `You are a helpful gym assistant for "${gymName}". Answer questions about membership, timings, and facilities. Keep responses short and friendly.`;

  let systemPrompt = `${memberCtx.contextPrompt}${summaryBlock}${alreadyCaptured}\n\n${customPrompt}`;

  // ── HARD RULE #1 — member-first identity ────────────────────────────────────
  if (memberCtx.isMember) {
    systemPrompt += `\n\nABSOLUTE IDENTITY RULE (HIGHEST PRIORITY):
This person is a CONFIRMED ACTIVE MEMBER of the gym. Their identity is already known.
- GREET THEM BY NAME (${memberCtx.memberName}) on your first reply.
- NEVER ask for their name, email, phone, fitness goal, budget, experience, or preferred time. We already have all of this.
- NEVER output the {"status":"lead_captured", ...} JSON. They are NOT a lead.
- If they ask about visiting, politely note that the gym is in pre-opening and share the timeline if known.
- Use the available member tools (membership status, benefits, bookings, PT sessions, invoices) for any account question.
- If you are unsure about an account-specific detail, USE A TOOL — do not guess.`;
  }

  systemPrompt += `\n\nYou are responding on ${platformLabel}. Conversation history may include messages from other channels — treat them as one continuous conversation.
  
  FORMATTING RULES:
  - Use *bold* for emphasis (e.g. *FREE* trial, *7:00 AM*, *₹2,500*).
  - Use bullet points for lists.
  - Keep replies short (1-3 sentences), warm, professional.
  - Use emojis sparingly but effectively (💪, 🔥, ✨).`;

  // Inject gym knowledge so the AI can answer common questions directly
  if (gymFacts) {
    systemPrompt += `\n\n${gymFacts}`;
  }

  // Global behavioral rules
  systemPrompt += `\n\nCRITICAL BEHAVIORAL RULE:
  - When a person asks a factual question (location, timings, fees, facilities, equipment), ALWAYS answer it directly using the GYM KNOWLEDGE above.
  - Do NOT gatekeep answers behind "registration" or "sign up first".
  - After answering their question, you may then naturally transition into collecting their details.
  - Never repeat the same question more than twice. If the user ignores a question, move on.
  - If the user sends short replies like "ok", "hmm", "yes", treat it as acknowledgment and ask a NEW question.
  - For pricing, always mention the plan name, duration, and price. If the gym has a day pass, mention it first for casual inquirers.`;

  // Member tool instructions
  let tools: any[] | undefined;
  if (memberCtx.isMember && memberCtx.memberId) {
    tools = getAllToolDefinitions();
    try {
      const { data: orgRow } = await supabase.from("organization_settings").select("ai_tool_config").limit(1).maybeSingle();
      const cfg = (orgRow?.ai_tool_config as Record<string, boolean>) || {};
      tools = tools.filter((t: any) => cfg[t.function.name] !== false);
      if (tools.length === 0) tools = undefined;
    } catch { /* keep all */ }

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
      goal: "Fitness Goal", budget: "Monthly Budget (in ₹)",
      plan_interest: "Interested Membership Plan Duration (Monthly, Quarterly, Half-Yearly, Annual, or Day Pass)",
      start_date: "When do you plan to start?",
      experience: "Fitness Experience Level",
      preferred_time: "Preferred workout time slot",
    };
    const fieldNames = (leadCaptureConfig!.target_fields || []).map((f: string) => fieldLabels[f] || f).join(", ");
    systemPrompt += `\n\nIMPORTANT LEAD CAPTURE INSTRUCTIONS:
Your secondary goal is to naturally collect: ${fieldNames}.
- Ask for these naturally, one or two at a time.
- INTERACTIVE FORMAT (Meta Cloud API v25.0): for closed questions with 1–3 choices use a button block; for 4–10 choices you MUST use an interactive_list block (Meta hard-caps reply buttons at 3). Never emit "1. … 2. … 3. … 4. …" as plain text when ≥4 options exist.
  Buttons: {"type":"interactive","body":"…","buttons":["A","B","C"]}
  List:    {"type":"interactive_list","body":"…","button":"Select","sections":[{"title":"Choose one","rows":[{"id":"opt_1","title":"…"}, …]}]}
- For "fitness goal" always offer 5 options as a list: Weight Loss, Muscle Gain, Endurance, General Fitness, Flexibility.
- For "plan_interest" always offer the gym's actual plan durations as a list (Monthly, Quarterly, Half-Yearly, Annual, plus Day Pass when available).
- You MUST collect full name + email + at least 1 other field before outputting lead_captured.
- The ${ctx.platform === "whatsapp" ? "phone number" : "platform contact ID"} is already known: ${ctx.senderId}
- When the user provides the LAST required field, respond with ONLY this JSON:
{"status":"lead_captured","data":{${(leadCaptureConfig!.target_fields || []).map((f: string) => `"${f}":"<actual_value>"`).join(",")}}}
- Use the exact field keys: ${(leadCaptureConfig!.target_fields || []).join(", ")}`;
  }

  // 8. Call Lovable AI
  const aiMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const aiRequestBody: any = {
    model: aiConfig.model || "google/gemini-3-flash-preview",
    messages: aiMessages,
  };
  if (tools) {
    aiRequestBody.tools = tools;
    aiRequestBody.tool_choice = "auto";
  }

  let aiResult: any;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody),
    });
    if (!resp.ok) {
      console.error(`[AI:${ctx.platform}] gateway error ${resp.status}`);
      return skip("ai_gateway_error");
    }
    aiResult = await resp.json();
  } catch (e) {
    console.error(`[AI:${ctx.platform}] fetch failed:`, e);
    return skip("ai_fetch_error");
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
      const followup = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiConfig.model || "google/gemini-3-flash-preview",
          messages: [...aiMessages, choice.message, ...toolMessages],
        }),
      });
      const followupData = await followup.json();
      replyText = followupData?.choices?.[0]?.message?.content || replyText;
    } catch (e) {
      console.error(`[AI:${ctx.platform}] tool follow-up failed:`, e);
    }
  }

  if (!replyText) return skip("no_reply_text");

  // 10. Lead capture parsing
  if (shouldCaptureLead) {
    const leadResult = await tryParseAndCaptureLead(
      supabase, replyText, ctx, leadCaptureConfig!, supabaseUrl, serviceKey,
    );
    if (leadResult.captured) {
      // Send handoff message instead of AI's JSON
      const handoffMsg = leadCaptureConfig!.handoff_message || "Thanks for sharing! Our team will reach out to you shortly. 💪";
      return { replyText: handoffMsg, leadCaptured: true, leadId: leadResult.leadId, handoffTriggered: false, skipped: false };
    }
    // Store partial data even if not fully captured
    if (leadResult.partialData && Object.keys(leadResult.partialData).length > 0) {
      await supabase.from("whatsapp_chat_settings").upsert(
        { branch_id: ctx.branchId, phone_number: ctx.senderId, partial_lead_data: leadResult.partialData },
        { onConflict: "branch_id,phone_number" },
      );
    }
  }

  return { replyText, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: false };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function skip(reason: string): AgentResult {
  return { replyText: null, leadCaptured: false, leadId: null, handoffTriggered: false, skipped: true, skipReason: reason };
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
  const { data } = await supabase.from("organization_settings").select("whatsapp_ai_config, name, lead_nurture_config, ai_tool_config").limit(1).maybeSingle();
  _orgConfigCache = data;
  _orgConfigTs = Date.now();
  return data;
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
  contextPrompt: string;
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
    if (variants.length > 0) {
      const { data: lead } = await supabase
        .from("leads")
        .select("full_name, status, fitness_goal")
        .in("phone", variants)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lead) {
        leadContext = `[Lead] ${lead.full_name || "Unknown"}, Status: ${lead.status || "-"}, Goal: ${lead.fitness_goal || "-"}`;
      }
    }
    return { isMember: false, contextPrompt: leadContext || "Speaking to a guest/lead." };
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