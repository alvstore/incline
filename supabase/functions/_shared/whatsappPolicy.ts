// whatsappPolicy.ts v1.0.0
// THE single WhatsApp send/retry policy layer.
//
// Everything that decides "may we send this?", "is this pacing?", "may we
// retry?" or "which route?" must call this module. It wraps — and does NOT
// duplicate — `metaErrorPolicy.ts` (Meta code semantics) and
// `deliveryState.ts` (monotonic lifecycle).
//
// Recipient-level marketing memory lives in `public.whatsapp_recipient_state`
// and is reached through three service-role RPCs:
//   record_whatsapp_pace_event(_phone,_code,_branch_id)  -> cooldown timestamp
//   record_whatsapp_marketing_event(_phone,_kind,_branch_id)
//   whatsapp_recipient_eligibility(_phones[],_category)  -> per-phone verdict
//
// Nothing here attempts to bypass Meta pacing: no template rotation, no
// category relabelling, no provider hopping to force a paced message through.

import {
  classifyMetaError,
  extractMetaCode,
  isTerminal,
  nextRetryAt,
  type MetaErrorPolicy,
} from "./metaErrorPolicy.ts";

// ── Message categories ───────────────────────────────────────────────────────
export type MessageCategory = "marketing" | "utility" | "authentication" | "service";

const UTILITY_CATEGORIES = new Set([
  "invoice", "payment_receipt", "payment_reminder", "membership", "booking",
  "class", "pt_session", "attendance", "transactional", "document", "report",
]);
const AUTH_CATEGORIES = new Set(["otp", "password_reset", "verification"]);
const SERVICE_CATEGORIES = new Set(["service", "conversation", "support", "reply"]);

/** Maps an app-level category onto the four Meta-facing message categories.
 *  Never widens marketing into utility — unknown categories stay marketing. */
export function resolveMessageCategory(category?: string | null): MessageCategory {
  const c = String(category ?? "").toLowerCase().trim();
  if (!c) return "marketing";
  if (AUTH_CATEGORIES.has(c)) return "authentication";
  if (SERVICE_CATEGORIES.has(c)) return "service";
  if (UTILITY_CATEGORIES.has(c)) return "utility";
  if (c === "marketing" || c === "promotional" || c === "campaign") return "marketing";
  return "marketing";
}

/** Meta template category (MARKETING/UTILITY/AUTHENTICATION) → our category. */
export function categoryFromTemplate(templateCategory?: string | null): MessageCategory | null {
  const t = String(templateCategory ?? "").toLowerCase().trim();
  if (t === "marketing") return "marketing";
  if (t === "utility") return "utility";
  if (t === "authentication") return "authentication";
  return null;
}

/** True when the declared purpose and the template's Meta category disagree.
 *  A mismatch must block the send — relabelling marketing as utility is abuse. */
export function categoryMismatch(
  declared: MessageCategory,
  templateCategory?: string | null,
): boolean {
  const fromTemplate = categoryFromTemplate(templateCategory);
  if (!fromTemplate) return false;
  if (declared === "service") return false; // service traffic uses no template
  return fromTemplate !== declared;
}

// ── Provider route ───────────────────────────────────────────────────────────
export type ProviderRoute = "cloud_api" | "mm_api";

/** MM API is only for eligible MARKETING template traffic on an enabled WABA. */
export function resolveProviderRoute(opts: {
  category: MessageCategory;
  hasTemplate: boolean;
  mmApiEnabled: boolean;
}): ProviderRoute {
  return opts.category === "marketing" && opts.hasTemplate && opts.mmApiEnabled
    ? "mm_api"
    : "cloud_api";
}

// ── Outcome classification ───────────────────────────────────────────────────
export type OutcomeClass =
  | "accepted"
  | "pace_limited"
  | "terminal"
  | "retryable"
  | "auth_blocked"
  | "unknown";

export interface OutcomeVerdict {
  outcome: OutcomeClass;
  /** Recipient-facing lifecycle state to persist on campaign_recipients. */
  recipient_status: "submitted" | "pace_limited" | "failed" | "pending" | "unknown";
  meta_code: string | null;
  retryable: boolean;
  retry_after: string | null;
  cooldown_seconds: number;
  reason: string;
  policy: MetaErrorPolicy;
}

