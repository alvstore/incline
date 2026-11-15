// Pure scoring for "usual visit time" ↔ trainer shift fit. Server returns raw data; ranking happens here.
export interface MatchMemberRow {
  member_id: string; member_code: string | null; name: string | null; phone: string | null;
  plan_name: string | null; visits: number; minutes: number[]; dows: number[]; last_visit: string | null;
}
export interface ShiftRow { weekday: number; off: boolean; ms: string | null; me: string | null; es: string | null; ee: string | null; st: string | null; et: string | null }
export interface MatchTrainerRow {
  trainer_id: string; name: string | null; avatar_url: string | null; max_clients: number;
  clients: number; weekly_off: string | null; shifts: ShiftRow[];
}
export type Confidence = 'strong' | 'some' | 'none';
export type DayPart = 'Morning' | 'Afternoon' | 'Evening' | 'Unknown';
export interface UsualWindow { start: number; end: number; days: number[]; confidence: Confidence; part: DayPart }
export interface TrainerFit { trainer: MatchTrainerRow; overlap: number; atCapacity: boolean; label: 'Best match' | 'Good' | 'Not on shift' | 'At capacity'; score: number }

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

export function confidenceFor(visits: number): Confidence {
  return visits >= 8 ? 'strong' : visits >= 3 ? 'some' : 'none';
}

export function usualWindow(m: Pick<MatchMemberRow, 'minutes' | 'dows' | 'visits'>): UsualWindow {
  const confidence = confidenceFor(m.visits);
  if (!m.minutes.length) return { start: 0, end: 0, days: [], confidence, part: 'Unknown' };
  const s = [...m.minutes].sort((a, b) => a - b);
  const start = pct(s, 0.25);
  const end = Math.max(pct(s, 0.75), start) + 60; // a session lasts ~1h after arrival
  const counts = new Array(7).fill(0);
  m.dows.forEach((d) => counts[d]++);
  const threshold = Math.max(1, m.dows.length / 14);
  const days = counts.map((c, i) => (c >= threshold ? i : -1)).filter((i) => i >= 0);
  const mid = pct(s, 0.5);
  const part: DayPart = mid < 12 * 60 ? 'Morning' : mid < 16 * 60 ? 'Afternoon' : 'Evening';
  return { start, end, days, confidence, part };
}

function shiftBlocks(t: MatchTrainerRow, day: number): [number, number][] {
  if (t.weekly_off && t.weekly_off.toLowerCase() === DAY_NAMES[day]) return [];
  const row = t.shifts.find((s) => s.weekday === day);
  if (!row || row.off) return [];
  const blocks: [number, number][] = [];
  for (const [a, b] of [[row.ms, row.me], [row.es, row.ee], [row.st, row.et]] as const) {
    const x = toMin(a), y = toMin(b);
    if (x != null && y != null && y > x) blocks.push([x, y]);
  }
  return blocks;
}

/** Share (0–1) of the member's usual window, across their usual days, during which the trainer is on shift. */
export function shiftOverlap(w: UsualWindow, t: MatchTrainerRow): number {
  if (!w.days.length || w.end <= w.start) return 0;
  let covered = 0;
  for (const d of w.days) {
    for (const [a, b] of shiftBlocks(t, d)) covered += Math.max(0, Math.min(b, w.end) - Math.max(a, w.start));
  }
  return Math.min(1, covered / ((w.end - w.start) * w.days.length));
}

export function rankTrainers(w: UsualWindow, trainers: MatchTrainerRow[]): TrainerFit[] {
  return trainers.map((t) => {
    const overlap = shiftOverlap(w, t);
    const atCapacity = t.clients >= t.max_clients;
    const spare = Math.max(0, 1 - t.clients / Math.max(1, t.max_clients));
    const score = atCapacity ? -1 + overlap : overlap * 0.8 + spare * 0.2;
    const label: TrainerFit['label'] = atCapacity ? 'At capacity' : overlap >= 0.8 ? 'Best match' : overlap >= 0.4 ? 'Good' : 'Not on shift';
    return { trainer: t, overlap, atCapacity, label, score };
  }).sort((a, b) => b.score - a.score);
}

export const fmtMin = (m: number) => {
  const h = Math.floor(m / 60) % 24, mm = m % 60, ap = h < 12 ? 'AM' : 'PM';
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
};
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function describeWindow(w: UsualWindow): string {
  if (!w.days.length) return 'No recent visits';
  const days = w.days.length === 7 ? 'daily' : w.days.length >= 5 && !w.days.includes(0) && w.days.length === 6 ? 'Mon–Sat' : w.days.map((d) => SHORT[d]).join(', ');
  return `${fmtMin(w.start)}–${fmtMin(w.end)} · ${days}`;
}
