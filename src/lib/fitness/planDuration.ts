import { addDays, format, startOfDay } from 'date-fns';

/**
 * One-tap duration presets for fitness plan assignments.
 * Staff should never have to reason about calendar dates — they pick a
 * duration, we compute the inclusive end date.
 */
export interface DurationPreset {
  days: number;
  label: string;
}

export const PLAN_DURATION_PRESETS: DurationPreset[] = [
  { days: 7, label: '1 week' },
  { days: 15, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 45, label: '6 weeks' },
  { days: 60, label: '2 months' },
  { days: 75, label: '10 weeks' },
  { days: 90, label: '3 months' },
];

/** Inclusive end date: a 7-day plan starting today ends 6 days from today. */
export function planEndDate(startDate: string | Date, durationDays: number): Date {
  const start = startOfDay(typeof startDate === 'string' ? new Date(startDate) : startDate);
  return addDays(start, Math.max(durationDays - 1, 0));
}

/** ISO (yyyy-MM-dd) inclusive end date. */
export function planEndDateISO(startDate: string | Date, durationDays: number): string {
  return format(planEndDate(startDate, durationDays), 'yyyy-MM-dd');
}

/** Nearest preset for a plan whose own content spans `weeks` weeks. */
export function recommendedPresetDays(weeks: number): number {
  const target = Math.max(1, Math.round(weeks * 7));
  return PLAN_DURATION_PRESETS.reduce((best, p) =>
    Math.abs(p.days - target) < Math.abs(best.days - target) ? p : best,
  PLAN_DURATION_PRESETS[0]).days;
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