/** Classifies a send outcome once, for every caller. */
export function classifyOutcome(input: {
  ok?: boolean;
  errorText?: string | null;
  code?: string | number | null;
  httpStatus?: number | null;
  networkError?: string | null;
  transmitted?: boolean;
  attempt?: number;
}): OutcomeVerdict {
  if (input.ok) {
    return {
      outcome: "accepted",
      recipient_status: "submitted",
      meta_code: null,
      retryable: false,
      retry_after: null,
      cooldown_seconds: 0,
      reason: "accepted_by_provider",
      policy: classifyMetaError({}),
    };
  }

  const code = input.code != null ? String(input.code) : extractMetaCode(input.errorText);
  const pol = classifyMetaError({
    code,
    message: input.errorText ?? null,
    httpStatus: input.httpStatus ?? null,
    networkError: input.networkError ?? null,
    transmitted: input.transmitted,
  });
  const attempt = input.attempt ?? 0;

  if (pol.class === "pacing") {
    return {
      outcome: "pace_limited",
      recipient_status: "pace_limited",
      meta_code: pol.code ?? code,
      retryable: false,
      retry_after: null,
      cooldown_seconds: pol.cooldown_seconds,
      reason: pol.description,
      policy: pol,
    };
  }
  if (pol.class === "auth") {
    return {
      outcome: "auth_blocked",
      recipient_status: "failed",
      meta_code: pol.code ?? code,
      retryable: false,
      retry_after: null,
      cooldown_seconds: 0,
      reason: pol.description,
      policy: pol,
    };
  }
  if (pol.class === "unknown") {
    // No provider evidence: the message may have been accepted. NEVER treat an
    // unknown outcome as "safe to resend" — reconciliation resolves it.
    return {
      outcome: "unknown",
      recipient_status: "unknown",
      meta_code: pol.code ?? code,
      retryable: false,
      retry_after: null,
      cooldown_seconds: 0,
      reason: pol.description,
      policy: pol,
    };
  }
  if (isTerminal(pol) || pol.terminal) {
    return {
      outcome: "terminal",
      recipient_status: "failed",
      meta_code: pol.code ?? code,
      retryable: false,
      retry_after: null,
      cooldown_seconds: pol.cooldown_seconds,
      reason: pol.description,
      policy: pol,
    };
  }
  return {
    outcome: pol.retryable ? "retryable" : "terminal",
    recipient_status: "failed",
    meta_code: pol.code ?? code,
    retryable: pol.retryable,
    retry_after: nextRetryAt(attempt, pol),
    cooldown_seconds: pol.cooldown_seconds,
    reason: pol.description,
    policy: pol,
  };
}

/** Retry eligibility for an already-failed recipient row. */
export function retryEligibility(row: {
  status?: string | null;
  error?: string | null;
  error_code?: string | null;
  last_meta_error_code?: string | null;
  marketing_blocked_until?: string | null;
  attempt?: number | null;
}): { retryable: boolean; bucket: "retryable" | "pace_limited" | "terminal"; reason: string } {
  if (String(row.status ?? "").toLowerCase() === "pace_limited") {
    return { retryable: false, bucket: "pace_limited", reason: "Meta marketing pacing cooldown" };
  }
  if (row.marketing_blocked_until && new Date(row.marketing_blocked_until) > new Date()) {
    return { retryable: false, bucket: "pace_limited", reason: "Marketing cooldown active" };
  }
  const verdict = classifyOutcome({
    ok: false,
    code: row.error_code ?? row.last_meta_error_code ?? null,
    errorText: row.error ?? null,
    attempt: row.attempt ?? 0,
  });
  if (verdict.outcome === "pace_limited") {
    return { retryable: false, bucket: "pace_limited", reason: verdict.reason };
  }
  if (verdict.outcome === "retryable") {
    return { retryable: true, bucket: "retryable", reason: verdict.reason };
  }
  if (verdict.outcome === "unknown") {
    // Unknown outcome may already have been delivered — never blind-resend.
    return { retryable: false, bucket: "terminal", reason: "Outcome unconfirmed — awaiting reconciliation" };
  }
  return { retryable: false, bucket: "terminal", reason: verdict.reason };
}

// ── Recipient memory helpers (thin RPC wrappers) ─────────────────────────────
type Db = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

