/**
 * Workout rotation helpers.
 *
 * Two independent mechanisms let one plan be given to many members without
 * every member queuing for the same machine on the same day:
 *
 *  1. **Day shift** (`schedule_offset_days`, 0-6) — the member's copy of the
 *     plan is rotated forward by N weekdays. Same sessions, different days.
 *  2. **Exercise rotation** (`rotation_interval_days`) — when the plan content
 *     carries `rotation.variants[]` (equivalent-exercise blocks), the viewer
 *     cycles to the next variant every N days from the plan start date.
 *
 * Everything here is pure so both the staff preview and the member portal can
 * reason about the exact same schedule.
 */

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface RotationSettings {
  /** 0-6 weekday shift applied to this member's copy of the plan. */
  offsetDays: number;
  /** 0 = no exercise rotation. */
  intervalDays: number;
  /** Per-member starting variant, so two members on the same shift differ. */
  seed: number;
  /** Plan start date (yyyy-MM-dd) — the rotation anchor. */
  startDate?: string | null;
}

export const DEFAULT_ROTATION: RotationSettings = {
  offsetDays: 0,
  intervalDays: 0,
  seed: 0,
};

/** Clamp any incoming value into a valid 0-6 weekday shift. */
export function normalizeOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((Math.trunc(n) % 7) + 7) % 7;
}

/** Shift a weekday index (0 = Sunday) forward by `offset` days. */
export function shiftWeekday(index: number, offset: number): number {
  return (index + normalizeOffset(offset)) % 7;
}

/**
 * Shift a workout day while preserving the authored Sunday contract. Plans
 * without an explicit Sunday workout rotate across Monday–Saturday only;
 * authored seven-day plans rotate across all seven days.
 */
export function shiftWorkoutWeekday(index: number, offset: number, includesSunday: boolean): number {
  const normalized = normalizeOffset(offset);
  if (includesSunday) return shiftWeekday(index, normalized);
  if (index === 0) return 0;
  return ((index - 1 + normalized) % 6) + 1;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function rawWeekdayIndex(day: unknown): number | null {
  const row = day as { day?: unknown; name?: unknown; title?: unknown } | null;
  const label = String(row?.day ?? row?.name ?? row?.title ?? '').toLowerCase();
  const index = DAY_NAMES.findIndex((name) => label.includes(name.toLowerCase()) || label.includes(name.slice(0, 3).toLowerCase()));
  return index >= 0 ? index : null;
}

function shiftDayRows(days: unknown[], offset: number): unknown[] {
  const includesSunday = days.some((day) => rawWeekdayIndex(day) === 0);
  return days
    .map((day) => {
      const index = rawWeekdayIndex(day);
      if (index === null || typeof day !== 'object' || day === null) return day;
      const shifted = shiftWorkoutWeekday(index, offset, includesSunday);
      const row = day as Record<string, unknown>;
      const labelKey = row.day !== undefined ? 'day' : row.name !== undefined ? 'name' : 'title';
      return { ...row, [labelKey]: DAY_NAMES[shifted], original_day: DAY_NAMES[index] };
    })
    .sort((a, b) => (rawWeekdayIndex(a) ?? 99) - (rawWeekdayIndex(b) ?? 99));
}

/** Move complete workout-day blocks without changing their exercise content. */
export function shiftWorkoutPlanDays(planData: unknown, offset: number): unknown {
  const normalized = normalizeOffset(offset);
  if (normalized === 0 || typeof planData !== 'object' || planData === null) return planData;
  const plan = planData as Record<string, unknown>;
  if (Array.isArray(plan.weeks)) {
    return {
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (typeof week !== 'object' || week === null) return week;
        const row = week as Record<string, unknown>;
        return { ...row, days: Array.isArray(row.days) ? shiftDayRows(row.days, normalized) : row.days };
      }),
    };
  }
  return Array.isArray(plan.days) ? { ...plan, days: shiftDayRows(plan.days, normalized) } : planData;
}

/** "No shift" / "+2 days (Mon → Wed)" — plain-language offset description. */
export function describeOffset(offset: number): string {
  const o = normalizeOffset(offset);
  if (o === 0) return 'No shift — original days';
  return `+${o} day${o === 1 ? '' : 's'} (Mon → ${WEEKDAY_SHORT[shiftWeekday(1, o)]})`;
}

/** Whole days between two ISO dates (negative before the start date). */
export function daysBetween(startISO: string, today: Date = new Date()): number {
  const [y, m, d] = startISO.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const start = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((now - start) / 86_400_000);
}

interface RotationBlock {
  variantIndex?: number;
  label?: string;
  days?: unknown[];
}

/** Rotation variant blocks embedded in the plan content, if any. */
export function rotationVariants(planData: unknown): RotationBlock[] {
  const rot = (planData as { rotation?: { variants?: unknown } } | null)?.rotation;
  const list = Array.isArray(rot?.variants) ? (rot?.variants as RotationBlock[]) : [];
  return list.filter((v) => Array.isArray(v?.days) && v.days!.length > 0);
}

/** Which variant block applies today, given the interval, seed and start date. */
export function activeVariantIndex(
  planData: unknown,
  settings: Partial<RotationSettings>,
  today: Date = new Date(),
): number {
  const variants = rotationVariants(planData);
  if (variants.length === 0) return 0;
  const interval = Number(settings.intervalDays) || 0;
  const seed = Number(settings.seed) || 0;
  if (interval <= 0) return ((seed % variants.length) + variants.length) % variants.length;
  const elapsed = settings.startDate ? Math.max(0, daysBetween(settings.startDate, today)) : 0;
  const step = Math.floor(elapsed / interval) + seed;
  return ((step % variants.length) + variants.length) % variants.length;
}

/**
 * Resolve the plan content the member should actually see today: the base plan,
 * or the currently active rotation block when one is configured.
 */
export function resolveRotatedPlan(
  planData: unknown,
  settings: Partial<RotationSettings>,
  today: Date = new Date(),
): { data: unknown; variantLabel: string | null; variantIndex: number; variantCount: number } {
  const variants = rotationVariants(planData);
  if (variants.length === 0) {
    return { data: planData, variantLabel: null, variantIndex: 0, variantCount: 0 };
  }
  const index = activeVariantIndex(planData, settings, today);
  const block = variants[index];
  return {
    data: { ...(planData as object), days: block.days, weeks: undefined },
    variantLabel: block.label || `Block ${String.fromCharCode(65 + index)}`,
    variantIndex: index,
    variantCount: variants.length,
  };
}

/** Days remaining before the next rotation block kicks in (null when off). */
export function daysUntilNextVariant(
  settings: Partial<RotationSettings>,
  today: Date = new Date(),
): number | null {
  const interval = Number(settings.intervalDays) || 0;
  if (interval <= 0 || !settings.startDate) return null;
  const elapsed = Math.max(0, daysBetween(settings.startDate, today));
  return interval - (elapsed % interval);
}

/**
 * Pick the least-loaded day shifts for a batch of members.
 * `load` maps offset → number of active plans already on that shift.
 */
export function suggestOffsets(load: Record<number, number>, memberCount: number): number[] {
  const counts = Array.from({ length: 7 }, (_, i) => ({ offset: i, count: load[i] ?? 0 }));
  const out: number[] = [];
  for (let i = 0; i < memberCount; i += 1) {
    counts.sort((a, b) => a.count - b.count || a.offset - b.offset);
    const pick = counts[0];
    out.push(pick.offset);
    pick.count += 1;
  }
  return out;
}
