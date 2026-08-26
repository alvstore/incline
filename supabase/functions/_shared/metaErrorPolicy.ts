// metaErrorPolicy.ts v1.0.0
// PHASE 7 — ONE shared Meta / transport error policy.
//
// Every sender, retry worker, reconciler and campaign path must classify
// outcomes through this module. Do NOT re-declare terminal code lists,
// backoff tables or cooldowns anywhere else.
//
// Classifications are based on documented Meta Cloud API behaviour only.
// Nothing here invents provider semantics.

export type MetaErrorClass =
  | "transient"          // safe to retry after backoff
  | "terminal"           // permanent for THIS message payload/recipient
  | "pacing"             // recipient-level marketing eligibility / pacing (131049)
  | "rate_limit"         // provider throttling — retry later, slow down
  | "auth"               // credential / permission problem — operator action
  | "unknown";           // outcome not established (no provider evidence)

export interface MetaErrorPolicy {
  code: string | null;
  class: MetaErrorClass;
  retryable: boolean;
  terminal: boolean;
  /** Seconds to wait before this recipient may be contacted again. */
  cooldown_seconds: number;
  /** May we fall back to another channel (SMS/email)? */
  fallback_allowed: boolean;
  affects_sender_health: boolean;
  affects_campaign_pause: boolean;
  operator_action_required: boolean;
  description: string;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

function policy(p: Partial<MetaErrorPolicy> & { class: MetaErrorClass; description: string }): MetaErrorPolicy {
  return {
    code: null,
    retryable: false,
    terminal: false,
    cooldown_seconds: 0,
    fallback_allowed: false,
    affects_sender_health: false,
    affects_campaign_pause: false,
    operator_action_required: false,
    ...p,
  };
}

const CODE_TABLE: Record<string, MetaErrorPolicy> = {
  // Recipient-level marketing pacing. Documented as a deliberate Meta
  // ecosystem-quality decision — never bypass, never fast-retry.
  "131049": policy({
    class: "pacing",
    description: "Meta withheld the marketing message to maintain ecosystem engagement",
    cooldown_seconds: DAY,
    fallback_allowed: true,
    affects_sender_health: true,
    affects_campaign_pause: false, // a single paced recipient must not fail a campaign
  }),
  // Per-user marketing template limit reached.
  "130472": policy({
    class: "pacing",
    description: "Recipient is in an experiment / marketing message limit group",
    cooldown_seconds: DAY,
    fallback_allowed: true,
    affects_sender_health: true,
  }),
  "131026": policy({
    class: "terminal",
    terminal: true,
    description: "Message undeliverable — recipient cannot receive WhatsApp messages",
    fallback_allowed: true,
  }),
  "131047": policy({
    class: "terminal",
    terminal: true,
    description: "Re-engagement required — outside the 24h window and no usable template",
    fallback_allowed: true,
  }),
  "131051": policy({
    class: "terminal",
    terminal: true,
    description: "Unsupported message type for this template",
    operator_action_required: true,
  }),
  "132000": policy({
    class: "terminal",
    terminal: true,
    description: "Template parameter count mismatch",
    operator_action_required: true,
  }),
  "132001": policy({
    class: "terminal",
    terminal: true,
    description: "Template does not exist in this WABA / language",
    operator_action_required: true,
  }),
  "132012": policy({
    class: "terminal",
    terminal: true,
    description: "Template parameter format is invalid",
    operator_action_required: true,
  }),
  // Repairable contract failure: the variable bag was incomplete. The dispatcher
  // now hydrates canonical data, so a repaired replay is legitimate.
  "132018": policy({
    class: "transient",
    retryable: true,
    cooldown_seconds: 300,
    description: "Template parameter empty — repair the variable bag and replay",
    operator_action_required: true,
  }),
  "133010": policy({
    class: "terminal",
    terminal: true,
    description: "Phone number is not registered on WhatsApp",
    fallback_allowed: true,
  }),
  "131000": policy({
    class: "transient",
    retryable: true,
    cooldown_seconds: 900,
    description: "Generic Meta failure — retry once, then treat as terminal",
  }),
  "133000": policy({
    class: "transient",
    retryable: true,
    cooldown_seconds: HOUR,
    description: "Account or asset restriction — usually sticky",
    affects_sender_health: true,
    operator_action_required: true,
  }),
  "80007": policy({
    class: "rate_limit",
    retryable: true,
    cooldown_seconds: 900,
    description: "WABA rate limit hit",
    affects_campaign_pause: true,
  }),
  "130429": policy({
    class: "rate_limit",
    retryable: true,
    cooldown_seconds: 900,
    description: "Cloud API message throughput limit reached",
    affects_campaign_pause: true,
  }),
  "190": policy({
    class: "auth",
    description: "Access token expired or invalid",
    operator_action_required: true,
    affects_campaign_pause: true,
  }),
  "10": policy({
    class: "auth",
    description: "Permission denied for this WABA / phone number",
    operator_action_required: true,
    affects_campaign_pause: true,
  }),
};

const UNKNOWN_POLICY = policy({
  class: "unknown",
  retryable: false,
  description: "Provider outcome not established — no evidence of acceptance or rejection",
});

export function extractMetaCode(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "number") return String(input);
  const s = String(input);
  const direct = s.match(/\b(\d{2,6})\s*:/);
  if (direct && CODE_TABLE[direct[1]]) return direct[1];
  const anyCode = s.match(/\b(1[0-9]{4,5})\b/);
  if (anyCode && CODE_TABLE[anyCode[1]]) return anyCode[1];
  const generic = s.match(/\b(13\d{4}|80007|190)\b/);
  return generic ? generic[1] : null;
}

