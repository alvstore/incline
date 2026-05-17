// Canonical catalog of system events that can drive a templated message.
// Single source of truth for: TemplateCoverageMatrix, AIGenerateTemplatesDrawer,
// WhatsAppAutomations, and any future scheduler/edge-fn that needs to enumerate
// supported events.

export type EventChannel = 'whatsapp' | 'sms' | 'email';
export type EventCategory =
  | 'lifecycle'
  | 'billing'
  | 'booking'
  | 'engagement'
  | 'retention'
  | 'lead'
  | 'marketing'
  | 'document';

export interface SystemEvent {
  event: string;
  label: string;
  category: EventCategory;
  description: string;
  channels: EventChannel[];
  /** Suggested WhatsApp header type when proposing this template. */
  headerHint?: 'image' | 'document' | 'video';
}

const ALL: EventChannel[] = ['whatsapp', 'sms', 'email'];

export const SYSTEM_EVENTS: SystemEvent[] = [
  // ── Lifecycle ────────────────────────────────────────────────
  { event: 'member_created', label: 'New Member Welcome', category: 'lifecycle', description: 'When a new member is registered', channels: ALL },
  { event: 'otp_verification', label: 'OTP Verification Code', category: 'lifecycle', description: 'One-time code for self-onboarding (uses {{code}} variable)', channels: ['whatsapp', 'sms'] },
  { event: 'membership_expiring_7d', label: 'Membership Expiring (7 days)', category: 'lifecycle', description: '7 days before membership ends', channels: ALL },
  { event: 'membership_expiring_1d', label: 'Membership Expiring (Tomorrow)', category: 'lifecycle', description: '1 day before membership ends', channels: ALL },
  { event: 'membership_expired', label: 'Membership Expired', category: 'lifecycle', description: 'Membership has just expired', channels: ALL },
  { event: 'membership_overdue', label: 'Membership Overdue', category: 'lifecycle', description: 'Past grace period without renewal', channels: ALL },
  { event: 'freeze_confirmed', label: 'Membership Frozen', category: 'lifecycle', description: 'Membership freeze confirmation', channels: ALL },
  { event: 'unfreeze_confirmed', label: 'Membership Unfrozen', category: 'lifecycle', description: 'Membership unfreeze confirmation', channels: ALL },
  { event: 'staff_attendance_recorded', label: 'Staff Attendance Recorded (Manual)', category: 'lifecycle', description: 'Notify a staff member that someone with higher authority recorded their attendance manually (biometric-failure fallback). Vars: {{actor_name}} {{action}} {{time}} {{reason}}. Currently feature-flagged off.', channels: ['whatsapp', 'sms', 'email'] },

  // ── Billing & Documents ──────────────────────────────────────
  { event: 'payment_received', label: 'Payment Received', category: 'billing', description: 'A payment has been recorded', channels: ALL },
  { event: 'payment_due', label: 'Payment Due Reminder', category: 'billing', description: 'Pending dues reminder', channels: ALL },
  { event: 'invoice_generated', label: 'Invoice (PDF)', category: 'document', description: 'New invoice issued — sends PDF', channels: ALL, headerHint: 'document' },
  { event: 'receipt_generated', label: 'Payment Receipt (PDF)', category: 'document', description: 'Receipt for received payment — PDF', channels: ALL, headerHint: 'document' },
  { event: 'pos_order_completed', label: 'POS Order Receipt (PDF)', category: 'document', description: 'In-gym store / POS order receipt', channels: ALL, headerHint: 'document' },

  // ── Booking & Benefits ───────────────────────────────────────
  { event: 'class_booked', label: 'Class Booking Confirmation', category: 'booking', description: 'Member booked a class', channels: ALL },
  { event: 'class_reminder_24h', label: 'Class Reminder (24h)', category: 'booking', description: 'Day-before class reminder', channels: ALL },
  { event: 'class_schedule_weekly', label: 'Weekly Class Schedule', category: 'booking', description: 'Weekly class roster broadcast', channels: ALL },
  { event: 'facility_booked', label: 'Facility Slot Confirmed', category: 'booking', description: 'Sauna / pool / ice bath booking', channels: ALL },
  { event: 'facility_cancelled', label: 'Facility Slot Cancelled', category: 'booking', description: 'Facility booking cancelled', channels: ALL },
  { event: 'pt_session_booked', label: 'PT Session Booked', category: 'booking', description: 'Personal training session scheduled', channels: ALL },
  { event: 'pt_session_reminder', label: 'PT Session Reminder', category: 'booking', description: 'Reminder before a PT session', channels: ALL },
  { event: 'pt_session_logged', label: 'PT Session Logged (Receipt)', category: 'booking', description: 'Trainer marked a PT session done — sends a WhatsApp receipt with sessions left or plan expiry', channels: ALL },
  { event: 'benefit_consumed', label: 'Benefit Consumed', category: 'booking', description: 'A benefit/session was used', channels: ALL },
  { event: 'benefit_low_balance', label: 'Benefit Low Balance', category: 'booking', description: 'Few benefit sessions remaining', channels: ALL },

  // ── Engagement ───────────────────────────────────────────────
  { event: 'birthday', label: 'Birthday Wish', category: 'engagement', description: "On a member's birthday", channels: ALL },
  { event: 'missed_workout_3d', label: 'Missed Workout (3 days)', category: 'engagement', description: "Member hasn't visited in 3+ days", channels: ALL },
  { event: 'body_scan_ready', label: 'Body Scan Ready', category: 'engagement', description: 'New HOWBODY scan report available', channels: ALL, headerHint: 'document' },
  { event: 'diet_plan_ready', label: 'Diet Plan Ready (PDF)', category: 'document', description: 'Trainer published a diet plan', channels: ALL, headerHint: 'document' },
  { event: 'workout_plan_ready', label: 'Workout Plan Ready (PDF)', category: 'document', description: 'Trainer published a workout plan', channels: ALL, headerHint: 'document' },

  // ── Retention ────────────────────────────────────────────────
  { event: 'retention_nudge_t1', label: 'Retention Nudge (Tier 1)', category: 'retention', description: 'Smart nudge — gentle re-engagement', channels: ALL },
  { event: 'retention_nudge_t2', label: 'Retention Nudge (Tier 2)', category: 'retention', description: 'Smart nudge — escalated re-engagement', channels: ALL },
  { event: 'win_back_30d', label: 'Win-Back (30 days)', category: 'retention', description: 'Inactive 30+ days — recovery offer', channels: ALL },
  { event: 'retention_stage_1', label: 'Retention — Stage 1: Value Add', category: 'retention', description: '3-stage retention sequence — first nudge after member is absent (uses {{member_name}})', channels: ALL },
  { event: 'retention_stage_2', label: 'Retention — Stage 2: Reminder', category: 'retention', description: '3-stage retention sequence — escalated reminder (uses {{member_name}})', channels: ALL },
  { event: 'retention_stage_3', label: 'Retention — Stage 3: Win-back Offer', category: 'retention', description: '3-stage retention sequence — final win-back with offer (uses {{member_name}})', channels: ALL },

  // ── Lead ─────────────────────────────────────────────────────
  { event: 'lead_created', label: 'New Lead — Internal Alert', category: 'lead', description: 'Notify staff of a fresh lead', channels: ALL },
  { event: 'lead_welcome', label: 'Lead Welcome', category: 'lead', description: 'Greet a new prospect', channels: ALL },
  { event: 'lead_nurture_followup', label: 'AI Lead Nurture Follow-up', category: 'lead', description: 'Automated nurture follow-up message', channels: ALL },

  // ── Marketing ────────────────────────────────────────────────
  { event: 'class_promo', label: 'New Class Promo', category: 'marketing', description: 'Marketing — new class launch', channels: ['whatsapp', 'email'], headerHint: 'image' },
  { event: 'offer_announcement', label: 'Special Offer / Discount', category: 'marketing', description: 'Marketing — promotion / discount', channels: ['whatsapp', 'email'], headerHint: 'image' },
  { event: 'gym_closure_update', label: 'Gym Closure Notice', category: 'marketing', description: 'Operational closure announcement', channels: ALL },
  { event: 'referral_reward', label: 'Referral Reward Earned', category: 'marketing', description: 'Member earned a referral reward', channels: ALL },
  { event: 'monthly_newsletter', label: 'Monthly Newsletter', category: 'marketing', description: 'Marketing digest', channels: ['email'] },
];

export function getEventsForChannel(channel: EventChannel): SystemEvent[] {
  return SYSTEM_EVENTS.filter((e) => e.channels.includes(channel));
}

export function getSystemEvent(event: string): SystemEvent | undefined {
  return SYSTEM_EVENTS.find((e) => e.event === event);
}
