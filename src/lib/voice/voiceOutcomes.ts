/**
 * Voice AI outcome/status presentation helpers.
 *
 * Display-only. Backend values are never rewritten — this maps the stored
 * `voice_call_attempts.status` / `disposition` values to labels and badge tokens.
 */

export type VoiceDisposition =
  | 'coming_back'
  | 'callback_requested'
  | 'not_interested'
  | 'wrong_person'
  | 'complaint'
  | 'needs_human'
  | 'no_clear_outcome'
  | 'no_answer'
  | 'failed';

export interface BadgeLook {
  label: string;
  className: string;
}

const DISPOSITIONS: Record<string, BadgeLook> = {
  coming_back:        { label: 'Coming back',      className: 'bg-emerald-100 text-emerald-700' },
  callback_requested: { label: 'Callback',         className: 'bg-indigo-100 text-indigo-700' },
  not_interested:     { label: 'Not interested',   className: 'bg-slate-100 text-slate-600' },
  wrong_person:       { label: 'Wrong person',     className: 'bg-amber-100 text-amber-700' },
  complaint:          { label: 'Complaint',        className: 'bg-red-100 text-red-700' },
  needs_human:        { label: 'Needs human',      className: 'bg-orange-100 text-orange-700' },
  no_clear_outcome:   { label: 'No clear outcome', className: 'bg-slate-100 text-slate-600' },
  no_answer:          { label: 'No answer',        className: 'bg-slate-100 text-slate-600' },
  failed:             { label: 'Failed',           className: 'bg-red-100 text-red-700' },
};

const STATUSES: Record<string, BadgeLook> = {
  queued:      { label: 'Queued',      className: 'bg-slate-100 text-slate-600' },
  initiated:   { label: 'Calling',     className: 'bg-blue-100 text-blue-700' },
  ringing:     { label: 'Ringing',     className: 'bg-blue-100 text-blue-700' },
  answered:    { label: 'Connected',   className: 'bg-emerald-100 text-emerald-700' },
  in_progress: { label: 'In progress', className: 'bg-blue-100 text-blue-700' },
  completed:   { label: 'Completed',   className: 'bg-emerald-100 text-emerald-700' },
  no_answer:   { label: 'No answer',   className: 'bg-slate-100 text-slate-600' },
  busy:        { label: 'Busy',        className: 'bg-amber-100 text-amber-700' },
  failed:      { label: 'Failed',      className: 'bg-red-100 text-red-700' },
  cancelled:   { label: 'Cancelled',   className: 'bg-slate-100 text-slate-600' },
};

const ACTION_STATES: Record<string, BadgeLook> = {
  open:        { label: 'Open',        className: 'bg-red-100 text-red-700' },
  in_progress: { label: 'In progress', className: 'bg-amber-100 text-amber-700' },
  completed:   { label: 'Completed',   className: 'bg-emerald-100 text-emerald-700' },
};

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function dispositionLook(value?: string | null): BadgeLook | null {
  if (!value) return null;
  return DISPOSITIONS[value] ?? { label: humanize(value), className: 'bg-slate-100 text-slate-600' };
}

export function statusLook(value?: string | null): BadgeLook {
  if (!value) return { label: 'Unknown', className: 'bg-slate-100 text-slate-600' };
  return STATUSES[value] ?? { label: humanize(value), className: 'bg-slate-100 text-slate-600' };
}

export function actionStateLook(value?: string | null): BadgeLook | null {
  if (!value) return null;
  return ACTION_STATES[value] ?? null;
}

export const LIVE_STATUSES = ['queued', 'initiated', 'ringing', 'answered', 'in_progress'];

export function isLiveStatus(status?: string | null): boolean {
  return !!status && LIVE_STATUSES.includes(status);
}

export const DISPOSITION_OPTIONS = Object.keys(DISPOSITIONS);
export const STATUS_OPTIONS = Object.keys(STATUSES);

export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(Number(seconds)));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
