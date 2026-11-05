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
export type Topic = 'location' | 'hours' | 'member_service' | 'greeting' | 'training_floor' | 'membership' | 'pt_classes' | 'recovery' | 'amenities' | 'visit' | 'pricing' | 'discount' | 'group_pricing' | 'unknown';
export type BotMessage = { text: string; tel?: boolean };
export type ConciergeState = { discountAsks: number; awaitingVisit: boolean; plans: string[]; offeredVisit?: boolean; isMember?: boolean; lastTopic?: Topic };
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
  'Incline follows a fixed and transparent pricing policy. We do not offer discounts or negotiate membership prices. Our focus is on the facilities, service and overall experience.';
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
        `${FIXED_PRICING_POLICY}`,
        'Our team walks you through membership pricing and inclusions during your visit. Would you like to plan one?',
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
  const offeredVisit = !isMember && VISIT_OFFER_RE.test(messages[messages.length - 1]?.text ?? '');
  return { ...reply, messages, state: { ...reply.state, isMember, offeredVisit, awaitingVisit: isMember ? false : reply.state.awaitingVisit, lastTopic: reply.topic } };
}

const isTopicQuestion = (t: string) => [RE.discount, RE.group, RE.pricing, RE.location, RE.memberService, RE.recovery, RE.amenities, RE.pt, RE.floor, RE.membership, RE.hours].some((r) => r.test(t));

export function conciergeTopic(topic: Topic, state: ConciergeState): ConciergeReply {
  return finalize(rawTopic(topic, state), state);
}

function rawTopic(topic: Topic, state: ConciergeState): ConciergeReply {
  return {
    messages: topicAnswer(topic, state.plans).map((text) => ({ text })),
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
    return { messages: [{ text: 'No problem.' }, { text: ASK_NEXT }], topic: 'unknown', state: { ...base, awaitingVisit: false } };
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
