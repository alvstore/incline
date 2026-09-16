// Catalog of data keys the system can supply to a message template at send
// time, plus per-event suggestions used by the Parameter Mapper UI.
//
// WHY: WhatsApp (Meta) approved bodies are positional — "Hi {{1}}, your {{2}}
// booking on {{3}} at {{4}} is confirmed". The dispatcher (`orderedTemplateKeys`
// in dispatch-communication) treats `templates.variables[n]` as the label for
// {{n+1}}. If that mapping is missing or generic, the slot resolves empty and
// Meta rejects the send with 132018 (template_param_empty).
//
// This catalog gives the template editor a real picker so every positional slot
// is explicitly mapped to a known payload key.

export interface PayloadVariable {
  key: string;
  label: string;
  sample: string;
  group: 'Recipient' | 'Membership' | 'Billing' | 'Booking' | 'Coaching' | 'Lead' | 'Document' | 'General';
}

export const PAYLOAD_VARIABLES: PayloadVariable[] = [
  // Recipient
  { key: 'member_name', label: 'Member name', sample: 'Rahul Madhwani', group: 'Recipient' },
  { key: 'first_name', label: 'First name', sample: 'Rahul', group: 'Recipient' },
  { key: 'recipient_name', label: 'Recipient name (staff or member)', sample: 'Rajat', group: 'Recipient' },
  { key: 'member_code', label: 'Member code', sample: 'INC-26-0090', group: 'Recipient' },
  { key: 'branch_name', label: 'Branch name', sample: 'Incline Udaipur', group: 'Recipient' },

  // Membership
  { key: 'plan_name', label: 'Plan name', sample: 'Annual Premium', group: 'Membership' },
  { key: 'end_date', label: 'Membership end date', sample: '15 Oct 2026', group: 'Membership' },
  { key: 'days_left', label: 'Days left', sample: '7', group: 'Membership' },

  // Billing
  { key: 'amount', label: 'Amount', sample: '4,000', group: 'Billing' },
  { key: 'amount_due', label: 'Amount due', sample: '1,500', group: 'Billing' },
  { key: 'invoice_number', label: 'Invoice number', sample: 'MAIN-00001', group: 'Billing' },
  { key: 'due_date', label: 'Due date', sample: '30 Sep 2026', group: 'Billing' },
  { key: 'payment_method', label: 'Payment method', sample: 'UPI', group: 'Billing' },

  // Booking
  { key: 'benefit_name', label: 'Benefit / facility', sample: 'Steam Room', group: 'Booking' },
  { key: 'facility_name', label: 'Facility name', sample: 'Steam Room (Male)', group: 'Booking' },
  { key: 'booking_date', label: 'Booking date', sample: '16 Sep 2026', group: 'Booking' },
  { key: 'booking_time', label: 'Booking time', sample: '7:30 PM', group: 'Booking' },
  { key: 'slot_date', label: 'Slot date', sample: '16 Sep 2026', group: 'Booking' },
  { key: 'slot_time', label: 'Slot time', sample: '7:30 PM', group: 'Booking' },
  { key: 'class_name', label: 'Class name', sample: 'Morning Pilates', group: 'Booking' },
  { key: 'class_date', label: 'Class date', sample: '17 Sep 2026', group: 'Booking' },
  { key: 'class_time', label: 'Class time', sample: '07:00 AM', group: 'Booking' },
  { key: 'cancellation_policy', label: 'Cancellation policy', sample: '2 hours before', group: 'Booking' },

  // Coaching
  { key: 'trainer_name', label: 'Trainer name', sample: 'Coach Arjun', group: 'Coaching' },
  { key: 'session_name', label: 'Session name', sample: 'PT Session', group: 'Coaching' },
  { key: 'sessions_left', label: 'Sessions left', sample: '8', group: 'Coaching' },

  // Lead
  { key: 'lead_name', label: 'Lead name', sample: 'Priya Singh', group: 'Lead' },
  { key: 'lead_phone', label: 'Lead phone', sample: '+91 98765 43210', group: 'Lead' },
  { key: 'lead_source', label: 'Lead source', sample: 'Instagram', group: 'Lead' },

  // Document
  { key: 'document_link', label: 'Document link (PDF)', sample: 'https://…/invoice.pdf', group: 'Document' },
  { key: 'link', label: 'Action link', sample: 'https://theincline.in/…', group: 'Document' },

  // General
  { key: 'date', label: 'Date', sample: '16 Sep 2026', group: 'General' },
  { key: 'time', label: 'Time', sample: '7:30 PM', group: 'General' },
  { key: 'code', label: 'Verification code', sample: '482913', group: 'General' },
  { key: 'task_title', label: 'Task title', sample: 'Call back Priya', group: 'General' },
  { key: 'priority', label: 'Priority', sample: 'High', group: 'General' },
  { key: 'report_date', label: 'Report date', sample: '16 Sep 2026', group: 'General' },
];

export const VARIABLE_GROUPS = [
  'Recipient',
  'Membership',
  'Billing',
  'Booking',
  'Coaching',
  'Lead',
  'Document',
  'General',
] as const;

export function getPayloadVariable(key: string): PayloadVariable | undefined {
  const k = String(key || '').replace(/[{}]/g, '').trim().toLowerCase();
  return PAYLOAD_VARIABLES.find((v) => v.key === k);
}

/** Ordered keys the system actually sends for each known system event.
 *  Used to auto-fill the positional mapper with a correct default. */
