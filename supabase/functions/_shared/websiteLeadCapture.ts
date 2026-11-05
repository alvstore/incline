// _shared/websiteLeadCapture.ts
// v2.0.0 — Chatbot: email required, interest from active plans/categories, no WhatsApp handoff/consent, visit preference.
// v1.0.0 — Pure, dependency-injected lead capture used by `capture-lead`.
// Serves both the legacy embed form (anti-enumeration response contract kept)
// and the Website Lead Chatbot (returns lead reference for WhatsApp handoff).
// Never sends outbound WhatsApp; website-chatbot captures suppress lead-facing
// welcome messages in notify-lead-created.

import { normalizePhone, phoneVariants, isValidIndianMobile } from "./phone.ts";
import { knowledgeFromRows, webConciergeReply, webTopicReply, WEB_TOPICS, type Knowledge, type WebState, type WebTopic } from "./websiteConcierge.ts";
import { storeTurns, webChatKey } from "./websiteChatStore.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const CHATBOT_SOURCE = "website_chatbot";
export const CHATBOT_GOALS = [
  "Build muscle", "Fat loss", "General fitness", "Personal training", "Recovery & wellness", "Explore membership",
] as const;
export const CHATBOT_TIMEFRAMES: Record<string, string> = {
  ready_now: "Ready to start",
  within_30_days: "Within 30 days",
  exploring: "Just exploring",
};
export const INTEREST_CATEGORIES = [
  "Membership", "Personal training", "Group / class training", "Recovery & wellness", "Club visit",
  "Group classes & Pilates", "Just exploring",
  "Monthly membership", "Quarterly membership", "Half-Yearly membership", "Annual membership",
] as const;
export const CHAT_TOPICS = ["training_floor", "membership", "pt_classes", "recovery", "amenities", "assessment", "location", "hours", "visit", "pricing", "discount", "group_pricing", "unknown"] as const;

const MAX_NAME = 100, MAX_EMAIL = 255, MAX_PHONE = 20, MAX_NOTE = 280;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;
const SUBMISSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG_RE = /^[A-Za-z0-9_-]{1,40}$/;
const GENERIC_MSG = "Thank you! We will contact you soon.";

export function sanitize(v: unknown, max: number): string {
  return String(v ?? "").trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").slice(0, max).trim();
}
const opt = (v: unknown, max: number) => (sanitize(v, max) || null);

