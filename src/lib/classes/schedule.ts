import type { ClassSession, ClassShift } from '@/types/classEngine';

/** Weekday chips ordered Mon → Sun; `value` is the Postgres DOW (0 = Sunday). */
export const WEEKDAYS: ReadonlyArray<{ value: number; label: string; short: string }> = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
];

export const WEEKDAY_PRESETS: ReadonlyArray<{ label: string; days: number[] }> = [
  { label: 'Mon / Wed / Fri', days: [1, 3, 5] },
  { label: 'Tue / Thu / Sat', days: [2, 4, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Daily', days: [0, 1, 2, 3, 4, 5, 6] },
];

export const SHIFT_ORDER: ClassShift[] = ['morning', 'afternoon', 'evening'];

export const SHIFT_META: Record<ClassShift, { label: string; window: string }> = {
  morning: { label: 'Morning', window: 'Before 12 PM' },
  afternoon: { label: 'Afternoon', window: '12 PM – 4:30 PM' },
  evening: { label: 'Evening', window: 'After 4:30 PM' },
};

export const CLASS_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'yoga', label: 'Yoga' },
  { value: 'pilates', label: 'Pilates' },
  { value: 'hiit', label: 'HIIT' },
  { value: 'spin', label: 'Spin' },
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'dance', label: 'Dance / Zumba' },
  { value: 'mobility', label: 'Mobility & Stretch' },
  { value: 'other', label: 'Other' },
];

/** Mirrors `class_shift_for_time()` in the database. */
export function shiftForTime(hhmm: string): ClassShift {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const minutes = h * 60 + m;
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 16 * 60 + 30) return 'afternoon';
  return 'evening';
}

/** "07:00" or "07:00:00" → "7:00 AM". */
export function formatTime12(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const [hRaw, mRaw = '00'] = hhmm.split(':');
  const h = Number(hRaw);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mRaw.slice(0, 2)} ${suffix}`;
}

/** Sort weekdays Mon → Sun and label them compactly. */
export function formatDays(days: readonly number[] | null | undefined): string {
  if (!days || days.length === 0) return 'No days';
  const set = new Set(days);
  if (set.size === 7) return 'Daily';
  const isWeekdays = [1, 2, 3, 4, 5].every((d) => set.has(d)) && set.size === 5;
  if (isWeekdays) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return WEEKDAYS.filter((d) => set.has(d.value)).map((d) => d.short).join(' / ');
}

/** yyyy-MM-dd in Asia/Kolkata for an ISO timestamp. */
export function istDateKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "HH:mm" wall-clock time in Asia/Kolkata for an ISO timestamp. */
export function istTimeKey(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** Add N calendar days to a yyyy-MM-dd key without timezone drift. */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Postgres DOW (0 = Sunday) for a yyyy-MM-dd key. */
export function dowForKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Friendly label for a yyyy-MM-dd key: "Today", "Tomorrow" or "Wed, 24 Sep". */
export function labelForDateKey(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today';
  if (key === addDaysKey(todayKey, 1)) return 'Tomorrow';
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Next N dates (yyyy-MM-dd) a rule fires on, starting from `fromKey`. */
export function nextOccurrences(days: readonly number[], fromKey: string, count = 5, untilKey?: string | null): string[] {
  const out: string[] = [];
  if (!days.length) return out;
  let cursor = fromKey;
  for (let i = 0; i < 90 && out.length < count; i++) {
    if (untilKey && cursor > untilKey) break;
    if (days.includes(dowForKey(cursor))) out.push(cursor);
    cursor = addDaysKey(cursor, 1);
  }
  return out;
}

export function slotsLeft(session: Pick<ClassSession, 'capacity' | 'booked_count'>): number {
  return Math.max((session.capacity ?? 0) - (session.booked_count ?? 0), 0);
}

export function isSessionFull(session: Pick<ClassSession, 'capacity' | 'booked_count'>): boolean {
  return slotsLeft(session) === 0;
}

export function groupSessionsByShift<T extends { shift_type: ClassShift | null; scheduled_at: string }>(
  sessions: readonly T[],
): Array<{ shift: ClassShift; sessions: T[] }> {
  const buckets: Record<ClassShift, T[]> = { morning: [], afternoon: [], evening: [] };
  for (const s of sessions) {
    const shift = s.shift_type ?? shiftForTime(istTimeKey(s.scheduled_at));
    buckets[shift].push(s);
  }
  return SHIFT_ORDER
    .map((shift) => ({ shift, sessions: buckets[shift].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)) }))
    .filter((b) => b.sessions.length > 0);
}

export function sessionInstructor(session: Pick<ClassSession, 'trainer_name' | 'external_trainer_name'>): { name: string; isGuest: boolean } {
  if (session.trainer_name) return { name: session.trainer_name, isGuest: false };
  const guest = (session.external_trainer_name ?? '').trim();
  if (guest) return { name: guest, isGuest: true };
  return { name: 'Incline team', isGuest: false };
}
