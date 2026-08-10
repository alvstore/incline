/**
 * Normalises the many shapes a stored workout plan can take
 * (`{ days: [...] }` flat, or `{ weeks: [{ week, days: [...] }] }` periodised)
 * into one day list the member UI can render day-by-day or week-at-a-glance.
 */

export interface WorkoutExercise {
  name: string;
  sets: number;
  reps: string;
  rest?: string;
  notes?: string;
}

export interface WorkoutDay {
  /** Stable key, e.g. "w1-d2" */
  id: string;
  /** "Monday", "Day 2" … (already shifted when the member has a day shift) */
  dayLabel: string;
  /** The plan's own label before the member's day shift was applied. */
  originalDayLabel?: string;
  /** "Week 1" when the plan is periodised */
  weekLabel?: string;
  /** Muscle group / split focus when the plan provides one */
  focus?: string;
  isRest: boolean;
  exercises: WorkoutExercise[];
  /** 0 = Sunday … 6 = Saturday, when the day name maps to a weekday */
  weekdayIndex: number | null;
}

export interface NormalizedWorkoutPlan {
  days: WorkoutDay[];
  weeks: string[];
}

export interface NormalizeOptions {
  /** 0-6 weekday shift applied to this member's copy of the plan. */
  offsetDays?: number;
}


const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function weekdayIndexOf(label: string): number | null {
  const lower = (label || '').toLowerCase();
  const idx = WEEKDAYS.findIndex((d) => lower.includes(d) || lower.includes(d.slice(0, 3)));
  return idx >= 0 ? idx : null;
}

function toExercises(raw: any): WorkoutExercise[] {
  const list = Array.isArray(raw?.exercises) ? raw.exercises : [];
  return list.map((ex: any) => ({
    name: ex?.name || ex?.exercise || 'Exercise',
    sets: Number(ex?.sets) || 0,
    reps: String(ex?.reps ?? ex?.rep_range ?? ''),
    rest: ex?.rest ? String(ex.rest) : ex?.rest_seconds ? `${ex.rest_seconds}s` : undefined,
    notes: ex?.notes || ex?.tempo || ex?.cue || undefined,
  }));
}

function toDay(raw: any, id: string, weekLabel?: string): WorkoutDay {
  const dayLabel = raw?.day || raw?.name || raw?.title || 'Session';
  const focus = raw?.focus || raw?.muscle_group || raw?.split || undefined;
  const exercises = toExercises(raw);
  const isRest =
    exercises.length === 0 ||
    /rest|off/i.test(String(dayLabel)) ||
    /rest/i.test(String(focus || ''));

  return {
    id,
    dayLabel: String(dayLabel),
    weekLabel,
    focus: focus ? String(focus) : undefined,
    isRest,
    exercises,
    weekdayIndex: weekdayIndexOf(String(dayLabel)),
  };
}

export function normalizeWorkoutPlan(raw: any): NormalizedWorkoutPlan | null {
  if (!raw) return null;

  if (Array.isArray(raw.weeks) && raw.weeks.length > 0) {
    const days: WorkoutDay[] = [];
    const weeks: string[] = [];
    raw.weeks.forEach((wk: any, wi: number) => {
      const label = `Week ${wk?.week ?? wi + 1}`;
      weeks.push(label);
      (Array.isArray(wk?.days) ? wk.days : []).forEach((d: any, di: number) => {
        days.push(toDay(d, `w${wi}-d${di}`, label));
      });
    });
    if (!days.length) return null;
    return { days, weeks };
  }

  if (Array.isArray(raw.days) && raw.days.length > 0) {
    return {
      days: raw.days.map((d: any, di: number) => toDay(d, `d${di}`)),
      weeks: [],
    };
  }

  return null;
}

/** Total working sets across a day — used for the day summary line. */
export function totalSets(day: WorkoutDay): number {
  return day.exercises.reduce((sum, ex) => sum + (ex.sets || 0), 0);
}

/** Rough session length: ~3.5 min per working set, floored at 20 min. */
export function estimatedMinutes(day: WorkoutDay): number {
  if (day.isRest) return 0;
  return Math.max(20, Math.round(totalSets(day) * 3.5));
}