export function shortReference(leadId: string): string {
  return `WEB-${leadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Joining timeframe → expected start date (IST calendar date). */
export function expectedStartFor(timeframe: string | null, now = new Date()): string | null {
  if (!timeframe || timeframe === "exploring") return null;
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  if (timeframe === "within_30_days") ist.setUTCDate(ist.getUTCDate() + 30);
  return ist.toISOString().slice(0, 10);
}

export function deriveSource(body: Record<string, unknown>, utmSource: string | null, referrer: string | null): string {
  const explicit = String(body.source ?? "").trim().toLowerCase();
  if (body.intake_type === CHATBOT_SOURCE) return CHATBOT_SOURCE;
  if (explicit && explicit !== "website") return explicit.replace(/[^a-z0-9_-]/g, "").slice(0, 50) || "website";
  const ref = referrer || "";
  const map: Array<[RegExp, string]> = [
    [/linktr\.ee|linktree/i, "linktree"], [/instagram\.com|ig\.me/i, "instagram"],
    [/facebook\.com|fb\.me|fb\.com/i, "facebook"], [/wa\.me|whatsapp\.com|api\.whatsapp/i, "whatsapp"],
    [/youtube\.com|youtu\.be/i, "youtube"], [/google\./i, "google"], [/t\.co|twitter\.com|x\.com/i, "twitter"],
    [/linkedin\.com|lnkd\.in/i, "linkedin"], [/tiktok\.com/i, "tiktok"],
  ];
  for (const [re, s] of map) if (re.test(ref)) return s;
  const utm = (utmSource || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50);
  return utm || explicit || "website";
}

export type CaptureDeps = {
  db: Db;
  /** Fire-and-forget notify-lead-created call. */
  notify: (args: { lead_id: string; branch_id: string; suppress_lead_welcome: boolean }) => void;
  /** Returns false when the caller is over the limit. */
  rateLimit?: (ip: string | null) => Promise<boolean>;
  /** Looser limit for post-capture chat turns. */
  chatRateLimit?: (ip: string | null) => Promise<boolean>;
  now?: Date;
};
export type CaptureMeta = { ip: string | null; userAgent: string | null };
export type CaptureResult = { status: number; body: Record<string, unknown> };

const bad = (error: string, status = 400): CaptureResult => ({ status, body: { error } });

/** Active plan names only — never prices, discounts or fees (pricing blackout). */
export async function activePlanNames(db: Db): Promise<string[]> {
  const { data } = await db.from("membership_plans").select("name, display_order")
    .eq("is_active", true).eq("is_visible_to_members", true).order("display_order", { ascending: true });
  const names = (Array.isArray(data) ? data : []).map((r: { name?: unknown }) => sanitize(r?.name, 60)).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 12);
}

export async function handleCaptureLead(raw: unknown, meta: CaptureMeta, deps: CaptureDeps): Promise<CaptureResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("Invalid request");
  const body = raw as Record<string, unknown>;
  if (body.intake_type === CHATBOT_SOURCE && body.action === "plans") {
    return { status: 200, body: { success: true, plans: await activePlanNames(deps.db), categories: INTEREST_CATEGORIES } };
  }
  if (body.intake_type === CHATBOT_SOURCE && body.action === "visit_preference") {
    if (deps.rateLimit && !(await deps.rateLimit(meta.ip))) return bad("Too many submissions. Please try again in a few minutes.", 429);
    return recordVisitPreference(body, deps);
  }
  if (body.intake_type === CHATBOT_SOURCE && (body.action === "chat" || body.action === "sync_transcript")) {
    const limiter = deps.chatRateLimit ?? deps.rateLimit;
    if (limiter && !(await limiter(meta.ip))) return bad("Too many messages. Please try again in a few minutes.", 429);
    return body.action === "chat" ? handleChatTurn(body, deps) : handleSyncTranscript(body, deps);
  }
  const isChatbot = body.intake_type === CHATBOT_SOURCE;

  // Honeypot: bots fill hidden fields. Pretend success, write nothing.
  if (sanitize(body.company_website ?? body.hp ?? "", 200)) {
    return { status: 200, body: isChatbot ? { success: true, status: "received" } : { success: true, message: GENERIC_MSG } };
  }

  if (deps.rateLimit && !(await deps.rateLimit(meta.ip))) {
    return bad("Too many submissions. Please try again in a few minutes.", 429);
  }

  const fullName = sanitize(body.fullName, MAX_NAME);
  const phoneRaw = String(body.phone ?? "").replace(/[\s\-()]/g, "").slice(0, MAX_PHONE);
  const phone = normalizePhone(phoneRaw) || phoneRaw;
  const email = opt(body.email, MAX_EMAIL)?.toLowerCase() ?? null;

  if (!fullName || fullName.length < 2) return bad("Name is required (min 2 chars)");
  if (isChatbot ? !isValidIndianMobile(phone) : (!phone || phone.length < 10 || !PHONE_RE.test(phone))) {
    return bad(isChatbot ? "Please enter a valid 10-digit Indian mobile number" : "Valid phone number is required");
  }
  if (isChatbot && !email) return bad("Email is required to register your enquiry");
  if (email && !EMAIL_RE.test(email)) return bad(isChatbot ? "Please enter a valid email address" : "Invalid email format");

  // Chatbot-only fields — allow-listed.
  const goal = isChatbot ? opt(body.fitness_goal, 40) : null;
  if (goal && !(CHATBOT_GOALS as readonly string[]).includes(goal)) return bad("Invalid goal");
  const timeframe = isChatbot ? opt(body.joining_timeframe, 20) : null;
  if (timeframe && !(timeframe in CHATBOT_TIMEFRAMES)) return bad("Invalid timeframe");
  const note = isChatbot ? opt(body.notes, MAX_NOTE) : null;
  const planInterest = isChatbot ? opt(body.plan_interest, 60) : null;
  if (isChatbot) {
    if (!planInterest) return bad("Please choose what you're interested in");
    const allowed = (INTEREST_CATEGORIES as readonly string[]).includes(planInterest)
      || (await activePlanNames(deps.db)).includes(planInterest);
    if (!allowed) return bad("Please choose one of the listed options");
  }
  const preferredTime = isChatbot ? opt(body.preferred_time, 40) : null;
  const submissionId = isChatbot && typeof body.submission_id === "string" && SUBMISSION_RE.test(body.submission_id)
    ? body.submission_id : null;

  const utm = {
    utm_source: opt(body.utm_source, 100), utm_medium: opt(body.utm_medium, 100),
    utm_campaign: opt(body.utm_campaign, 100), utm_content: opt(body.utm_content, 100),
    utm_term: opt(body.utm_term, 100), landing_page: opt(body.landing_page, 500), referrer_url: opt(body.referrer_url, 500),
  };
  const source = deriveSource(body, utm.utm_source, utm.referrer_url);
  const consent = (body.consent && typeof body.consent === "object") ? body.consent as Record<string, unknown> : null;

  const db = deps.db;
  const variants = phoneVariants(phone);

  // Existing member → never create a lead.
  const { data: existingMember } = await db.from("profiles").select("id").in("phone", variants).limit(1).maybeSingle();
  const { data: existing } = await db.from("leads")
    .select("id, branch_id, email, fitness_goal, plan_interest, expected_start_date, preferred_time, notes, utm_source, utm_medium, utm_campaign, landing_page, referrer_url")
    .in("phone", variants).order("created_at", { ascending: true }).limit(1).maybeSingle();

  if (!isChatbot) {
    // Legacy embed contract: identical response for every outcome (no enumeration).
    if (existing || existingMember) return { status: 200, body: { success: true, message: GENERIC_MSG } };
  } else if (existingMember && !existing) {
    return { status: 200, body: { success: true, status: "already_member", already_member: true, created: false, existing: false } };
  }

  const activityMeta = {
    submission_id: submissionId, plan_interest: planInterest, fitness_goal: goal, joining_timeframe: timeframe,
    utm_source: utm.utm_source, intake_type: CHATBOT_SOURCE,
  };
  const activitySummary = [
    planInterest && `Interest: ${planInterest}`, goal && `Goal: ${goal}`, timeframe && `Joining: ${CHATBOT_TIMEFRAMES[timeframe]}`,
    utm.utm_source && `UTM: ${utm.utm_source}`,
  ].filter(Boolean).join(" · ");

  if (isChatbot && existing) {
    // Same submission retried → no duplicate activity/consent.
    let replay = false;
    if (submissionId) {
      const { data: prior } = await db.from("lead_activities").select("id").eq("lead_id", existing.id)
        .eq("metadata->>submission_id", submissionId).limit(1).maybeSingle();
      replay = !!prior;
    }
    if (!replay) {
      // Fill only empty fields — never overwrite notes, source, stage, owner or consent.
      const patch: Record<string, unknown> = {};
      const fill = (k: string, v: unknown) => { if (v && !existing[k]) patch[k] = v; };
      fill("email", email); fill("fitness_goal", goal); fill("plan_interest", planInterest);
      fill("expected_start_date", expectedStartFor(timeframe, deps.now)); fill("preferred_time", preferredTime);
      fill("notes", note); fill("utm_source", utm.utm_source); fill("utm_medium", utm.utm_medium);
      fill("utm_campaign", utm.utm_campaign); fill("landing_page", utm.landing_page); fill("referrer_url", utm.referrer_url);
      if (Object.keys(patch).length) await db.from("leads").update(patch).eq("id", existing.id);
      await db.from("lead_activities").insert({
        lead_id: existing.id, branch_id: existing.branch_id, activity_type: "website_chatbot_returned",
        title: "Returned through Website Chatbot", notes: activitySummary, metadata: activityMeta,
      });
    }
    return { status: 200, body: chatbotOk(existing.id, existing.branch_id, false) };
  }

  // Branch: never trust a raw branch_id from the browser — validate slug, else first active.
  let branchId: string | null = null;
  const slug = typeof body.branch_slug === "string" && SLUG_RE.test(body.branch_slug) ? body.branch_slug : null;
  if (slug) {
    const { data } = await db.from("branches").select("id").eq("code", slug).eq("is_active", true).maybeSingle();
    branchId = data?.id ?? null;
  }
  if (!branchId) {
    const { data } = await db.from("branches").select("id").eq("is_active", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
    branchId = data?.id ?? null;
  }
  if (!branchId) return bad("Service temporarily unavailable", 500);

  const { data: lead, error } = await db.from("leads").insert({
    full_name: fullName, phone, email, source, branch_id: branchId, status: "new", temperature: "warm",
    ...utm,
    ...(isChatbot ? {
      fitness_goal: goal, plan_interest: planInterest, expected_start_date: expectedStartFor(timeframe, deps.now),
      preferred_time: preferredTime, notes: note,
    } : {}),
  }).select("id").single();
  if (error || !lead) {
    console.error("[capture-lead] insert failed:", error?.code ?? "unknown");
    return bad("Failed to submit. Please try again.", 500);
  }

  if (isChatbot) {
    await db.from("lead_activities").insert({
      lead_id: lead.id, branch_id: branchId, activity_type: "website_chatbot_lead_saved",
      title: "Enquiry captured from Website Chatbot", notes: activitySummary, metadata: activityMeta,
    });
  } else if (consent?.granted === true) {
    // Legacy embed consent behaviour unchanged.
    try {
      await db.rpc("record_consent", {
        p_subject_type: "lead", p_subject_id: lead.id,
        p_channels: Array.isArray(consent.channels) ? consent.channels : ["sms", "email", "rcs", "whatsapp"],
        p_source: (consent.source as string) || source || "capture_lead",
        p_consent_text: (consent.text as string) || null, p_ip: meta.ip, p_user_agent: meta.userAgent, p_action: "grant",
      });
    } catch { console.error("[capture-lead] record_consent failed (non-fatal)"); }
  }

  try {
    deps.notify({ lead_id: lead.id, branch_id: branchId, suppress_lead_welcome: isChatbot });
  } catch { console.error("[capture-lead] notify setup failed"); }

  return isChatbot
    ? { status: 200, body: chatbotOk(lead.id, branchId, true) }
    : { status: 200, body: { success: true, message: GENERIC_MSG } };
}

function chatbotOk(leadId: string, branchId: string, created: boolean) {
  return {
    success: true, status: created ? "created" : "existing", lead_id: leadId, branch_id: branchId,
    created, existing: !created, already_member: false, reference: shortReference(leadId),
  };
}

/** Appends a visit preference + chat topics to a lead the same browser just created/updated.
 *  Requires the lead_id AND the original submission_id (proof of the capture). No appointment is booked. */
async function recordVisitPreference(body: Record<string, unknown>, deps: CaptureDeps): Promise<CaptureResult> {
  const db = deps.db;
  const leadId = typeof body.lead_id === "string" && /^[0-9a-f-]{36}$/i.test(body.lead_id) ? body.lead_id : null;
  const sid = typeof body.submission_id === "string" && SUBMISSION_RE.test(body.submission_id) ? body.submission_id : null;
  const visit = opt(body.visit_preference, 120);
  const topics = Array.isArray(body.topics)
    ? Array.from(new Set(body.topics.filter((t): t is string => typeof t === "string" && (CHAT_TOPICS as readonly string[]).includes(t)))).slice(0, 10)
    : [];
  if (!leadId || !sid || !visit) return bad("Invalid request");
  const { data: proof } = await db.from("lead_activities").select("id, branch_id").eq("lead_id", leadId)
    .eq("metadata->>submission_id", sid).limit(1).maybeSingle();
  if (!proof) return bad("Enquiry not found", 404);
  const { data: lead } = await db.from("leads").select("id, preferred_time").eq("id", leadId).maybeSingle();
  if (lead && !lead.preferred_time) await db.from("leads").update({ preferred_time: visit.slice(0, 40) }).eq("id", leadId);
  await db.from("lead_activities").insert({
    lead_id: leadId, branch_id: proof.branch_id, activity_type: "website_chatbot_visit_request",
    title: "Visit preference from Website Chatbot (team to confirm)",
    notes: `Preferred visit: ${visit}${topics.length ? ` · Asked about: ${topics.join(", ")}` : ""}`,
    metadata: { submission_id: `${sid}:visit`, visit_preference: visit, topics, intake_type: CHATBOT_SOURCE },
  });
  return { status: 200, body: { success: true, status: "visit_noted" } };
}

/** Proof that this browser captured the lead: lead_id + original submission_id. */
async function chatProof(body: Record<string, unknown>, db: Db) {
  const leadId = typeof body.lead_id === "string" && /^[0-9a-f-]{36}$/i.test(body.lead_id) ? body.lead_id : null;
  const sid = typeof body.submission_id === "string" && SUBMISSION_RE.test(body.submission_id) ? body.submission_id : null;
  if (!leadId || !sid) return null;
  const { data: proof } = await db.from("lead_activities").select("id").eq("lead_id", leadId)
    .eq("metadata->>submission_id", sid).limit(1).maybeSingle();
  if (!proof) return null;
  const { data: lead } = await db.from("leads").select("id, branch_id, full_name").eq("id", leadId).maybeSingle();
  return lead?.branch_id ? { lead: lead as { id: string; branch_id: string; full_name: string | null }, sid } : null;
}

async function loadWebKnowledge(db: Db, branchId: string): Promise<Knowledge> {
  const { data } = await db.from("ai_knowledge").select("content, tags, priority")
    .eq("is_active", true).eq("status", "active").overlaps("applies_to", ["all", "website_chat"])
    .or(`branch_id.is.null,branch_id.eq.${branchId}`);
  return knowledgeFromRows(Array.isArray(data) ? data : []);
}

/** Concierge turn after capture: answer from shared knowledge, store both sides in the CRM inbox. */
async function handleChatTurn(body: Record<string, unknown>, deps: CaptureDeps): Promise<CaptureResult> {
  const p = await chatProof(body, deps.db);
  if (!p) return bad("Enquiry not found", 404);
  const s = (body.state && typeof body.state === "object") ? body.state as Record<string, unknown> : {};
  const state: WebState = {
    discountAsks: Math.min(Math.max(Number(s.discountAsks) || 0, 0), 20),
    awaitingVisit: s.awaitingVisit === true,
    offeredVisit: s.offeredVisit === true,
  };
  const topic = typeof body.topic === "string" && (WEB_TOPICS as readonly string[]).includes(body.topic) ? body.topic as WebTopic : null;
  const message = sanitize(body.message, 300);
  const label = sanitize(body.label, 60);
  if (!topic && !message) return bad("Invalid request");
  const [k, plans] = await Promise.all([loadWebKnowledge(deps.db, p.lead.branch_id), activePlanNames(deps.db)]);
  const reply = topic ? webTopicReply(topic, state, k, plans) : webConciergeReply(message, state, k, plans);
  try {
    await storeTurns(deps.db, p.lead, [
      { from: "user", text: topic ? (label || topic) : message },
      ...reply.messages.map((m) => ({ from: "bot" as const, text: m.text })),
    ]);
  } catch { console.error("[web-chat] persist failed"); }
  if (reply.visitPreference) {
    await recordVisitPreference({ ...body, visit_preference: reply.visitPreference }, deps);
  }
  return { status: 200, body: { success: true, messages: reply.messages, topic: reply.topic, state: reply.state, visit_noted: !!reply.visitPreference } };
}

/** One-time upload of the pre-capture transcript (questions + answers shown before saving). */
async function handleSyncTranscript(body: Record<string, unknown>, deps: CaptureDeps): Promise<CaptureResult> {
  const p = await chatProof(body, deps.db);
  if (!p) return bad("Enquiry not found", 404);
  const { data: prior } = await deps.db.from("whatsapp_messages").select("id")
    .eq("phone_number", webChatKey(p.lead.id)).eq("platform", "web_chat").limit(1).maybeSingle();
  if (prior) return { status: 200, body: { success: true, status: "already_synced" } };
  const turns = (Array.isArray(body.messages) ? body.messages : []).slice(0, 40)
    .map((m) => (m && typeof m === "object") ? m as Record<string, unknown> : {})
    .filter((m) => m.from === "user" || m.from === "bot")
    .map((m) => ({ from: m.from as "user" | "bot", text: sanitize(m.text, 600) }));
  await storeTurns(deps.db, p.lead, turns);
  return { status: 200, body: { success: true, status: "synced" } };
}

export async function hashKey(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
