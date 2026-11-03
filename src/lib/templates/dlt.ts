// DLT (TRAI) helpers: convert Incline {{named}} SMS templates into the
// Smartping/DLT `{#var#}` format with per-variable type + sample tagging.
// The brand is always a variable ({{brand_name}}) because the DLT entity is
// registered under a different business name than the customer-facing brand.

import { getEvent } from './eventRegistry';

export type DltVarType = 'Alphanumeric' | 'NUMBER' | 'Phone Number' | 'URL' | 'Email';
export type DltCategory = 'TRANSACTIONAL' | 'SERVICE_IMPLICIT' | 'SERVICE_EXPLICIT' | 'PROMOTIONAL';

export const DLT_VAR_MAX = 40;
export const DLT_HEADERS = ['MCLGRG', 'INCLIF', 'MCSGRG'];
/** Sample shown to the DLT reviewer for {{brand_name}} — must match the DLT entity. */
export const DLT_BRAND_SAMPLE = 'Muscle Garaage';

export interface DltVariable {
  position: number;
  key: string;
  type: DltVarType;
  sample: string;
  tooLong: boolean;
}

const GENERIC_SAMPLES: Record<string, string> = {
  brand_name: DLT_BRAND_SAMPLE,
  member_name: 'Rajat Lekhari', name: 'Rajat Lekhari', assignee_name: 'Rajat Lekhari',
  member_code: 'INC-26-0101', branch_name: 'Udaipur', plan_name: 'Premium Monthly',
  amount: '2500', code: '482910', otp: '482910', days_left: '7',
  end_date: '15 Nov 2026', start_date: '02 Nov 2026', date: '15 Nov 2026', due_date: '15 Nov 2026',
  time: '07:00 AM', class_name: 'Yoga', facility_name: 'Sauna', invoice_number: 'INV-26-0101',
  task_title: 'Call member', priority: 'High', phone: '9887601200', support_phone: '9887601200',
  document_link: 'https://theincline.in/d/abc123', link: 'https://theincline.in/d/abc123',
  email: 'hello@theincline.in', sessions_left: '5', trainer_name: 'Gyaneshwar',
};

export function inferDltType(key: string): DltVarType {
  const k = key.toLowerCase();
  if (/(link|url)$/.test(k)) return 'URL';
  if (/email/.test(k)) return 'Email';
  if (/(phone|mobile|contact_number)/.test(k)) return 'Phone Number';
  if (/(^code$|otp|amount|count|days|sessions|qty|number_of)/.test(k)) return 'NUMBER';
  return 'Alphanumeric';
}

export function sampleFor(key: string, eventId?: string | null): string {
  if (key === 'brand_name') return DLT_BRAND_SAMPLE;
  const evt = getEvent(eventId);
  const fromEvt = evt?.variables.find((v) => v.key === key)?.sample;
  return fromEvt || GENERIC_SAMPLES[key] || key.replace(/_/g, ' ');
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Each placeholder occurrence becomes its own {#var#} (DLT is positional). */
export function toDlt(content: string, eventId?: string | null, opts: { category?: string | null; header?: string | null } = {}) {
  const variables: DltVariable[] = [];
  let sampleText = content;
  const dltContent = content.replace(VAR_RE, (_m, key: string) => {
    const sample = sampleFor(key, eventId);
    variables.push({ position: variables.length + 1, key, type: inferDltType(key), sample, tooLong: sample.length > DLT_VAR_MAX });
    return '{#var#}';
  });
  sampleText = content.replace(VAR_RE, (_m, key: string) => sampleFor(key, eventId));
  const issues = dltIssues(content, opts);
  if (variables.some((v) => v.tooLong)) issues.push(`A sample value is over ${DLT_VAR_MAX} characters.`);
  return { dltContent, sampleText, variables, issues, length: sampleText.length, segments: Math.max(1, Math.ceil(sampleText.length / 160)) };
}

/** Smartping guideline checks (template_guidelines.pdf, pages 7–8). */
export function dltIssues(content: string, opts: { category?: string | null; header?: string | null } = {}): string[] {
  const issues: string[] = [];
  if (!/\{\{\s*brand_name\s*\}\}/.test(content)) issues.push('Add {{brand_name}} — DLT requires the brand in every template.');
  if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(content)) issues.push('Remove emojis — DLT rejects them.');
  if (/incline/i.test(content.replace(VAR_RE, ''))) issues.push('Brand is hard-coded — use {{brand_name}} instead.');
  if (/ {2,}|\t|^ | $/m.test(content)) issues.push('Remove extra spaces — Smartping rejects double, leading or trailing spaces.');
  if (opts.category === 'TRANSACTIONAL') issues.push('Transactional is for banks only — use Service Implicit.');
  if (opts.category === 'PROMOTIONAL' && opts.header && !/^\d{6}$/.test(opts.header)) issues.push('Promotional SMS must use a numeric sender ID, not an alpha header.');
  return issues;
}

/** Collapse extra spaces so the template matches Smartping formatting rules. */
export function cleanDltSpaces(content: string): string {
  return content.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').split('\n').map((l) => l.trim()).join('\n').trim();
}

/** Tab-separated row for the Smartping sheet — ONE header per template (never the same content on many headers). */
export function toSmartpingRow(name: string, content: string, eventId?: string | null, header?: string | null) {
  const d = toDlt(content, eventId);
  const vars = d.variables.flatMap((v) => [v.type, v.sample]);
  return [name, header || DLT_HEADERS[0], d.dltContent.replace(/\n/g, ' '), d.sampleText.replace(/\n/g, ' '), String(d.variables.length), ...vars].join('\t');
}

/** Live (real-send) sample: brand resolves to Incline, never the DLT preview brand. */
export function liveSampleFor(key: string, eventId?: string | null): string {
  if (key === 'brand_name') return 'Incline';
  return sampleFor(key, eventId);
}

/** DLT gate: an SMS template may only be switched on once it is registered. */
export function smsActivationBlocker(t: { dlt_template_id?: string | null; dlt_header?: string | null }): string | null {
  const id = String(t.dlt_template_id || '').trim();
  if (!id) return 'Enter the approved DLT Template ID first';
  if (!/^\d{15,25}$/.test(id)) return 'DLT Template ID must be the numeric ID from the DLT portal';
  if (!String(t.dlt_header || '').trim()) return 'Choose the approved Header (Sender ID) first';
  return null;
}
