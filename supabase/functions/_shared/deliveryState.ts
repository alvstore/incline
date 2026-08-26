// deliveryState.ts v1.0.0
// PHASE 2 — the single client-side definition of the monotonic delivery
// lifecycle. The database mirrors this in `apply_campaign_recipient_status`.
//
//   pending → queued → dispatching → submitted → sent → delivered → read
//
// Terminal: failed | suppressed | cancelled | skipped
// `unknown` is NOT a success and never overwrites a confirmed provider outcome.

export type DeliveryState =
  | "pending" | "queued" | "dispatching" | "submitted" | "sent"
  | "delivered" | "read"
  | "failed" | "suppressed" | "cancelled" | "skipped" | "unknown";

const RANK: Record<string, number> = {
  pending: 0,
  queued: 1,
  dispatching: 1,
  submitted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  unknown: 50,
  failed: 90,
  suppressed: 90,
  cancelled: 90,
  skipped: 90,
};

export const CONFIRMED_STATES = ["delivered", "read"] as const;
export const TERMINAL_STATES = ["failed", "suppressed", "cancelled", "skipped"] as const;

export function rank(state: string | null | undefined): number {
  return RANK[String(state ?? "").toLowerCase()] ?? 0;
}

export function isTerminalState(state: string | null | undefined): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(String(state ?? "").toLowerCase());
}

/**
 * True when `next` is a legal forward transition from `current`.
 * Out-of-order provider callbacks (read → delivered, delivered → sent) are
 * rejected. Provider failures may override in-flight states but never a
 * confirmed delivered/read.
 */
export function mayAdvance(current: string | null | undefined, next: string | null | undefined): boolean {
  const c = String(current ?? "pending").toLowerCase();
  const n = String(next ?? "").toLowerCase();
  if (!n || n === c) return false;
  if (isTerminalState(n)) return !(CONFIRMED_STATES as readonly string[]).includes(c);
  if (n === "unknown") return rank(c) <= RANK.submitted;
  // `queued` and `dispatching` are both in-flight handoff states; moving
  // between them is legal, anything else must strictly advance.
  const lateral = (c === "dispatching" && n === "queued") || (c === "queued" && n === "dispatching");
  return lateral || rank(n) > rank(c);
}


/** Applies a transition, returning the resulting state. */
export function nextState(current: string | null | undefined, incoming: string): string {
  return mayAdvance(current, incoming) ? incoming : String(current ?? "pending");
}
