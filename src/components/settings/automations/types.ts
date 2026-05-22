export type AutomationRule = {
  id: string;
  branch_id: string | null;
  key: string;
  name: string;
  description: string | null;
  category: string;
  worker: string;
  cron_expression: string;
  is_active: boolean;
  use_ai: boolean;
  ai_tone: string | null;
  target_filter: any;
  last_run_at: string | null;
  next_run_at: string;
  last_status: string | null;
  last_error: string | null;
  last_dispatched_count: number;
  is_system: boolean;
};

export type AutomationRun = {
  id: string;
  rule_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  dispatched_count: number;
  error_message: string | null;
};

export const CATEGORY_COLOR: Record<string, string> = {
  billing: 'bg-amber-100 text-amber-700',
  booking: 'bg-sky-100 text-sky-700',
  engagement: 'bg-violet-100 text-violet-700',
  lifecycle: 'bg-emerald-100 text-emerald-700',
  system: 'bg-slate-100 text-slate-700',
};

export const STATUS_COLOR: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  running: 'bg-sky-100 text-sky-700',
  skipped: 'bg-slate-100 text-slate-600',
};

// Deep-links: clicking the rule's "Open target" jumps to the page that owns its content.
export const RULE_DEEP_LINKS: Record<string, { label: string; href: string }> = {
  process_ig_comment_runs: { label: 'Manage IG campaigns', href: '/announcements?tab=instagram' },
  daily_send_reminders: { label: 'Reminder templates', href: '/settings?tab=communication-templates' },
  benefit_t2h_reminders: { label: 'Booking templates', href: '/settings?tab=communication-templates' },
  lead_nurture_followup: { label: 'Lead nurture settings', href: '/settings?tab=ai-agent' },
  run_retention_nudges: { label: 'Retention settings', href: '/settings?tab=communication-templates' },
  birthday_wish: { label: 'Birthday templates', href: '/settings?tab=communication-templates' },
  process_scheduled_campaigns: { label: 'Campaigns', href: '/announcements?tab=campaigns' },
  process_comm_retry_queue: { label: 'Communication logs', href: '/announcements?tab=logs' },
  process_whatsapp_retry_queue: { label: 'WhatsApp logs', href: '/announcements?tab=logs' },
};
