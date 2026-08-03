import {
  startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  addMonths, addQuarters, addYears, format, differenceInCalendarDays,
} from 'date-fns';

export type AttendanceRange = 'month' | 'quarter' | 'year' | 'all';

export const RANGE_TABS: { key: AttendanceRange; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
];

export interface RangeBounds {
  start: Date | null;
  end: Date;
  label: string;
}

/** Resolve the visible period for a range + anchor date. `start` is null for all-time. */
export function resolveBounds(range: AttendanceRange, anchor: Date): RangeBounds {
  switch (range) {
    case 'month':
      return { start: startOfMonth(anchor), end: endOfMonth(anchor), label: format(anchor, 'MMMM yyyy') };
    case 'quarter':
      return {
        start: startOfQuarter(anchor),
        end: endOfQuarter(anchor),
        label: `Q${Math.floor(anchor.getMonth() / 3) + 1} ${format(anchor, 'yyyy')}`,
      };
    case 'year':
      return { start: startOfYear(anchor), end: endOfYear(anchor), label: format(anchor, 'yyyy') };
    case 'all':
    default:
      return { start: null, end: new Date(), label: 'All time' };
  }
}

/** Step the anchor date forward/backward by one period of the current range. */
export function shiftAnchor(range: AttendanceRange, anchor: Date, direction: -1 | 1): Date {
  switch (range) {
    case 'month': return addMonths(anchor, direction);
    case 'quarter': return addQuarters(anchor, direction);
    case 'year': return addYears(anchor, direction);
    default: return anchor;
  }
}

export interface VisitRecord {
  id: string;
  check_in: string;
  check_out: string | null;
}

/** Map of yyyy-MM-dd → number of visits that day. */
export function visitsByDay(records: VisitRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of records) {
    const k = format(new Date(r.check_in), 'yyyy-MM-dd');
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/** Current streak (ending today or yesterday) and best streak across the given days. */
export function computeStreaks(days: Set<string>): { current: number; best: number } {
  if (days.size === 0) return { current: 0, best: 0 };
  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = differenceInCalendarDays(new Date(sorted[i]), new Date(sorted[i - 1]));
    run = gap === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const today = new Date();
  const last = new Date(sorted[sorted.length - 1]);
  const sinceLast = differenceInCalendarDays(today, last);
  let current = 0;
  if (sinceLast <= 1) {
    current = 1;
    for (let i = sorted.length - 1; i > 0; i--) {
      const gap = differenceInCalendarDays(new Date(sorted[i]), new Date(sorted[i - 1]));
      if (gap === 1) current++;
      else break;
    }
  }
  return { current, best };
}

export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}
