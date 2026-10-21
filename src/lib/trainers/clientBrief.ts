import { NO_HEALTH_CONDITION } from '@/lib/registration/healthQuestions';

export interface ClientBrief {
  member_id: string;
  fitness_goals: string | null;
  fitness_level: string | null;
  health_conditions: string | null;
  dietary_preference: string | null;
  cuisine_preference: string | null;
  equipment_availability: string[] | null;
}

/** Split the comma-joined goals captured at registration into chips. */
export function goalList(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Real health conditions only — "None / no known conditions" and blanks don't count. */
export function healthFlags(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== NO_HEALTH_CONDITION && !/^none\b/i.test(s));
}

export const humanize = (v: string | null | undefined) =>
  v ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;
