/** Date from which every sale/payment automatically stores the signed-in person. */
export const ACTOR_TRACKING_START = '2026-10-22';

/**
 * Label to show when a record has no person saved.
 * Older records say "Not recorded"; newer ones can only come from automatic flows.
 */
export function actorFallback(createdAt?: string | null, automaticLabel = 'Automatic (online / system)'): string {
  if (!createdAt) return 'Not recorded';
  return createdAt.slice(0, 10) < ACTOR_TRACKING_START ? 'Not recorded (before 22 Oct)' : automaticLabel;
}

/** Percent of the original price given as a manual discount, 2 decimals. */
export function discountPercent(discount: number, original: number): number {
  if (!original || original <= 0 || !discount) return 0;
  return Math.round((discount * 10000) / original) / 100;
}

/** Discounts above the branch's limit are allowed but flagged in the audit report. */
export function isHighDiscount(discount: number, original: number, limitPct = 10): boolean {
  return discountPercent(discount, original) > limitPct;
}
