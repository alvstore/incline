import type { PTMemberPackageRow } from './ptTypes';

const LIVE = new Set(['active', 'pending_payment']);

/** Returns the newer live package that continues `pkg` for the same member, if any. */
export function successorOf(pkg: PTMemberPackageRow, rows: PTMemberPackageRow[]): PTMemberPackageRow | null {
  if (!pkg.member_id) return null;
  const end = new Date(pkg.expiry_date).getTime();
  let best: PTMemberPackageRow | null = null;
  for (const r of rows) {
    if (r.id === pkg.id || r.member_id !== pkg.member_id || !LIVE.has(r.status ?? '')) continue;
    if (new Date(r.expiry_date).getTime() < end) continue;
    if (!best || new Date(r.expiry_date).getTime() > new Date(best.expiry_date).getTime()) best = r;
  }
  return best;
}

/** Index rows by member for O(1) successor lookup. */
export function buildSuccessorMap(rows: PTMemberPackageRow[]): Map<string, PTMemberPackageRow | null> {
  const byMember = new Map<string, PTMemberPackageRow[]>();
  rows.forEach((r) => { if (r.member_id) byMember.set(r.member_id, [...(byMember.get(r.member_id) ?? []), r]); });
  const out = new Map<string, PTMemberPackageRow | null>();
  rows.forEach((r) => out.set(r.id, successorOf(r, byMember.get(r.member_id ?? '') ?? [])));
  return out;
}

/** A successor that starts after `pkg` ends (i.e. a queued renewal). */
export function queuedRenewalOf(pkg: PTMemberPackageRow, succ: PTMemberPackageRow | null): PTMemberPackageRow | null {
  if (!succ?.start_date) return null;
  return new Date(succ.start_date).getTime() > new Date(pkg.start_date || pkg.created_at || 0).getTime() ? succ : null;
}
