// Website Lead Chatbot — pure helpers shared by the widget and its tests.
// Mirrors supabase/functions/_shared/websiteLeadCapture.ts allow-lists.

export const BUSINESS_WHATSAPP = '918298293003';

export const CHATBOT_GOALS = [
  'Build muscle', 'Fat loss', 'General fitness', 'Personal training', 'Recovery & wellness', 'Explore membership',
] as const;
export type ChatbotGoal = (typeof CHATBOT_GOALS)[number];

export const CHATBOT_TIMEFRAMES = [
  { value: 'ready_now', label: 'Ready to start' },
  { value: 'within_30_days', label: 'Within 30 days' },
  { value: 'exploring', label: 'Just exploring' },
] as const;
export type ChatbotTimeframe = (typeof CHATBOT_TIMEFRAMES)[number]['value'];

/** Exact wording shown beside the WhatsApp action and stored as consent evidence. */
export const WHATSAPP_HANDOFF_CONSENT =
  'Yes, open WhatsApp with my enquiry as a draft message to Incline. I understand nothing is sent until I press Send in WhatsApp.';

export const SAVED_NOTICE = 'Your enquiry is saved. WhatsApp will open with a draft—press Send there to start the conversation.';

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.trim().length <= 255;
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? '';
}

/** Prefilled draft — no email or phone number included. */
export function buildWhatsAppDraft(args: { name: string; goal: string | null; timeframe: ChatbotTimeframe | null; reference: string | null }): string {
  const parts = [`Hi Incline! I'm ${firstName(args.name)}. I just sent an enquiry on your website`];
  parts[0] += args.reference ? ` (ref ${args.reference}).` : '.';
  if (args.goal) parts.push(`My goal: ${args.goal}.`);
  const tf = timeframeLabel(args.timeframe);
  if (tf) parts.push(`Joining: ${tf}.`);
  parts.push('Could you help me with the next steps?');
  return parts.join(' ');
}

export function buildWhatsAppUrl(draft: string, number = BUSINESS_WHATSAPP): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(draft)}`;
}

export function newSubmissionId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `wcb_${rnd.slice(0, 24)}`;
}
