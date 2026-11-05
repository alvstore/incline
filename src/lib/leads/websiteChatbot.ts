// Website Lead Chatbot — pure helpers + deterministic concierge (no public AI endpoint).
// Mirrors supabase/functions/_shared/websiteLeadCapture.ts allow-lists.
// Visitors stay inside the website chat: this module never builds WhatsApp links.

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
export type Topic = 'training_floor' | 'membership' | 'pt_classes' | 'recovery' | 'amenities' | 'visit' | 'pricing' | 'discount' | 'group_pricing' | 'unknown';
export type BotMessage = { text: string; tel?: boolean };
export type ConciergeState = { discountAsks: number; awaitingVisit: boolean; plans: string[] };
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
  pricing: /\b(price|prices|pricing|cost|costs|fee|fees|charges?|rate|rates|how much|tariff|rs\.?|₹|inr)\b/i,
  recovery: /\b(recovery|sauna|steam|cold plunge|plunge|ice bath|red[- ]?light|wellness|spa)\b/i,
  amenities: /\b(locker|lockers|ac|air[- ]?condition\w*|music|audio|sound|amenit\w*|shower|changing)\b/i,
  pt: /\b(pt|personal train\w*|trainer|coach|class|classes|pilates|yoga|zumba)\b/i,
  floor: /\b(equipment|machines?|weights?|strength|floor|gym|cardio|panatta)\b/i,
  membership: /\b(membership|plans?|join|package|annual|monthly|quarterly)\b/i,
  visit: /\b(visit|tour|walk ?through|come (by|over|in)|see the (club|gym)|trial|experience)\b/i,
  hours: /\b(timing|timings|hours|open|close|opening)\b/i,
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
        plans.length ? `Current membership options include: ${plans.join(', ')}.` : 'We have a range of membership durations.',
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
    default:
      return [
        "I don't have a confirmed answer for that here, and I'd rather not guess.",
        'Our team can help during a club visit or a callback. Would you like to plan a visit?',
      ];
  }
}

export function conciergeTopic(topic: Topic, state: ConciergeState): ConciergeReply {
  return {
    messages: topicAnswer(topic, state.plans).map((text) => ({ text })),
    topic,
    state: { ...state, awaitingVisit: topic === 'visit' },
  };
}

/** Deterministic reply to free text. Never invents prices, discounts, timings or outcomes. */
export function conciergeReply(raw: string, state: ConciergeState): ConciergeReply {
  const text = raw.trim().slice(0, 300);
  if (state.awaitingVisit && text && !RE.discount.test(text) && !RE.pricing.test(text)) {
    return {
      messages: [
        { text: `Thanks, I've noted "${text}" as your preferred visit time.` },
        { text: 'Our team will contact you to confirm. This is not a confirmed booking yet.' },
        { text: ASK_NEXT },
      ],
      topic: 'visit',
      state: { ...state, awaitingVisit: false },
      visitPreference: text,
    };
  }
  const next = { ...state, awaitingVisit: false };

  if (RE.group.test(text)) {
    return { messages: [{ text: ESCALATION_COPY, tel: true }], topic: 'group_pricing', state: next };
  }
  if (RE.discount.test(text)) {
    const asks = state.discountAsks + 1;
    const s2 = { ...next, discountAsks: asks };
    if (asks === 1) return { messages: [{ text: FIXED_PRICING_POLICY }, { text: 'Would you like to hear more about the facilities, or plan a visit?' }], topic: 'discount', state: s2 };
    return { messages: [{ text: FIXED_PRICING_POLICY }, { text: ESCALATION_COPY, tel: true }], topic: 'discount', state: s2 };
  }
  if (RE.pricing.test(text)) return conciergeTopic('pricing', next);
  if (RE.hours.test(text)) {
    return { messages: [{ text: 'Our team will confirm current club timings with you.' }, { text: 'Would you like to plan a visit?' }], topic: 'unknown', state: next };
  }
  const order: Array<[RegExp, Topic]> = [
    [RE.visit, 'visit'], [RE.recovery, 'recovery'], [RE.pt, 'pt_classes'], [RE.amenities, 'amenities'],
    [RE.membership, 'membership'], [RE.floor, 'training_floor'],
  ];
  for (const [re, topic] of order) if (re.test(text)) return conciergeTopic(topic, next);
  return conciergeTopic('unknown', next);
}

export function welcomeAfterCapture(name: string, interest: string): string[] {
  return [
    `Thanks, ${firstName(name)}! Your enquiry is saved, and it's great to hear you're interested in ${interest}.`,
    'Incline is a premium, fully air-conditioned fitness and recovery club. I can tell you about the training floor, recovery suites, amenities, membership options, or help you plan a visit.',
  ];
}
