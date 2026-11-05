// Website Lead Chatbot — pure helpers + deterministic concierge (no public AI endpoint).
// Mirrors supabase/functions/_shared/websiteLeadCapture.ts allow-lists.
// Visitors stay inside the website chat; the only escalation is a tel: phone link.

export const ESCALATION_PHONE = '8298293003';
export const ESCALATION_TEL = `tel:${ESCALATION_PHONE}`;

export const INTEREST_CATEGORIES = [
  'Membership', 'Personal training', 'Group / class training', 'Recovery & wellness', 'Club visit',
] as const;

export const CHATBOT_TIMEFRAMES = [
  { value: 'ready_now', label: 'Ready to start' },
  { value: 'within_30_days', label: 'Within 30 days' },
  { value: 'exploring', label: 'Just exploring' },
] as const;
export type ChatbotTimeframe = (typeof CHATBOT_TIMEFRAMES)[number]['value'];

export const EMAIL_REQUIRED_COPY = 'Your email is required so we can register your enquiry and follow up with you.';

export function timeframeLabel(v: ChatbotTimeframe | null | undefined): string {
  return CHATBOT_TIMEFRAMES.find((t) => t.value === v)?.label ?? '';
}

/** Returns +91XXXXXXXXXX or null. */
export function normalizeIndianMobile(input: string): string | null {
  let d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export function isValidEmail(v: string): boolean {
  const t = v.trim();
  return t.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? '';
}

export function newSubmissionId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `wcb_${rnd.slice(0, 24)}`;
}

// ── Concierge ────────────────────────────────────────────────────────────────
export type Topic = 'objection' | 'location' | 'hours' | 'member_service' | 'greeting' | 'training_floor' | 'membership' | 'pt_classes' | 'recovery' | 'amenities' | 'visit' | 'pricing' | 'discount' | 'group_pricing' | 'unknown';
export type BotMessage = { text: string; tel?: boolean };
export type ConciergeState = { discountAsks: number; awaitingVisit: boolean; plans: string[]; prices?: string[]; offeredVisit?: boolean; isMember?: boolean; lastTopic?: Topic; visitOffers?: number; declinedVisit?: boolean };
export type ConciergeReply = { messages: BotMessage[]; topic: Topic; state: ConciergeState; visitPreference?: string };

export const FOLLOW_UPS = [
  { label: 'Training floor', topic: 'training_floor' },
  { label: 'Recovery & wellness', topic: 'recovery' },
  { label: 'Amenities', topic: 'amenities' },
  { label: 'Membership options', topic: 'membership' },
  { label: 'Personal training & classes', topic: 'pt_classes' },
  { label: 'Plan a visit', topic: 'visit' },
] as const;

export const FIXED_PRICING_POLICY =
  "Thanks for asking! Our membership rates are fixed and the same for every member, so we don't offer individual discounts. That keeps things fair and lets us invest in the facilities and service you'll enjoy.";
export const ESCALATION_COPY =
  `For group membership enquiries or any further pricing discussion, please call our team directly on ${ESCALATION_PHONE}.`;

const RE = {
  discount: /\b(discount|discounts|disc|(any|special|festive|current|best) offers?|deal|deals|coupon|promo|cheaper|cheap|negotiat\w*|bargain|waive\w*|waiver|price ?match|best price|lower (the )?price|reduce|concession|kam|less price|special (price|rate|deal))\b/i,
  group: /\b(group (membership|rate|price|pricing|discount|deal|plan)|corporate|couple|family (plan|membership|rate)|bulk|for (my )?(friends|team|office))\b/i,
  pricing: /\b(price|prices|pricing|cost|costs|fee|fees|charges?|rate|rates|how much|tariff|rs\.?|inr|kitna|kitne|kitni|paisa|paise)\b|₹/i,
  location: /\b(where|location|address|located|directions?|map|kahan|kaha)\b/i,
  memberService: /\b(renew\w*|freeze|unfreeze|expir\w*|my plan|my membership|validity|upgrade)\b/i,
  recovery: /\b(recovery|sauna|steam|cold plunge|plunge|ice bath|red[- ]?light|wellness|spa)\b/i,
  amenities: /\b(locker|lockers|ac|air[- ]?condition\w*|music|audio|sound|amenit\w*|shower|changing)\b/i,
  pt: /\b(pt|personal train\w*|trainers?|coach(es)?|class|classes|pilates|yoga|zumba)\b/i,
  floor: /\b(equipment|machines?|weights?|strength|floor|gym|cardio|panatta)\b/i,
  membership: /\b(membership|plans?|join|package|annual|monthly|quarterly)\b/i,
  visit: /\b(visit|tour|walk ?through|come (by|over|in)|see the (club|gym)|trial|experience)\b/i,
  hours: /\b(timing|timings|hours|open|close|opening|24 ?x ?7)\b/i,
};

