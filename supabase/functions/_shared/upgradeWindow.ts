const DAY = 86_400_000;
export function upgradeWindowDay(windowEndsAt: string, now = new Date()): number {
  return Math.min(15, Math.max(1, 16 - Math.ceil((Date.parse(windowEndsAt) - now.getTime()) / DAY)));
}
export function upgradeTimeLeft(windowEndsAt: string, now = new Date()) {
  const milliseconds = Math.max(0, Date.parse(windowEndsAt) - now.getTime());
  return { milliseconds, days: Math.ceil(milliseconds / DAY), hours: Math.ceil(milliseconds / 3_600_000), expired: milliseconds === 0, percent: Math.min(100, Math.max(0, milliseconds / (15 * DAY) * 100)) };
}
export function upgradeReminderStage(startDate: string, deadline: string, membershipStatus: string, offerStatus: string, now = new Date()): 'd7' | 'd12' | null {
  if (membershipStatus !== 'active' || ['expired', 'converted'].includes(offerStatus) || now.getTime() >= Date.parse(deadline)) return null;
  const todayIST = new Date(now.getTime() + 19_800_000).toISOString().slice(0, 10);
  const day = Math.round((Date.parse(todayIST) - Date.parse(startDate.slice(0, 10))) / DAY) + 1;
  return day >= 12 ? 'd12' : day >= 7 ? 'd7' : null;
}
/** Elapsed timeline fills from start to deadline; countdown keeps remaining time. */
export function upgradeElapsedPercent(windowEndsAt: string, now = new Date()): number {
  return 100 - upgradeTimeLeft(windowEndsAt, now).percent;
}
export function upgradeReminderHandled(status: string | null | undefined, reason?: string | null): boolean {
  return ['sent', 'delivered', 'read', 'queued', 'sending', 'suppressed', 'clicked', 'replied'].includes(status ?? '') ||
    /131049|131026|132000|132001|do_not_contact|preference_block|template_not_approved/i.test(reason ?? '');
}