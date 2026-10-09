export interface AutomationSwitch { enabled?: boolean; paused?: boolean; is_active?: boolean; window_start?: string; window_end?: string; pause_reason?: string | null }
export function automationStatus(automation?: AutomationSwitch | null, scheduler?: { is_active?: boolean | null; last_status?: string | null; next_run_at?: string | null } | null, now = new Date()) {
  if (!automation || !scheduler) return 'unknown';
  if (automation.paused || scheduler.is_active === false) return 'paused';
  if (!automation.enabled || automation.is_active === false) return 'disabled';
  if (scheduler.last_status === 'error' || scheduler.last_status === 'failed') return 'attention';
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  if (time < (automation.window_start ?? '10:00') || time >= (automation.window_end ?? '19:00')) return 'outside';
  if (!scheduler.next_run_at || new Date(scheduler.next_run_at).getTime() < now.getTime() - 20 * 60_000) return 'attention';
  return 'scheduled';
}

export function voiceTime(value?: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}