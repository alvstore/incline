import type { PTSessionRow } from './ptTypes';
import { getISTDayRange } from '@/lib/utils/datetime';

/** Walk-in logs belong to today's timeline; only booked appointments belong ahead. */
export function splitSessionTimeline(sessions: PTSessionRow[], now = new Date()) {
  const { startISO, endISO } = getISTDayRange(now);
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  const sorted = [...sessions].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  return {
    today: sorted.filter(s => {
      const time = Date.parse(s.scheduled_at);
      return time >= start && time < end;
    }),
    upcoming: sorted.filter(s => s.status === 'scheduled' && Date.parse(s.scheduled_at) >= end),
  };
}