export const EVENT_VARIABLE_ORDER: Record<string, string[]> = {
  member_created: ['member_name', 'plan_name', 'branch_name', 'member_code'],
  otp_verification: ['code', 'first_name'],
  membership_expiring_7d: ['member_name', 'plan_name', 'end_date', 'days_left'],
  membership_expiring_1d: ['member_name', 'plan_name', 'end_date', 'branch_name'],
  membership_expired: ['member_name', 'plan_name', 'end_date', 'branch_name'],
  membership_overdue: ['member_name', 'amount_due', 'due_date', 'branch_name'],
  freeze_confirmed: ['member_name', 'plan_name', 'date', 'branch_name'],
  unfreeze_confirmed: ['member_name', 'plan_name', 'date', 'branch_name'],

  payment_received: ['member_name', 'amount', 'invoice_number', 'date'],
  payment_due: ['member_name', 'amount_due', 'invoice_number', 'due_date'],
  invoice_generated: ['member_name', 'invoice_number', 'amount', 'document_link'],
  receipt_generated: ['member_name', 'amount', 'invoice_number', 'document_link'],
  pos_order_completed: ['member_name', 'amount', 'invoice_number', 'document_link'],

  class_booked: ['member_name', 'class_name', 'class_date', 'class_time'],
  class_reminder_24h: ['member_name', 'class_name', 'class_date', 'class_time'],
  facility_booked: ['member_name', 'benefit_name', 'booking_date', 'booking_time'],
  facility_cancelled: ['member_name', 'benefit_name', 'booking_date', 'booking_time'],
  pt_session_booked: ['member_name', 'trainer_name', 'date', 'time'],
  pt_session_reminder: ['member_name', 'trainer_name', 'date', 'time'],
  pt_session_logged: ['member_name', 'trainer_name', 'sessions_left', 'date'],
  benefit_consumed: ['member_name', 'benefit_name', 'date', 'branch_name'],
  benefit_low_balance: ['member_name', 'benefit_name', 'sessions_left', 'branch_name'],

  birthday: ['member_name', 'branch_name'],
  missed_workout_3d: ['member_name', 'branch_name'],
  body_scan_ready: ['member_name', 'date', 'document_link'],
  diet_plan_ready: ['member_name', 'trainer_name', 'document_link'],
  workout_plan_ready: ['member_name', 'trainer_name', 'document_link'],
  task_assigned: ['recipient_name', 'task_title', 'priority', 'due_date'],

  retention_stage_1: ['member_name', 'branch_name'],
  retention_stage_2: ['member_name', 'branch_name'],
  retention_stage_3: ['member_name', 'branch_name'],

  lead_created: ['lead_name', 'lead_phone', 'lead_source', 'branch_name'],
  lead_welcome: ['lead_name', 'branch_name'],
  lead_nurture_followup: ['lead_name', 'branch_name'],
};

const KEYWORD_HINTS: Array<[RegExp, string]> = [
  [/\b(hi|hello|hey|dear)\s*$/i, 'member_name'],
  [/\b(name)\s*[:\-]?\s*$/i, 'member_name'],
  [/\b(sauna|steam|ice bath|facility|benefit|recovery)\b/i, 'benefit_name'],
  [/\b(class|session)\b/i, 'class_name'],
  [/\b(trainer|coach)\b/i, 'trainer_name'],
  [/\b(plan|membership)\b/i, 'plan_name'],
  [/\b(invoice|receipt|bill no)\b/i, 'invoice_number'],
  [/(₹|rs\.?|inr|amount|paid|due amount)\s*$/i, 'amount'],
  [/\b(on|date|expires?|expiry|valid till)\b[^a-z]*$/i, 'date'],
  [/\b(at|time|from)\b[^a-z]*$/i, 'time'],
  [/\b(branch|club|studio)\b/i, 'branch_name'],
  [/\b(link|download|view)\b/i, 'document_link'],
];

/** Best-effort guess for a positional slot based on the words before it. */
export function guessKeyForSlot(content: string, slot: number): string | null {
  const marker = new RegExp(`\\{\\{\\s*${slot}\\s*\\}\\}`);
  const idx = content.search(marker);
  if (idx < 0) return null;
  const before = content.slice(Math.max(0, idx - 60), idx).toLowerCase();
  for (const [re, key] of KEYWORD_HINTS) {
    if (re.test(before)) return key;
  }
  return slot === 1 ? 'member_name' : null;
}

/** Positional slot numbers present in a template body, ascending. */
export function positionalSlots(content: string): number[] {
  const found = new Set<number>();
  for (const m of String(content || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/** Named {{placeholders}} present in a template body (non-numeric). */
export function namedPlaceholders(content: string): string[] {
  const out: string[] = [];
  for (const m of String(content || '').matchAll(/\{\{\s*([^}\d][^}]*?)\s*\}\}/g)) {
    const k = m[1].trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Build the ordered `templates.variables` array for a positional body. */
export function buildOrderedVariables(
  content: string,
  eventName: string | null | undefined,
  existing: string[] = [],
): string[] {
  const slots = positionalSlots(content);
  if (slots.length === 0) return namedPlaceholders(content);
  const suggested = (eventName && EVENT_VARIABLE_ORDER[eventName]) || [];
  const maxSlot = slots[slots.length - 1];
  const out: string[] = [];
  for (let i = 0; i < maxSlot; i++) {
    out.push(
      existing[i] ||
        suggested[i] ||
        guessKeyForSlot(content, i + 1) ||
        '',
    );
  }
  return out;
}