const ASK_NEXT = 'What would you like to know next?';
export const OBJECTION_RE = /\b(before (a |the |my )?visit|without (coming|visiting|a visit)|can'?t (come|visit)|cannot (come|visit)|won'?t (come|visit)|no time to visit|just tell( me)?|tell me (the )?(price|cost|fees?|rate)|on (the )?(phone|chat)|over (the )?(phone|chat)|why (can'?t|won'?t|not|don'?t) you|abhi batao|yahin batao|seedha batao)\b/i;
export const OBJECTION_COPY = "I understand you'd like the numbers first. Fees depend on the plan length and what's included, so our team shares the exact figure personally rather than a generic list here.";
export const OBJECTION_CALL = `If you'd rather not visit first, call our team on ${ESCALATION_PHONE} and they'll explain the options on the phone.`;

function topicAnswer(topic: Topic, plans: string[]): string[] {
  switch (topic) {
    case 'training_floor':
      return ['Our training floor is built around Italian Panatta strength equipment in a premium, fully air-conditioned space.', ASK_NEXT];
    case 'recovery':
      return [
        'Recovery is a big part of Incline: separate male and female recovery rooms, a full-spectrum sauna with carbon heaters, a steam room, a commercial cold plunge and 7-wavelength red-light therapy.',
        'The steam facility is backed by 15 KVA generators. Would you like to plan a visit to see the recovery suites?',
      ];
    case 'amenities':
      return ['The club is fully air-conditioned, with QSC audio throughout and digital lockers.', ASK_NEXT];
    case 'membership':
      return [
        'Memberships are available as Monthly, Quarterly, Half-Yearly and Annual.',
        'Our team explains what each option includes during your visit. Would you like to plan one?',
      ];
    case 'pt_classes':
      return ['Personal training and group sessions are available. Our team will share the current trainers and class schedule with you.', ASK_NEXT];
    case 'visit':
      return ['We would love to show you around in person. Which day and time suit you for a visit? (e.g. "Saturday 11am")'];
    case 'pricing':
      return [
        'Our team will happily share current membership rates and what each plan includes.',
        'Would you like to plan a visit?',
      ];
    case 'location':
      return ['Incline is at Sector 14, Udaipur, Rajasthan.', ASK_NEXT];
    case 'hours':
      return ['Our team will confirm current club timings with you.', ASK_NEXT];
    default:
      return [
        "I don't have a confirmed answer for that here, and I'd rather not guess.",
        'Our team can help during a club visit or a callback. Would you like to plan a visit?',
      ];
  }
}

const YES_RE = /^(yes|yeah|yep|ya|yup|sure|ok|okay|haan|han|ha|please|definitely|of course|why not)\b/i;
const NO_RE = /^(no|nope|nah|not now|later|maybe later|nahi|na)\b/i;
const VISIT_OFFER_RE = /plan (a visit|one)|plan a visit/i;
const GREET_RE = /^(hi+|hello|hey|namaste|good (morning|afternoon|evening))[!. ]*$/i;
const THANKS_RE = /^(thanks|thank you|thankyou|thx|shukriya|dhanyavaad)[!. ]*$/i;
const TIME_RE = /\b(mon|tue|wed|thu|fri|sat|sun)\w*|\b(today|tomorrow|tmrw|kal|weekend|morning|afternoon|evening|night)\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}(st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i;
const UNSAFE_RE = /₹|\b(rs\.?|inr)\s*\d|whatsapp|wa\.me|https?:\/\//i;
const MEMBER_PRICE = 'Your current plan, renewal and upgrade options are in the Member Portal under My Plan, and the front desk can confirm renewal pricing for you.';
const MEMBER_SERVICE = 'For renewals, freezes, plan expiry or upgrades, open My Plan in the Member Portal, or ask the front desk and they will sort it for you. I won\'t guess dates or eligibility here.';
const MEMBER_HELP = 'As a member, you can renew, book classes or recovery slots and view your plan in the Member Portal, or ask the front desk.';

/** Members never get tour invites; any visit offer turns on yes/no handling for the next reply. */
function finalize(reply: ConciergeReply, prev: ConciergeState): ConciergeReply {
  const isMember = prev.isMember === true;
  let messages = reply.messages;
  if (isMember && (reply.topic === 'pricing' || reply.topic === 'discount')) {
    messages = [{ text: FIXED_PRICING_POLICY }, { text: MEMBER_PRICE }, ...messages.filter((m) => m.tel)];
  } else if (!isMember && reply.topic === prev.lastTopic && reply.topic !== 'unknown' && reply.topic !== 'discount' && reply.topic !== 'greeting' && messages.length > 1 && !reply.visitPreference) {
    messages = [{ text: 'As I mentioned, ' + messages[0].text.charAt(0).toLowerCase() + messages[0].text.slice(1) }, ...messages.slice(-1)];
  }
  if (isMember) {
    messages = messages.filter((m) => !VISIT_OFFER_RE.test(m.text) && !/which day and time/i.test(m.text));
    if (reply.topic === 'visit' || messages.length < reply.messages.length) messages = [...messages, { text: MEMBER_HELP }];
    if (!messages.length) messages = [{ text: MEMBER_HELP }];
  }
  // Visit-offer cooldown: never offer twice in a row, at most twice per chat, never after a "no".
  const offers = prev.visitOffers ?? 0;
  const declined = prev.declinedVisit === true || reply.state.declinedVisit === true;
  if (!isMember && (prev.offeredVisit || offers >= 2 || declined) && reply.topic !== 'visit') {
    const last = messages[messages.length - 1];
    if (last && VISIT_OFFER_RE.test(last.text)) {
      const trimmed = last.text.replace(/\s*(Would you like to plan (a visit|one)[^?]*\?)\s*$/i, '').trim();
      messages = [...messages.slice(0, -1), ...(trimmed ? [{ ...last, text: trimmed }] : []), { text: ASK_NEXT }];
    }
  }
  const offeredVisit = !isMember && VISIT_OFFER_RE.test(messages[messages.length - 1]?.text ?? '');
  return { ...reply, messages, state: { ...reply.state, declinedVisit: declined, visitOffers: offers + (offeredVisit ? 1 : 0), isMember, offeredVisit, awaitingVisit: isMember ? false : reply.state.awaitingVisit, lastTopic: reply.topic } };
}

const isTopicQuestion = (t: string) => [RE.discount, RE.group, RE.pricing, RE.location, RE.memberService, RE.recovery, RE.amenities, RE.pt, RE.floor, RE.membership, RE.hours].some((r) => r.test(t));

export function conciergeTopic(topic: Topic, state: ConciergeState): ConciergeReply {
  return finalize(rawTopic(topic, state), state);
}

function rawTopic(topic: Topic, state: ConciergeState): ConciergeReply {
  return {
    messages: ((topic === 'pricing' || topic === 'membership') && state.prices?.length
      ? ['Here are our current membership rates:\n' + state.prices.join('\n'), 'These are our fixed rates, the same for every member. Would you like to plan a visit?']
      : topicAnswer(topic, state.plans)).map((text) => ({ text })),
    topic,
    state: { ...state, awaitingVisit: topic === 'visit' },
  };
}

/** Deterministic reply to free text. Never invents prices, discounts, timings or outcomes. */
export function conciergeReply(raw: string, state: ConciergeState): ConciergeReply {
  return finalize(rawReply(raw, state), state);
}

function rawReply(raw: string, state: ConciergeState): ConciergeReply {
  const text = raw.trim().slice(0, 300);
  const base = { ...state, offeredVisit: false };
  if (!state.isMember && (state.offeredVisit || state.awaitingVisit) && TIME_RE.test(text) && !UNSAFE_RE.test(text) && !RE.pricing.test(text)) {
    return {
      messages: [{ text: "Thanks, I've noted your preferred visit time." }, { text: 'Our team will contact you to confirm. This is not a confirmed booking yet.' }, { text: ASK_NEXT }],
      topic: 'visit', state: { ...base, awaitingVisit: false }, visitPreference: text.slice(0, 120),
    };
  }
  if (GREET_RE.test(text)) return { messages: [{ text: state.isMember ? 'Hello! How can I help you today?' : 'Hello! Ask me anything about memberships, training, recovery or planning a visit.' }], topic: 'greeting', state: { ...base, awaitingVisit: state.awaitingVisit } };
  if (THANKS_RE.test(text)) return { messages: [{ text: "You're welcome! Anything else I can help with?" }], topic: 'greeting', state: { ...base, awaitingVisit: false } };
  if (state.offeredVisit && YES_RE.test(text) && !isTopicQuestion(text)) return rawTopic('visit', base);
  if (NO_RE.test(text) && !isTopicQuestion(text)) {
    return { messages: [{ text: 'No problem.' }, { text: ASK_NEXT }], topic: 'unknown', state: { ...base, awaitingVisit: false, declinedVisit: state.offeredVisit || state.declinedVisit } };
  }
  if (YES_RE.test(text) && !isTopicQuestion(text)) {
    return { messages: [{ text: 'Happy to help. You can ask about the training floor, recovery, amenities, memberships or classes.' }], topic: 'unknown', state: { ...base, awaitingVisit: false } };
  }
  if (state.awaitingVisit && text && !isTopicQuestion(text)) {
    return { messages: [{ text: 'Please share a day and time that suits you, for example "Saturday 11am" or "tomorrow evening".' }], topic: 'visit', state: { ...base, awaitingVisit: true } };
  }
  const next = { ...base, awaitingVisit: false };

  if (RE.group.test(text)) {
    return { messages: [{ text: ESCALATION_COPY, tel: true }], topic: 'group_pricing', state: next };
  }
  if (RE.discount.test(text)) {
    const asks = state.discountAsks + 1;
    const s2 = { ...next, discountAsks: asks };
    if (asks === 1) return { messages: [{ text: FIXED_PRICING_POLICY }, { text: 'Would you like to hear more about the facilities, or plan a visit?' }], topic: 'discount', state: s2 };
    return { messages: [{ text: FIXED_PRICING_POLICY }, { text: ESCALATION_COPY, tel: true }], topic: 'discount', state: s2 };
  }
  if (OBJECTION_RE.test(text) && !state.isMember && state.prices?.length) return conciergeTopic('pricing', state);
  if (OBJECTION_RE.test(text) && !state.isMember) {
    return { messages: [{ text: OBJECTION_COPY }, { text: OBJECTION_CALL, tel: true }], topic: 'objection', state: next };
  }
  if (RE.memberService.test(text) && (state.isMember || !RE.membership.test(text) || /renew|freeze|expir/i.test(text))) {
    return { messages: [{ text: MEMBER_SERVICE }], topic: 'member_service', state: next };
  }
  if (RE.pricing.test(text)) return rawTopic('pricing', next);
  const order: Array<[RegExp, Topic]> = [
    [RE.visit, 'visit'], [RE.hours, 'hours'], [RE.location, 'location'], [RE.recovery, 'recovery'], [RE.pt, 'pt_classes'], [RE.amenities, 'amenities'],
    [RE.membership, 'membership'], [RE.floor, 'training_floor'],
  ];
  for (const [re, topic] of order) if (re.test(text)) return rawTopic(topic, next);
  return rawTopic('unknown', next);
}

export function welcomeAfterCapture(name: string, interest: string): string[] {
  return [
    `Thanks, ${firstName(name)}! Your enquiry is saved, and it's great to hear you're interested in ${interest}.`,
    'Incline is a premium, fully air-conditioned fitness and recovery club. I can tell you about the training floor, recovery suites, amenities, membership options, or help you plan a visit.',
  ];
}

// ── Intake understanding ────────────────────────────────────────────────────
const QUESTION_START = /^(what|whats|what's|how|where|when|why|which|who|can|could|do|does|is|are|will|kya|kitna|kitne|kitni|kab|kaise|kahan|tell|show|give|any)\b/i;
const NAME_PREFIX = /^(hi|hello|hey|namaste)?[,! ]*(my name is|my name's|name is|i am|i'm|im|this is|it's|its|mera naam|main|myself)\s+/i;
const NAME_SUFFIX = /\s+(hoon|hu|hai|here)\.?$/i;

/** True when the visitor asked something instead of answering the intake question. */
export function isQuestionLike(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return /\?/.test(t) || QUESTION_START.test(t) || isTopicQuestion(t) || RE.visit.test(t) || OBJECTION_RE.test(t);
}

/** Stricter: an explicit question or money/objection talk (used when the field itself is topical, e.g. "join the gym"). */
export function isDirectQuestion(raw: string): boolean {
  const t = raw.trim();
  return /\?/.test(t) || QUESTION_START.test(t) || RE.pricing.test(t) || RE.discount.test(t) || RE.group.test(t) || OBJECTION_RE.test(t);
}

/** Pulls a plausible full name out of "my name is Rajat Lekhari" etc.; null if it isn't a name. */
export function extractName(raw: string): string | null {
  const t = raw.trim().replace(NAME_PREFIX, '').replace(NAME_SUFFIX, '').replace(/[.!,]+$/, '').trim();
  if (t.length < 2 || t.length > 60) return null;
  if (!/^[\p{L}][\p{L}.' -]*$/u.test(t)) return null; // letters only — no digits, @, ?
  const words = t.split(/\s+/);
  if (words.length > 4) return null;
  if (isQuestionLike(t) || GREET_RE.test(t) || THANKS_RE.test(t) || YES_RE.test(t) || NO_RE.test(t)) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export function extractEmail(raw: string): string | null {
  const m = raw.match(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}/i);
  return m && isValidEmail(m[0]) ? m[0].toLowerCase() : null;
}

export function extractMobile(raw: string): string | null {
  const m = raw.match(/(\+?\d[\d\s-]{8,15}\d)/);
  return m ? normalizeIndianMobile(m[1]) : null;
}

const INTENT_MAP: Array<[RegExp, string]> = [
  [/\b(personal train\w*|pt|trainer|coach)\b/i, 'Personal training'],
  [/\b(recovery|sauna|steam|plunge|ice bath|red[- ]?light|wellness|spa)\b/i, 'Recovery & wellness'],
  [/\b(class|classes|pilates|yoga|zumba|group)\b/i, 'Group classes & Pilates'],
  [/\b(explor\w*|just looking|looking around|browsing|not sure|dekh)\b/i, 'Just exploring'],
  [/\b(membership|member|join|gym|plan)\b/i, 'Membership'],
];
const GOAL_MAP: Array<[RegExp, string]> = [
  [/\b(fat|weight|slim|lose|loss|cut|belly|vajan|motapa)\b/i, 'Fat loss'],
  [/\b(muscle|bulk|gain|strength|strong|build|mass)\b/i, 'Build muscle'],
  [/\b(recover\w*|injur\w*|rehab|pain|relax|stress|mobility)\b/i, 'Recovery & wellness'],
  [/\b(athlet\w*|sport\w*|performance|endurance|stamina|marathon|run)\b/i, 'Athletic performance'],
  [/\b(general|fit|fitness|health\w*|active|tone|overall)\b/i, 'General fitness'],
];
const DURATION_MAP: Array<[RegExp, string]> = [
  [/\b(half[- ]?year\w*|6 ?months?|six months?|semi)\b/i, 'Half-Yearly'],
  [/\b(annual\w*|year\w*|12 ?months?|1 ?yr)\b/i, 'Annual'],
  [/\b(quarter\w*|3 ?months?|three months?)\b/i, 'Quarterly'],
  [/\b(month\w*|1 ?month|mahina)\b/i, 'Monthly'],
];
const pick = (map: Array<[RegExp, string]>, raw: string, exact: readonly string[]) => {
  const t = raw.trim();
  const hit = exact.find((e) => e.toLowerCase() === t.toLowerCase());
  if (hit) return hit;
  for (const [re, v] of map) if (re.test(t)) return v;
  return null;
};
export const matchIntent = (raw: string, exact: readonly string[] = []) => pick(INTENT_MAP, raw, exact);
export const matchGoal = (raw: string, exact: readonly string[] = []) => pick(GOAL_MAP, raw, exact);
export const matchDuration = (raw: string, exact: readonly string[] = []) => pick(DURATION_MAP, raw, exact);

/** A short, honest answer to a question asked mid-intake — no visit offers, then the caller re-asks the field. */
export function intakeAside(raw: string, state: ConciergeState): { messages: BotMessage[]; state: ConciergeState } {
  const r = conciergeReply(raw, { ...state, offeredVisit: false, awaitingVisit: false });
  const body = r.messages.filter((m) => !VISIT_OFFER_RE.test(m.text) && m.text !== ASK_NEXT && !/which day and time/i.test(m.text));
  const kept = r.topic === 'unknown' ? [{ text: "Good question — our team will answer that properly once your enquiry is saved." }] : body.slice(0, 2);
  return { messages: kept, state: { ...state, discountAsks: r.state.discountAsks } };
}
