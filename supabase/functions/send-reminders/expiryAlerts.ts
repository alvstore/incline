// Pure helpers for in-app expired / grace alerts (tested in scripts/tests).
export const GRACE_DAYS = 7;

export type ExpiryAlertKind = "day" | "grace";

/** IST calendar date (YYYY-MM-DD) offset by `days` from `now`. */
export function istDate(now: Date, days = 0): string {
  const ist = new Date(now.getTime() + 5.5 * 3600_000 + days * 86_400_000);
  return ist.toISOString().slice(0, 10);
}

/** Which alert (if any) a membership ending on `endDate` gets today. */
export function expiryAlertKind(endDate: string, now: Date): ExpiryAlertKind | null {
  if (endDate === istDate(now)) return "day";
  if (endDate === istDate(now, -3)) return "grace"; // mid-grace nudge, once
  return null;
}

export function expiryAlertDedupeKey(membershipId: string, kind: ExpiryAlertKind): string {
  return `membership_expired:${membershipId}:${kind}`;
}

export function renewalInAppDedupeKey(caseId: string, stageKey: string): string {
  return `renewal_case:${caseId}:${stageKey}:in_app`;
}
