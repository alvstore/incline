export interface MemberAttendanceIdentity {
  member_code?: string | null;
  profiles?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

export interface MemberAttendanceRecord {
  id: string;
  member_id: string;
  check_in: string;
  check_out: string | null;
  check_in_method?: string | null;
  check_out_method?: string | null;
  source?: string | null;
  members?: MemberAttendanceIdentity | null;
}

export interface ConsolidatedMemberVisit extends MemberAttendanceRecord {
  entries: MemberAttendanceRecord[];
  scanCount: number;
  firstCheckIn: string;
  lastCheckOut: string | null;
  isActive: boolean;
  sourceLabel: 'device' | 'manual' | 'force_entry' | 'mixed';
}

function sourceOf(record: MemberAttendanceRecord) {
  const source = record.check_in_method || record.source || 'manual';
  if (source === 'biometric') return 'device';
  if (source === 'force_entry') return 'force_entry';
  return source === 'device' ? 'device' : 'manual';
}

/**
 * The operations dashboard is a people view, not a raw turnstile log.
 * Keep every underlying row for audit detail while showing one presence window
 * per member for the selected day.
 */
export function consolidateMemberAttendance(
  records: MemberAttendanceRecord[],
): ConsolidatedMemberVisit[] {
  const grouped = new Map<string, MemberAttendanceRecord[]>();

  records.forEach((record) => {
    grouped.set(record.member_id, [...(grouped.get(record.member_id) || []), record]);
  });

  return Array.from(grouped.values())
    .map((group) => {
      const entries = [...group].sort(
        (a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
      );
      const first = entries[0];
      const openEntry = entries.find((entry) => !entry.check_out);
      const completedCheckOuts = entries
        .map((entry) => entry.check_out)
        .filter((value): value is string => Boolean(value));
      const lastCheckOut = openEntry
        ? null
        : completedCheckOuts.reduce<string | null>((latest, value) => {
            if (!latest) return value;
            return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
          }, null);
      const sources = new Set(entries.map(sourceOf));

      return {
        ...first,
        id: openEntry?.id || first.id,
        check_in: first.check_in,
        check_out: lastCheckOut,
        firstCheckIn: first.check_in,
        lastCheckOut,
        isActive: Boolean(openEntry),
        entries,
        scanCount: entries.length,
        sourceLabel: sources.size === 1 ? sources.values().next().value || 'manual' : 'mixed',
      };
    })
    .sort((a, b) => new Date(b.firstCheckIn).getTime() - new Date(a.firstCheckIn).getTime());
}