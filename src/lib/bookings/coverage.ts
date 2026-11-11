/** Membership coverage rules shared by member booking and request screens. */

/** Today's date (YYYY-MM-DD) in India time. */
export function istTodayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

/** A day is covered when it falls on or before the membership end date. */
export function isDayCovered(dayKey: string, membershipEnd: string | null | undefined): boolean {
  if (!membershipEnd) return false;
  return dayKey <= String(membershipEnd).slice(0, 10);
}

/** True when the member has no membership or it ended before today (IST). */
export function hasMembershipEnded(membershipEnd: string | null | undefined, now: Date = new Date()): boolean {
  return !membershipEnd || String(membershipEnd).slice(0, 10) < istTodayKey(now);
}

/** Turn a server refusal into a friendly sentence (drops the internal code prefix). */
export function friendlyError(message: string | undefined | null, fallback: string): string {
  if (!message) return fallback;
  return message.replace(/^membership_not_covering_date:\s*/, '');
}
