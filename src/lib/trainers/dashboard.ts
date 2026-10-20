import { addDaysKey, istDateKey } from '@/lib/classes/schedule';

/** Gate label for the duty card. Raw hardware serials are never shown. */
export function gateLabel(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return 'the gate';
  // Serial-like: long run of hex/digits with no spaces (e.g. F06D92740D0062CF).
  if (/^[0-9A-F]{8,}$/i.test(v) || (!/\s/.test(v) && /\d/.test(v) && v.length >= 10)) return 'the gate';
  return v;
}

export interface DayBucket<T> { key: string; items: T[] }

/** Next `days` IST dates (starting today) with the classes falling on each. */
export function groupClassesByDay<T extends { scheduled_at: string }>(
  classes: readonly T[], now: Date = new Date(), days = 7,
): DayBucket<T>[] {
  const today = istDateKey(now);
  const buckets: DayBucket<T>[] = Array.from({ length: days }, (_, i) => ({ key: addDaysKey(today, i), items: [] }));
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const c of classes) index.get(istDateKey(c.scheduled_at))?.items.push(c);
  for (const b of buckets) b.items.sort((a, z) => a.scheduled_at.localeCompare(z.scheduled_at));
  return buckets;
}

export function initials(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
