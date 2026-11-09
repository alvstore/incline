import type { AuditRowLike } from './humanize';

export interface FoldableAuditRow extends AuditRowLike {
  id: string;
  created_at: string;
  record_id?: string | null;
  branch_id?: string | null;
  ip_address?: string | null;
}

export interface AuditEventGroup<T extends FoldableAuditRow> {
  row: T;
  occurrences: T[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Exact event identity; no audit payload fields are discarded to create a match. */
export function foldRepeats<T extends FoldableAuditRow>(rows: T[]): AuditEventGroup<T>[] {
  const groups: AuditEventGroup<T>[] = [];
  const latestByIdentity = new Map<string, AuditEventGroup<T>>();
  const ordered = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
  for (const row of ordered) {
    const { id, created_at, ...identity } = row;
    const key = canonical(identity);
    const previous = latestByIdentity.get(key);
    const elapsed = previous ? Date.parse(previous.row.created_at) - Date.parse(created_at) : Infinity;
    if (previous && elapsed >= 0 && elapsed <= 60_000) {
      previous.occurrences.push(row);
    } else {
      const group = { row, occurrences: [row] };
      groups.push(group);
      latestByIdentity.set(key, group);
    }
  }
  return groups;
}