/** HTTP status / network shape classification (no Meta code available). */
export function classifyTransport(opts: {
  httpStatus?: number | null;
  networkError?: string | null;
  /** true only when we know the request bytes never left this worker. */
  transmitted?: boolean;
}): MetaErrorPolicy {
  const { httpStatus, networkError, transmitted } = opts;

  if (networkError) {
    if (transmitted === false) {
      return policy({
        class: "transient",
        retryable: true,
        cooldown_seconds: 60,
        description: `Request never reached Meta (${networkError}) — safe to retry`,
      });
    }
    // Response lost after the request was (or may have been) transmitted.
    return { ...UNKNOWN_POLICY, description: `Provider response lost (${networkError})` };
  }

  if (typeof httpStatus === "number") {
    if (httpStatus === 429) return CODE_TABLE["130429"];
    if (httpStatus >= 500) {
      return policy({
        class: "transient",
        retryable: true,
        cooldown_seconds: 300,
        description: `Meta ${httpStatus} — provider-side failure`,
        affects_campaign_pause: httpStatus >= 500,
      });
    }
    if (httpStatus === 401 || httpStatus === 403) return CODE_TABLE["190"];
  }

  return UNKNOWN_POLICY;
}

export function classifyMetaError(input: {
  code?: string | number | null;
  message?: string | null;
  httpStatus?: number | null;
  networkError?: string | null;
  transmitted?: boolean;
}): MetaErrorPolicy {
  const code = input.code != null
    ? String(input.code)
    : extractMetaCode(input.message);

  if (code && CODE_TABLE[code]) return { ...CODE_TABLE[code], code };
  if (input.networkError || input.httpStatus) {
    return { ...classifyTransport(input), code: code ?? null };
  }
  return { ...UNKNOWN_POLICY, code: code ?? null };
}

/** Shared backoff — the ONLY retry schedule in the system. */
export const BACKOFF_MINUTES = [5, 30, 120];

export function nextRetryAt(attempt: number, pol: MetaErrorPolicy): string | null {
  if (!pol.retryable) return null;
  const backoff = BACKOFF_MINUTES[Math.min(attempt, BACKOFF_MINUTES.length - 1)] * 60;
  const wait = Math.max(backoff, pol.cooldown_seconds);
  return new Date(Date.now() + wait * 1000).toISOString();
}

/** Recipient-level marketing cooldown, when the policy defines one. */
export function marketingBlockedUntil(pol: MetaErrorPolicy): string | null {
  if (pol.class !== "pacing") return null;
  return new Date(Date.now() + pol.cooldown_seconds * 1000).toISOString();
}

export function isTerminal(pol: MetaErrorPolicy): boolean {
  return pol.terminal || pol.class === "pacing" || pol.class === "auth";
}