export async function recordPaceEvent(
  db: Db,
  phone: string,
  code: string,
  branchId?: string | null,
): Promise<string | null> {
  try {
    const { data } = await db.rpc("record_whatsapp_pace_event", {
      _phone: phone,
      _code: code,
      _branch_id: branchId ?? null,
    });
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function recordMarketingEvent(
  db: Db,
  phone: string,
  kind: "attempt" | "delivered" | "read" | "reply",
  branchId?: string | null,
): Promise<void> {
  try {
    await db.rpc("record_whatsapp_marketing_event", {
      _phone: phone,
      _kind: kind,
      _branch_id: branchId ?? null,
    });
  } catch { /* memory is best-effort; never block a send path */ }
}

export interface EligibilityRow {
  phone_last10: string;
  eligible: boolean;
  reason: "eligible" | "pace_cooldown" | "invalid_number" | string;
  cooldown_until: string | null;
  pace_events_30d: number;
}

export async function recipientEligibility(
  db: Db,
  phones: string[],
  category: MessageCategory,
): Promise<Map<string, EligibilityRow>> {
  const map = new Map<string, EligibilityRow>();
  if (phones.length === 0) return map;
  try {
    const { data } = await db.rpc("whatsapp_recipient_eligibility", {
      _phones: phones,
      _category: category,
    });
    for (const row of (data as EligibilityRow[]) ?? []) map.set(row.phone_last10, row);
  } catch { /* fail open: the send path still enforces DND + budget */ }
  return map;
}

export function last10(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

/** Single-recipient convenience check used by dispatch-communication. */
export async function isMarketingBlocked(
  db: Db,
  phone: string,
  category: MessageCategory,
): Promise<{ blocked: boolean; until: string | null; reason: string | null }> {
  if (category !== "marketing") return { blocked: false, until: null, reason: null };
  const map = await recipientEligibility(db, [phone], category);
  const row = map.get(last10(phone));
  if (!row || row.eligible) return { blocked: false, until: null, reason: null };
  return { blocked: true, until: row.cooldown_until, reason: row.reason };
}

// ── 24-hour customer-service conversation window ─────────────────────────────
export const SERVICE_WINDOW_HOURS = 24;

export function conversationWindow(lastInboundAt: string | null | undefined): {
  conversation_window_active: boolean;
  conversation_window_started_at: string | null;
  conversation_window_expires_at: string | null;
} {
  if (!lastInboundAt) {
    return {
      conversation_window_active: false,
      conversation_window_started_at: null,
      conversation_window_expires_at: null,
    };
  }
  const started = new Date(lastInboundAt);
  const expires = new Date(started.getTime() + SERVICE_WINDOW_HOURS * 3600 * 1000);
  return {
    conversation_window_active: expires.getTime() > Date.now(),
    conversation_window_started_at: started.toISOString(),
    conversation_window_expires_at: expires.toISOString(),
  };
}

// ── Operator-facing explanations (single source for UI copy) ─────────────────
export interface CodeExplanation {
  title: string;
  what_happened: string;
  what_we_did: string;
  retry_allowed: boolean;
  next_evaluation: string;
}

export function explainMetaCode(code: string | null | undefined): CodeExplanation {
  const pol = classifyMetaError({ code: code ?? null });
  switch (pol.class) {
    case "pacing":
      return {
        title: `${code} — Recipient marketing pacing`,
        what_happened: "Meta withheld this marketing message to protect recipient experience.",
        what_we_did: "Marked the recipient pace limited and started a marketing cooldown. No retry was attempted.",
        retry_allowed: false,
        next_evaluation: "After the cooldown expires, or sooner if the member replies.",
      };
    case "auth":
      return {
        title: `${code} — WhatsApp credentials blocked`,
        what_happened: pol.description,
        what_we_did: "Stopped sending on this number and flagged it for an operator.",
        retry_allowed: false,
        next_evaluation: "After the WhatsApp connection is reconnected.",
      };
    case "rate_limit":
      return {
        title: `${code} — Provider throughput limit`,
        what_happened: pol.description,
        what_we_did: "Slowed the queue and scheduled a controlled retry.",
        retry_allowed: true,
        next_evaluation: "On the next retry pass.",
      };
    case "transient":
      return {
        title: `${code} — Temporary send failure`,
        what_happened: pol.description,
        what_we_did: "Scheduled a backed-off retry.",
        retry_allowed: true,
        next_evaluation: "On the next retry pass.",
      };
    case "terminal":
      return {
        title: `${code} — Permanent failure`,
        what_happened: pol.description,
        what_we_did: "Stopped attempting this recipient; retrying cannot succeed.",
        retry_allowed: false,
        next_evaluation: pol.operator_action_required
          ? "After the template or configuration is corrected."
          : "Not scheduled.",
      };
    default:
      return {
        title: code ? `${code} — Unconfirmed outcome` : "Unconfirmed outcome",
        what_happened: "No provider evidence of acceptance or rejection was received.",
        what_we_did: "Left the message unconfirmed instead of resending, to avoid a duplicate.",
        retry_allowed: false,
        next_evaluation: "On the next reconciliation pass.",
      };
  }
}
