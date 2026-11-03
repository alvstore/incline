import { liveSampleFor } from './dlt';
// Single source of truth for template trigger events and the variables
// they emit. Used by both the template editor (preview/validation) and
// notification edge functions (variable substitution).

export type EventVariable = {
  key: string; // e.g. "member_name"
  label: string;
  sample: string;
};

export type TemplateEvent = {
  id: string; // matches templates.trigger / trigger_event
  label: string;
  category: 'lifecycle' | 'billing' | 'booking' | 'engagement' | 'lead';
  variables: EventVariable[];
};

const COMMON: EventVariable[] = [
  { key: 'member_name', label: 'Member Name', sample: 'Ryan Lekhari' },
  { key: 'member_code', label: 'Member Code', sample: 'INC-01-100' },
  { key: 'branch_name', label: 'Branch Name', sample: 'Incline Main' },
];

export const TEMPLATE_EVENTS: TemplateEvent[] = [
  {
    id: 'welcome',
    label: 'Welcome Message',
    category: 'lifecycle',
    variables: [...COMMON, { key: 'plan_name', label: 'Plan', sample: 'Annual Premium' }],
  },
  {
    id: 'expiry_reminder',
    label: 'Membership Expiry Reminder',
    category: 'lifecycle',
    variables: [
      ...COMMON,
      { key: 'days_left', label: 'Days Left', sample: '7' },
      { key: 'end_date', label: 'End Date', sample: '15 May 2026' },
      { key: 'plan_name', label: 'Plan', sample: 'Annual Premium' },
    ],
  },
  {
    id: 'payment_received',
    label: 'Payment Received',
    category: 'billing',
    variables: [
      ...COMMON,
      { key: 'amount', label: 'Amount', sample: '₹4,000' },
      { key: 'invoice_number', label: 'Invoice #', sample: 'MAIN-00001' },
      { key: 'date', label: 'Date', sample: '26 Apr 2026' },
    ],
  },
  {
    id: 'payment_due',
    label: 'Payment Due',
    category: 'billing',
    variables: [
      ...COMMON,
      { key: 'amount', label: 'Amount Due', sample: '₹4,000' },
      { key: 'invoice_number', label: 'Invoice #', sample: 'MAIN-00001' },
      { key: 'due_date', label: 'Due Date', sample: '30 Apr 2026' },
    ],
  },
  {
    id: 'birthday',
    label: 'Birthday Wishes',
    category: 'engagement',
    variables: COMMON,
  },
  {
    id: 'class_reminder',
    label: 'Class Reminder',
    category: 'booking',
    variables: [
      ...COMMON,
      { key: 'class_name', label: 'Class Name', sample: 'Morning Pilates' },
      { key: 'date', label: 'Date', sample: '27 Apr 2026' },
      { key: 'time', label: 'Time', sample: '07:00' },
      { key: 'trainer_name', label: 'Trainer', sample: 'Coach Arjun' },
    ],
  },
  {
    id: 'pt_session',
    label: 'PT Session Reminder',
    category: 'booking',
    variables: [
      ...COMMON,
      { key: 'trainer_name', label: 'Trainer', sample: 'Coach Arjun' },
      { key: 'date', label: 'Date', sample: '27 Apr 2026' },
      { key: 'time', label: 'Time', sample: '07:00' },
    ],
  },
  {
    id: 'facility_slot_booked',
    label: 'Facility Slot Booked',
    category: 'booking',
    variables: [
      ...COMMON,
      { key: 'benefit_name', label: 'Benefit', sample: 'Sauna' },
      { key: 'date', label: 'Date', sample: '27 Apr 2026' },
      { key: 'time', label: 'Time', sample: '07:00 - 07:30' },
    ],
  },
  {
    id: 'facility_slot_cancelled',
    label: 'Facility Slot Cancelled',
    category: 'booking',
    variables: [
      ...COMMON,
      { key: 'benefit_name', label: 'Benefit', sample: 'Sauna' },
      { key: 'date', label: 'Date', sample: '27 Apr 2026' },
      { key: 'time', label: 'Time', sample: '07:00 - 07:30' },
      { key: 'reason', label: 'Reason', sample: 'Member request' },
    ],
  },
  {
    id: 'lead_welcome',
    label: 'Lead Welcome',
    category: 'lead',
    variables: [
      { key: 'lead_name', label: 'Lead Name', sample: 'Priya Singh' },
      { key: 'branch_name', label: 'Branch Name', sample: 'Incline Main' },
    ],
  },
  {
    id: 'team_alert',
    label: 'Team Alert (New Lead)',
    category: 'lead',
    variables: [
      { key: 'lead_name', label: 'Lead Name', sample: 'Priya Singh' },
      { key: 'lead_phone', label: 'Lead Phone', sample: '+91 98765 43210' },
      { key: 'lead_source', label: 'Source', sample: 'WhatsApp' },
    ],
  },
  {
    id: 'body_scan_ready',
    label: 'Body Scan Ready',
    category: 'engagement',
    variables: [
      ...COMMON,
      { key: 'weight', label: 'Weight (kg)', sample: '72.4' },
      { key: 'bmi', label: 'BMI', sample: '23.8' },
      { key: 'body_fat', label: 'Body Fat %', sample: '18.2' },
      { key: 'health_score', label: 'Health Score', sample: '82' },
      { key: 'scan_date', label: 'Scan Date', sample: '29 Apr 2026' },
      { key: 'report_url', label: 'Report URL', sample: 'https://...' },
    ],
  },
  {
    id: 'posture_scan_ready',
    label: 'Posture Scan Ready',
    category: 'engagement',
    variables: [
      ...COMMON,
      { key: 'posture_type', label: 'Posture Type', sample: 'Forward Head' },
      { key: 'body_slope', label: 'Body Slope', sample: '2.1' },
      { key: 'scan_date', label: 'Scan Date', sample: '29 Apr 2026' },
      { key: 'report_url', label: 'Report URL', sample: 'https://...' },
    ],
  },
  {
    id: 'scan_ready_internal',
    label: 'Scan Ready (Internal Alert)',
    category: 'engagement',
    variables: [
      { key: 'member_name', label: 'Member Name', sample: 'Ryan Lekhari' },
      { key: 'member_code', label: 'Member Code', sample: 'INC-01-100' },
      { key: 'kind', label: 'Scan Kind', sample: 'body' },
      { key: 'scan_date', label: 'Scan Date', sample: '29 Apr 2026' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom / Broadcast',
    category: 'engagement',
    variables: COMMON,
  },
];

export const VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function getEvent(id: string | undefined | null) {
  return TEMPLATE_EVENTS.find((e) => e.id === id);
}

export function extractVariables(content: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_REGEX);
  while ((m = re.exec(content)) !== null) out.add(m[1]);
  return [...out];
}

export type ValidationResult = {
  unknown: string[]; // vars used in body that aren't in event registry
  unused: string[]; // vars available for event but not used
  ok: boolean;
};

export function validateTemplate(content: string, eventId: string | undefined | null): ValidationResult {
  const used = extractVariables(content);
  const evt = getEvent(eventId || '');
  if (!evt) return { unknown: used, unused: [], ok: used.length === 0 };
  const allowed = new Set(evt.variables.map((v) => v.key));
  const unknown = used.filter((u) => !allowed.has(u));
  const unused = evt.variables.map((v) => v.key).filter((k) => !used.includes(k));
  return { unknown, unused, ok: unknown.length === 0 };
}

export function renderPreview(content: string, eventId: string | undefined | null): string {
  const evt = getEvent(eventId || '');
  const samples: Record<string, string> = {};
  if (evt) for (const v of evt.variables) samples[v.key] = v.sample;
  return content.replace(VARIABLE_REGEX, (_m, key) => samples[key] ?? liveSampleFor(key, eventId));
}
