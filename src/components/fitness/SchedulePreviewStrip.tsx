import { useMemo } from 'react';
import { shiftWorkoutPlanDays } from '@/lib/fitness/planRotation';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Monday-first display order. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

interface Cell {
  focus: string | null;
  exercises: number;
}

function weekdayIndexOf(row: any): number | null {
  const label = String(row?.day ?? row?.name ?? row?.title ?? '').toLowerCase();
  const idx = DAY_NAMES.findIndex(
    (n) => label.includes(n.toLowerCase()) || label.includes(n.slice(0, 3).toLowerCase()),
  );
  return idx >= 0 ? idx : null;
}

function firstWeekDays(content: unknown): any[] {
  const c = (content ?? {}) as any;
  if (Array.isArray(c.weeks) && c.weeks.length > 0) return Array.isArray(c.weeks[0]?.days) ? c.weeks[0].days : [];
  return Array.isArray(c.days) ? c.days : [];
}

interface Props {
  /** Raw plan content (workout). */
  content: unknown;
  /** 0-6 weekday shift applied to this member's copy. */
  offset: number;
}

/**
 * Compact Mon→Sun strip showing what a member's week looks like after the
 * floor-load day shift is applied. Purely presentational.
 */
export function SchedulePreviewStrip({ content, offset }: Props) {
  const cells = useMemo(() => {
    const shifted = shiftWorkoutPlanDays(content, offset);
    const map = new Map<number, Cell>();
    for (const row of firstWeekDays(shifted)) {
      const idx = weekdayIndexOf(row);
      if (idx === null) continue;
      const exercises = Array.isArray(row?.exercises) ? row.exercises.length : 0;
      const focus = row?.focus || row?.muscle_group || row?.split || null;
      map.set(idx, { focus: focus ? String(focus) : null, exercises });
    }
    return map;
  }, [content, offset]);

  return (
    <div className="grid grid-cols-7 gap-1">
      {ORDER.map((idx) => {
        const cell = cells.get(idx);
        const rest = !cell || cell.exercises === 0 || /rest|off/i.test(cell.focus || '');
        return (
          <div
            key={idx}
            className={`rounded-lg px-1 py-1.5 text-center ${
              rest ? 'bg-muted/50 text-muted-foreground' : 'bg-primary/10 text-primary'
            }`}
            title={cell?.focus || 'Rest'}
          >
            <div className="text-[10px] uppercase tracking-wide opacity-70">{SHORT[idx]}</div>
            <div className="truncate text-[11px] font-semibold leading-tight">
              {rest ? 'Rest' : cell?.focus || `${cell?.exercises} ex`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
