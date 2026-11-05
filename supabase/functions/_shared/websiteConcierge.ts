// _shared/websiteConcierge.ts
// v1.0.0 — Deterministic website concierge. Answers come from ai_knowledge rows tagged
// `web:<topic>` (the same table the WhatsApp AI reads), so editing knowledge updates both
// channels. No LLM, no public AI endpoint. Outbound text passes the shared pricing leak guard.

import { PRICING_LEAK_RE, PRICE_ASK_RE } from "./pricingPolicy.ts";

export const WEB_TOPICS = [
  "training_floor", "membership", "pt_classes", "recovery", "amenities", "assessment", "location", "hours",
  "visit", "pricing", "discount", "group_pricing", "unknown",
] as const;
export type WebTopic = (typeof WEB_TOPICS)[number];
export type WebState = { discountAsks: number; awaitingVisit: boolean; offeredVisit?: boolean };
export type WebMsg = { text: string; tel?: boolean };
export type WebReply = { messages: WebMsg[]; topic: WebTopic; state: WebState; visitPreference?: string };
/** topic -> visitor-facing text, loaded from ai_knowledge */
export type Knowledge = Partial<Record<WebTopic | "escalation", string>>;

const ASK_NEXT = "What would you like to know next?";
const VISIT_ASK = "Would you like to plan a visit?";

const RE = {
  discount: /\b(discount|discounts|disc|(any|special|festive|current|best) offers?|deal|deals|coupon|promo|cheaper|cheap|negotiat\w*|bargain|waive\w*|waiver|price ?match|best price|lower (the )?price|reduce|concession|kam|less price|special (price|rate|deal))\b/i,
  group: /\b(group (membership|rate|price|pricing|discount|deal|plan)|corporate|couple|family (plan|membership|rate)|bulk|for (my )?(friends|team|office))\b/i,
  pricing: /\b(price|prices|pricing|cost|costs|fee|fees|charges?|rate|rates|how much|tariff|rs\.?|inr)\b|₹/i,
  recovery: /\b(recovery|sauna|steam|cold plunge|plunge|ice bath|red[- ]?light|wellness|spa)\b/i,
  amenities: /\b(locker|lockers|ac|air[- ]?condition\w*|music|audio|sound|amenit\w*|shower|changing|fan|fans)\b/i,
  assessment: /\b(scan|scanning|body composition|posture|bmi|3d)\b/i,
  location: /\b(where|location|address|located|directions?|map|kahan|kaha)\b/i,
  pt: /\b(pt|personal train\w*|trainer|coach|class|classes|pilates|yoga|zumba)\b/i,
  floor: /\b(equipment|machines?|weights?|strength|floor|gym|cardio|panatta)\b/i,
  membership: /\b(membership|plans?|join|package|annual|monthly|quarterly)\b/i,
  visit: /\b(visit|tour|walk ?through|come (by|over|in)|see the (club|gym)|trial|experience)\b/i,
  hours: /\b(timing|timings|hours|open|close|opening|24 ?x ?7)\b/i,
};

/** Fallback copy only when a knowledge row is missing — never prices. */
const FALLBACK: Record<WebTopic | "escalation", string> = {
  training_floor: "Our training floor is built around Panatta strength equipment in a premium, fully air-conditioned space.",
  membership: "Our team explains each membership option and what it includes during your visit.",
  pt_classes: "Personal training and group sessions are available. Our team will share the current trainers and class schedule with you.",
  recovery: "Recovery includes separate male and female recovery rooms with sauna, steam and cold plunge.",
  amenities: "The club is fully air-conditioned, with premium audio and digital lockers.",
  assessment: "Incline offers 3D body composition and posture scanning.",
  location: "Incline is at Sector 14, Udaipur, Rajasthan.",
  hours: "Our team will confirm current club timings with you.",
  visit: "We would love to show you around in person.",
  pricing: "Incline follows a fixed and transparent pricing policy. We do not offer discounts or negotiate membership prices. Our focus is on the facilities, service and overall experience.",
  discount: "Incline follows a fixed and transparent pricing policy. We do not offer discounts or negotiate membership prices. Our focus is on the facilities, service and overall experience.",
  group_pricing: "For group membership enquiries or any further pricing discussion, please call our team directly on 8298293003.",
  escalation: "For group membership enquiries or any further pricing discussion, please call our team directly on 8298293003.",
  unknown: "I don't have a confirmed answer for that here, and I'd rather not guess. Our team can help during a club visit or a callback.",
};

/** Builds the topic map from ai_knowledge rows (tag `web:<topic>`). Lower priority number wins. */
export function knowledgeFromRows(rows: Array<{ content?: string | null; tags?: string[] | null; priority?: number | null }>): Knowledge {
  const out: Knowledge = {};
  const best: Record<string, number> = {};
  for (const r of [...rows].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))) {
    for (const tag of r.tags ?? []) {
      if (!tag.startsWith("web:")) continue;
      const k = tag.slice(4);
      if (k in best) continue;
      best[k] = r.priority ?? 100;
      (out as Record<string, string>)[k] = String(r.content ?? "").trim();
    }
  }
  return out;
}

