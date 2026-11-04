export interface AttendanceDayRow {
  member_id: string;
  check_in: string;
}

export interface MemberStreak {
  streak: number;
  gapDays: number | null;
  lastVisit: string | null;
}

const DAY_MS = 86400000;
const istFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

export function streakWindow(date: string) {
  const start = new Date(`${date}T00:00:00+05:30`).getTime();
  return {
    from: new Date(start - 90 * DAY_MS).toISOString(),
    until: new Date(start + DAY_MS).toISOString(),
  };
}

// Stay below the Data API cap and exhaust every page before deriving badges.
export async function loadAttendancePages(
  fetchPage: (from: number, to: number) => Promise<AttendanceDayRow[]>,
): Promise<AttendanceDayRow[]> {
  const size = 500;
  const rows: AttendanceDayRow[] = [];
  for (let offset = 0; ; offset += size) {
    const page = await fetchPage(offset, offset + size - 1);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

export function calculateMemberStreaks(
  rows: AttendanceDayRow[], memberIds: string[], date: string,
): Record<string, MemberStreak> {
  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    const day = istFormatter.format(new Date(row.check_in));
    if (day > date) continue;
    const set = days.get(row.member_id) ?? new Set<string>();
    set.add(day);
    days.set(row.member_id, set);
  }
  const result: Record<string, MemberStreak> = {};
  for (const id of memberIds) {
    const set = days.get(id) ?? new Set<string>();
    let streak = 0;
    const cursor = new Date(`${date}T00:00:00Z`);
    while (set.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const prior = [...set].filter(day => day < date).sort().pop() ?? null;
    const gapDays = prior
      ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${prior}T00:00:00Z`)) / DAY_MS)
      : null;
    result[id] = { streak, gapDays, lastVisit: prior };
  }
  return result;
}