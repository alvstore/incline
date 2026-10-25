/**
 * Membership validity labels for staff lists. Uses IST calendar days, never
 * 24-hour spans, so a plan starting tomorrow reads "Starts tomorrow" even
 * when it is created late in the evening.
 */
export type ValidityTone = 'healthy' | 'warning' | 'critical' | 'scheduled' | 'frozen' | 'expired' | 'none';

export interface ValidityDisplay {
  label: string;
  tone: ValidityTone;
  days: number | null;
}

export function istTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Whole calendar days from `fromISO` to `toISO` (yyyy-MM-dd). */
export function calendarDaysBetween(fromISO: string, toISO: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toISO) - toUtc(fromISO)) / 86_400_000);
}

export function membershipValidity(input: {
  status: string | null | undefined;
  startDate?: string | null;
  endDate?: string | null;
  todayISO?: string;
}): ValidityDisplay {
  const today = input.todayISO ?? istTodayISO();
  const { status, startDate, endDate } = input;

  if (status === 'scheduled' && startDate) {
    const d = calendarDaysBetween(today, startDate);
    if (d <= 0) return { label: 'Starts today', tone: 'scheduled', days: 0 };
    if (d === 1) return { label: 'Starts tomorrow', tone: 'scheduled', days: 1 };
    return { label: `Starts in ${d} days`, tone: 'scheduled', days: d };
  }
  if (status === 'frozen') return { label: 'Frozen', tone: 'frozen', days: null };
  if (!endDate || (status !== 'active')) return { label: 'No active plan', tone: 'none', days: null };

  const left = calendarDaysBetween(today, endDate) + 1; // inclusive: ends today = 1
  if (left <= 0) {
    const ago = -left + 1;
    return { label: ago <= 1 ? 'Expired today' : `Expired ${ago} days ago`, tone: 'expired', days: left };
  }
  if (left === 1) return { label: 'Last day today', tone: 'critical', days: 1 };
  const label = `${left} days left`;
  if (left <= 7) return { label, tone: 'critical', days: left };
  if (left <= 30) return { label, tone: 'warning', days: left };
  return { label, tone: 'healthy', days: left };
}
