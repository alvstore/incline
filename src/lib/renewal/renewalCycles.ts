/** Renewal Center cycle helpers — one open case per member; closed cycles are history. */
export type RenewalPeriod = 'month' | '30d' | '90d';

/** IST start date (YYYY-MM-DD) for an Outcomes period. */
export function periodSince(period: RenewalPeriod, now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  if (period === 'month') {
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  const days = period === '30d' ? 30 : 90;
  return new Date(ist.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export type UrgencyBucket = 'upcoming' | 'soon' | 'lapsed';
/** Green upcoming (>3 days), amber within 3 days (incl. today), red once lapsed. */
export function urgencyBucket(daysToExpiry: number): UrgencyBucket {
  if (daysToExpiry < 0) return 'lapsed';
  if (daysToExpiry <= 3) return 'soon';
  return 'upcoming';
}

/** "Cycle 3 · renewed 2x before" — null on a member's first cycle. */
export function cycleLabel(cycle: number | null | undefined, priorRenewals: number | null | undefined): string | null {
  const c = Number(cycle ?? 1);
  if (c <= 1) return null;
  const r = Number(priorRenewals ?? 0);
  return r > 0 ? `Cycle ${c} · renewed ${r}x before` : `Cycle ${c}`;
}

/** Cycles closed because a newer membership opened are history, never outcomes. */
export function isSuperseded(outcome: string | null | undefined): boolean {
  return outcome === 'superseded';
}
