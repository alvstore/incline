// memberChatPolicy.ts — v1.0.0
// Pure (no I/O) mapping from a member's real plan/account facts to what the
// chat (WhatsApp menu, WhatsApp AI, website chat) may offer. Facts come from
// the service-only `member_chat_status` RPC. Kept dependency-free so the
// frontend test runner can import it.

export type ChatFacts = {
  member_status: string | null;      // members.status
  login_disabled: boolean;
  today: string;                     // IST YYYY-MM-DD
  membership_id: string | null;
  membership_status: string | null;  // memberships.status
  start_date: string | null;
  end_date: string | null;
  plan_name: string | null;
  freeze_until: string | null;
  dues: number;
};

export type ChatState =
  | "active" | "expiring" | "expired" | "frozen" | "unpaid_start" | "no_plan" | "blocked";

export type ChatAction =
  | "membership" | "classes" | "recovery" | "balance" | "trainer" | "my_plans" | "request_plan"
  | "attendance" | "human" | "bills" | "renew" | "freeze" | "resume" | "see_plans";

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function classifyMemberChat(f: ChatFacts): ChatState {
  const ms = String(f.member_status ?? "").toLowerCase();
  if (f.login_disabled || ms === "suspended" || ms === "blacklisted") return "blocked";
  const st = String(f.membership_status ?? "").toLowerCase();
  if (!f.membership_id) return "no_plan";
  if (st === "frozen") return "frozen";
  if (st === "pending" || (st === "active" && f.start_date && f.start_date > f.today)) {
    return Number(f.dues) > 0 ? "unpaid_start" : "active";
  }
  if (st === "active" && f.end_date) {
    if (f.end_date < f.today) return "expired";
    return daysBetween(f.today, f.end_date) <= 7 ? "expiring" : "active";
  }
  if (st === "expired") return "expired";
  // cancelled / transferred / upgraded with nothing current → treat as no plan
  return "no_plan";
}

const FULL: ChatAction[] = [
  "membership", "classes", "recovery", "balance", "trainer", "my_plans", "request_plan",
  "attendance", "bills", "renew", "freeze", "human",
];

export const ALLOWED: Record<ChatState, ChatAction[]> = {
  active: FULL,
  expiring: FULL,
  expired: ["membership", "renew", "bills", "attendance", "human"],
  frozen: ["membership", "resume", "bills", "attendance", "human"],
  unpaid_start: ["membership", "bills", "human"],
  no_plan: ["see_plans", "bills", "attendance", "human"],
  blocked: [],
};

export const canDo = (state: ChatState, action: ChatAction) => ALLOWED[state].includes(action);

/** AI tool names the member concierge may NOT call in each state. */
const BOOKING_TOOLS = [
  "book_class", "book_facility", "book_facility_slot", "book_pt_session",
  "get_available_slots", "find_facility_slots",
];
export function blockedAiTools(state: ChatState): string[] {
  switch (state) {
    case "active": case "expiring": return ["request_resume"];
    case "expired": return [...BOOKING_TOOLS, "request_freeze", "request_resume"];
    case "frozen": return [...BOOKING_TOOLS, "request_freeze", "renew_membership"];
    case "unpaid_start": return [...BOOKING_TOOLS, "request_freeze", "request_resume", "renew_membership"];
    case "no_plan": return [...BOOKING_TOOLS, "request_freeze", "request_resume"];
    case "blocked": return ["*"];
  }
}

export const inrText = (v: number) => `₹${Math.round(Number(v || 0)).toLocaleString("en-IN")}`;
const pretty = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "";

export const DESK_PHONE = "8298293003";

/** One-line status headline used by menus, AI context and website chat. */
export function statusHeadline(state: ChatState, f: ChatFacts, firstName: string): string {
  const plan = f.plan_name ?? "membership";
  switch (state) {
    case "active": return `Welcome back, ${firstName}! ✨`;
    case "expiring": {
      const d = f.end_date ? daysBetween(f.today, f.end_date) : 0;
      return `Welcome back, ${firstName}! Your ${plan} ends ${d <= 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`} (${pretty(f.end_date)}). Renew now so your access continues.`;
    }
    case "expired": return `Hi ${firstName}, your ${plan} ended on ${pretty(f.end_date)}. Renew to get back on the floor.`;
    case "frozen": return `Hi ${firstName}, your ${plan} is paused${f.freeze_until ? ` until ${pretty(f.freeze_until)}` : ""}. Bookings open again once it resumes.`;
    case "unpaid_start": return `Hi ${firstName}, your ${plan} starts once the balance of ${inrText(f.dues)} is paid.`;
    case "no_plan": return `Welcome back, ${firstName}! You don't have a membership running right now. We'd love to have you back.`;
    case "blocked": return blockedReply(firstName);
  }
}

export function blockedReply(firstName: string): string {
  return `Hi ${firstName}, for help with your account please contact our front desk on ${DESK_PHONE}. Our team will be happy to assist you.`;
}

/** Label passed to the AI instead of the old hard-coded "Active Member". */
export function aiStatusLabel(state: ChatState, f: ChatFacts): string {
  const plan = f.plan_name ? ` Plan: ${f.plan_name}.` : "";
  const dues = Number(f.dues) > 0 ? ` Outstanding dues: ${inrText(f.dues)}.` : "";
  const map: Record<ChatState, string> = {
    active: `ACTIVE member (valid till ${pretty(f.end_date)}).`,
    expiring: `ACTIVE member, plan ending ${pretty(f.end_date)} — renewal opportunity.`,
    expired: `EXPIRED member — plan ended ${pretty(f.end_date)}. Do not book classes or facilities; help them renew or pay dues.`,
    frozen: `FROZEN member — plan paused${f.freeze_until ? ` until ${pretty(f.freeze_until)}` : ""}. No bookings; they may request resume.`,
    unpaid_start: `UNPAID START — plan not started until dues are paid. No bookings; help them pay.`,
    no_plan: `FORMER/INACTIVE member with no running plan. No bookings; offer to connect them with the desk to choose a plan. Never quote public lead prices.`,
    blocked: `ACCOUNT ON HOLD — do not help; direct to front desk ${DESK_PHONE}.`,
  };
  return `${map[state]}${plan}${dues}`;
}
