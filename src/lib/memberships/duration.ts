import { addDays, addMonths, addYears, differenceInCalendarDays, format, startOfDay } from 'date-fns';

/**
 * Single source of truth for membership period math.
 *
 * Month-based plans (30 / 90 / 180 / 365 days) are calendar periods, not fixed
 * day counts: a quarterly plan starting 31 Jul must end 30 Oct (inclusive),
 * not 28 Oct. Everything else falls back to an inclusive day count.
 */
export function membershipEndDate(startDate: string | Date, durationDays: number): Date {
  const start = startOfDay(typeof startDate === 'string' ? new Date(startDate) : startDate);

  switch (durationDays) {
    case 30:
      return addDays(addMonths(start, 1), -1);
    case 90:
      return addDays(addMonths(start, 3), -1);
    case 180:
      return addDays(addMonths(start, 6), -1);
    case 365:
      return addDays(addYears(start, 1), -1);
    default:
      return addDays(start, Math.max(durationDays - 1, 0));
  }
}

/** ISO (yyyy-MM-dd) end date for a plan starting on `startDate`. */
export function membershipEndDateISO(startDate: string | Date, durationDays: number): string {
  return format(membershipEndDate(startDate, durationDays), 'yyyy-MM-dd');
}

/**
 * Days of cover left, counted inclusively from the start of today.
 * A membership ending today reads 1 day, not 0.
 */
export function daysRemaining(endDate: string | Date | null | undefined): number | null {
  if (!endDate) return null;
  const end = startOfDay(typeof endDate === 'string' ? new Date(endDate) : endDate);
  return differenceInCalendarDays(end, startOfDay(new Date())) + 1;
}

/** Total inclusive length of a membership period, in days. */
export function membershipLengthDays(
  startDate: string | Date,
  endDate: string | Date,
): number {
  const start = startOfDay(typeof startDate === 'string' ? new Date(startDate) : startDate);
  const end = startOfDay(typeof endDate === 'string' ? new Date(endDate) : endDate);
  return differenceInCalendarDays(end, start) + 1;
}