function text(k: Knowledge, topic: WebTopic | "escalation"): string {
  const t = (k[topic] || "").trim() || FALLBACK[topic];
  // Pricing rows legitimately contain the word "pricing"; only block real amounts/durations.
  if (topic !== "pricing" && topic !== "discount" && PRICING_LEAK_RE.test(t) && /\d/.test(t)) return FALLBACK[topic];
  return t;
}

function topicMessages(topic: WebTopic, k: Knowledge, plans: string[]): WebMsg[] {
  switch (topic) {
    case "visit":
      return [{ text: text(k, "visit").split(/(?<=\.)\s/)[0] }, { text: 'Which day and time suit you for a visit? (e.g. "Saturday 11am")' }];
    case "membership": {
      const m: WebMsg[] = [{ text: text(k, "membership") }];
      void plans; // internal plan names are never shown to visitors
      m.push({ text: "Memberships are available as Monthly, Quarterly, Half-Yearly and Annual." });
      m.push({ text: VISIT_ASK });
      return m;
    }
    case "pricing":
      return [{ text: text(k, "pricing") }, { text: VISIT_ASK }];
    case "unknown":
      return [{ text: text(k, "unknown") }, { text: VISIT_ASK }];
    case "recovery":
      return [{ text: text(k, "recovery") }, { text: "Would you like to plan a visit to see the recovery suites?" }];
    default:
      return [{ text: text(k, topic) }, { text: ASK_NEXT }];
  }
}

const YES_RE = /^(yes|yeah|yep|ya|yup|sure|ok|okay|haan|han|ha|please|definitely|of course|why not)\b/i;
const NO_RE = /^(no|nope|nah|not now|later|maybe later|nahi|na)\b/i;
const VISIT_OFFER_RE = /plan (a visit|one)/i;
const isTopicQuestion = (t: string) => [RE.discount, RE.group, RE.pricing, RE.recovery, RE.amenities, RE.assessment, RE.location, RE.pt, RE.floor, RE.membership, RE.hours].some((r) => r.test(t));
function withOffer(r: WebReply): WebReply {
  return { ...r, state: { ...r.state, offeredVisit: VISIT_OFFER_RE.test(r.messages[r.messages.length - 1]?.text ?? "") } };
}

export function webTopicReply(topic: WebTopic, state: WebState, k: Knowledge, plans: string[] = []): WebReply {
  return withOffer({ messages: topicMessages(topic, k, plans), topic, state: { ...state, awaitingVisit: topic === "visit" } });
}

/** Deterministic reply to free text. Never invents prices, discounts, timings or outcomes. */
export function webConciergeReply(raw: string, state: WebState, k: Knowledge, plans: string[] = []): WebReply {
  return withOffer(rawWebReply(raw, state, k, plans));
}

function rawWebReply(raw: string, prev: WebState, k: Knowledge, plans: string[]): WebReply {
  const t = String(raw ?? "").trim().slice(0, 300);
  const state = { ...prev, offeredVisit: false };
  const isMoney = RE.discount.test(t) || RE.pricing.test(t) || PRICE_ASK_RE.test(t);
  const topical = isTopicQuestion(t) || isMoney;
  if (prev.offeredVisit && YES_RE.test(t) && !topical) return webTopicReply("visit", state, k, plans);
  if (NO_RE.test(t) && !topical) return { messages: [{ text: "No problem." }, { text: ASK_NEXT }], topic: "unknown", state: { ...state, awaitingVisit: false } };
  if (YES_RE.test(t) && !topical) return { messages: [{ text: "Happy to help. You can ask about the training floor, recovery, amenities, memberships or classes." }], topic: "unknown", state: { ...state, awaitingVisit: false } };
  if (state.awaitingVisit && t && !topical) {
    return {
      messages: [
        { text: `Thanks, I've noted "${t}" as your preferred visit time.` },
        { text: "Our team will contact you to confirm. This is not a confirmed booking yet." },
        { text: ASK_NEXT },
      ],
      topic: "visit", state: { ...state, awaitingVisit: false }, visitPreference: t,
    };
  }
  const next = { ...state, awaitingVisit: false };
  if (RE.group.test(t)) return { messages: [{ text: text(k, "group_pricing"), tel: true }], topic: "group_pricing", state: next };
  if (RE.discount.test(t)) {
    const asks = (state.discountAsks || 0) + 1;
    const s2 = { ...next, discountAsks: asks };
    if (asks === 1) return { messages: [{ text: text(k, "discount") }, { text: "Would you like to hear more about the facilities, or plan a visit?" }], topic: "discount", state: s2 };
    return { messages: [{ text: text(k, "discount") }, { text: text(k, "escalation"), tel: true }], topic: "discount", state: s2 };
  }
  if (RE.pricing.test(t) || PRICE_ASK_RE.test(t)) return webTopicReply("pricing", next, k, plans);
  const order: Array<[RegExp, WebTopic]> = [
    [RE.visit, "visit"], [RE.hours, "hours"], [RE.location, "location"], [RE.recovery, "recovery"],
    [RE.assessment, "assessment"], [RE.pt, "pt_classes"], [RE.amenities, "amenities"],
    [RE.membership, "membership"], [RE.floor, "training_floor"],
  ];
  for (const [re, topic] of order) if (re.test(t)) return webTopicReply(topic, next, k, plans);
  return webTopicReply("unknown", next, k, plans);
}
