const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** Three-letter lowercase weekday key for a `yyyy-MM-dd` date string (no timezone drift). */
export function dayKeyFromDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function facilityDays(available?: string[] | null): string[] {
  return available && available.length ? available : ALL_DAYS;
}

/** True when the facility runs on the given `yyyy-MM-dd` date. */
export function facilityRunsOn(available: string[] | null | undefined, dateStr: string): boolean {
  return facilityDays(available).includes(dayKeyFromDateString(dateStr));
}

/** "Mon / Wed / Fri" — ordered Mon→Sun for display. */
export function scheduleLabel(available?: string[] | null): string {
  const days = facilityDays(available);
  return ALL_DAYS.filter((d) => days.includes(d)).map((d) => DAY_LABELS[d]).join(' / ');
}
