// Browser lock screens use event descriptions, never raw inbox text containing private data.
const TEAM_ALERTS: Record<string, [string, string, string]> = {
  staff_late: ['Staff late check-in', 'A staff check-in was flagged as late. Open Attendance to review.', '/attendance-dashboard'],
  task_overdue: ['Task overdue', 'A task has passed its deadline. Open Tasks to follow up.', '/tasks'],
  task_assigned: ['Task assigned', 'A task has been assigned to you. Open Tasks to review.', '/tasks'],
  task: ['Task update', 'A front-desk task needs attention. Open Tasks to review.', '/tasks'],
  approval: ['Approval pending', 'A request is awaiting approval. Open Approvals to review.', '/approvals'],
  pt_client_checkin: ['PT client check-in', 'A personal-training client has checked in. Open PT Sessions to review.', '/pt-sessions'],
  pt_attendance: ['PT attendance alert', 'A personal-training attendance item needs review. Open Attendance.', '/attendance-dashboard?tab=pt'],
  pt_session: ['PT session update', 'A personal-training session has an update. Open PT Sessions to review.', '/pt-sessions'],
  pt_payment: ['PT payment update', 'A personal-training payment has an update. Open Invoices to review.', '/invoices'],
  payment: ['Payment update', 'A payment has been recorded or updated. Open Invoices to review.', '/invoices'],
  retention: ['Member follow-up', 'A member follow-up needs attention. Open Members to review.', '/members'],
  member: ['Member update', 'A member record has an update. Open Members to review.', '/members'],
  lead: ['Enquiry update', 'An enquiry has an update. Open Leads to review.', '/leads'],
  voice_ai: ['AI call update', 'An outreach call has an update. Open Voice AI to review.', '/voice-ai'],
};

export function browserPushPresentation(notice: { category?: unknown; title?: unknown; action_url?: unknown }, isTeam: boolean, member: boolean) {
  const category = typeof notice.category === 'string' ? notice.category.toLowerCase().trim() : '';
  const key = Object.keys(TEAM_ALERTS).find(k => category === k || category.startsWith(`${k}_`));
  const alert = isTeam && key ? TEAM_ALERTS[key] : undefined;
  const home = alert?.[2] ?? (isTeam ? '/dashboard' : member ? '/member-dashboard' : '/trainer-dashboard');
  const rawUrl = notice.action_url;
  const url = typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//') && !/[\\\r\n]/.test(rawUrl) ? rawUrl : home;
  if (notice.title === 'Browser notification test') {
    return { title: 'Incline · Notification test', body: 'Browser notifications are enabled. Tap to open Incline.', url };
  }
  return {
    title: alert ? `Incline · ${alert[0]}` : 'Incline · New notification',
    body: alert?.[1] ?? 'A new notification is available. Open Incline to view the details.',
    url,
  };
}