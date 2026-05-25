/**
 * useMyShiftWeek
 *
 * Returns a 7-day strip (Mon→Sun) of a user's own shift for the current week,
 * merging `staff_shift_overrides` (per-date) over `staff_shifts` (recurring by weekday),
 * joined with `staff_attendance` to compute the first check-in per day and whether
 * the user was late vs. the scheduled start.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, addDays, format } from 'date-fns';

export const LATE_GRACE_MIN = 10;

export type ShiftSource = 'override' | 'recurring' | 'none';

export interface MyShiftDay {
  date: string;              // yyyy-MM-dd
  weekday: number;           // 0=Sun..6=Sat
  label: string;             // e.g. "Mon 26"
  source: ShiftSource;
  is_off: boolean;
  morning_start: string | null;
  morning_end: string | null;
  evening_start: string | null;
  evening_end: string | null;
  first_check_in: string | null; // ISO
  late_minutes: number | null;
  is_late: boolean;
}

function timeToMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function useMyShiftWeek(userId: string | null | undefined, anchor: Date = new Date()) {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 }); // Monday
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const startISO = format(days[0], 'yyyy-MM-dd');
  const endISO = format(days[6], 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['my-shift-week', userId, startISO],
    enabled: !!userId,
    queryFn: async (): Promise<MyShiftDay[]> => {
      const [{ data: recurring }, { data: overrides }, { data: attendance }] = await Promise.all([
        supabase
          .from('staff_shifts')
          .select('weekday, morning_start, morning_end, evening_start, evening_end, is_weekly_off')
          .eq('user_id', userId!),
        supabase
          .from('staff_shift_overrides')
          .select('date, morning_start, morning_end, evening_start, evening_end, is_weekly_off')
          .eq('user_id', userId!)
          .gte('date', startISO)
          .lte('date', endISO),
        supabase
          .from('staff_attendance')
          .select('check_in')
          .eq('user_id', userId!)
          .gte('check_in', `${startISO}T00:00:00`)
          .lte('check_in', `${endISO}T23:59:59`)
          .order('check_in', { ascending: true }),
      ]);

      const recurringByWd = new Map<number, any>();
      (recurring || []).forEach((r: any) => recurringByWd.set(r.weekday, r));
      const overrideByDate = new Map<string, any>();
      (overrides || []).forEach((o: any) => overrideByDate.set(o.date, o));
      const firstCheckByDate = new Map<string, string>();
      (attendance || []).forEach((a: any) => {
        const d = format(new Date(a.check_in), 'yyyy-MM-dd');
        if (!firstCheckByDate.has(d)) firstCheckByDate.set(d, a.check_in);
      });

      return days.map((d): MyShiftDay => {
        const iso = format(d, 'yyyy-MM-dd');
        const wd = d.getDay();
        const ov = overrideByDate.get(iso);
        const rec = recurringByWd.get(wd);
        const src = ov ? ov : rec;
        const source: ShiftSource = ov ? 'override' : rec ? 'recurring' : 'none';
        const is_off = !!src?.is_weekly_off || (!src?.morning_start && !src?.evening_start && source !== 'none');

        const morning_start = src?.morning_start ?? null;
        const morning_end = src?.morning_end ?? null;
        const evening_start = src?.evening_start ?? null;
        const evening_end = src?.evening_end ?? null;

        const checkIn = firstCheckByDate.get(iso) ?? null;
        let late_minutes: number | null = null;
        let is_late = false;
        if (checkIn && !is_off) {
          const schedStart = timeToMin(morning_start) ?? timeToMin(evening_start);
          if (schedStart != null) {
            const ci = new Date(checkIn);
            const ciMin = ci.getHours() * 60 + ci.getMinutes();
            const diff = ciMin - schedStart;
            late_minutes = diff;
            is_late = diff > LATE_GRACE_MIN;
          }
        }

        return {
          date: iso,
          weekday: wd,
          label: format(d, 'EEE dd'),
          source,
          is_off,
          morning_start,
          morning_end,
          evening_start,
          evening_end,
          first_check_in: checkIn,
          late_minutes,
          is_late,
        };
      });
    },
    refetchInterval: 60_000,
  });
}

export function fmtTime12(t: string | null | undefined): string | null {
  if (!t) return null;
  const [hStr, mStr] = t.slice(0, 5).split(':');
  let h = Number(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}
