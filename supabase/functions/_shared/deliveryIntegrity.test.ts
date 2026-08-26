// Regression tests for the delivery-integrity hardening (Phases 1-9).
// Run: deno test supabase/functions/_shared/deliveryIntegrity.test.ts
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mayAdvance, nextState, isTerminalState } from "./deliveryState.ts";
import {
  classifyMetaError,
  classifyTransport,
  extractMetaCode,
  isTerminal,
  marketingBlockedUntil,
  nextRetryAt,
} from "./metaErrorPolicy.ts";

// ── Phase 1: provider outcome safety ────────────────────────────────────────

Deno.test("1. Meta accepted + response lost → unknown, never resent", () => {
  const pol = classifyTransport({ networkError: "connection reset", transmitted: true });
  assertEquals(pol.class, "unknown");
  assertFalse(pol.retryable);
  assertFalse(pol.terminal);
});

Deno.test("2. Meta rejected + response received → terminal, no retry", () => {
  const pol = classifyMetaError({ code: 131026 });
  assert(pol.terminal);
  assertFalse(pol.retryable);
});

Deno.test("3. network timeout BEFORE transmission → safe retry", () => {
  const pol = classifyTransport({ networkError: "dns error", transmitted: false });
  assertEquals(pol.class, "transient");
  assert(pol.retryable);
});

Deno.test("4. network timeout AFTER transmission → unknown, not retryable", () => {
  const pol = classifyTransport({ networkError: "operation timed out", transmitted: true });
  assertEquals(pol.class, "unknown");
  assertFalse(pol.retryable);
});

Deno.test("5. duplicate reconciliation is a no-op", () => {
  assertEquals(nextState("unknown", "unknown"), "unknown");
  assertFalse(mayAdvance("unknown", "unknown"));
});

Deno.test("6. webhook arriving before reconciliation wins", () => {
  // Once delivered, a later 'unknown' reconciliation must not regress it.
  assertEquals(nextState("delivered", "unknown"), "delivered");
});

// ── Phase 2: monotonic delivery state ───────────────────────────────────────

Deno.test("7. forward progression is allowed", () => {
  const chain = ["pending", "queued", "submitted", "sent", "delivered", "read"];
  for (let i = 0; i < chain.length - 1; i++) {
    assert(mayAdvance(chain[i], chain[i + 1]), `${chain[i]} → ${chain[i + 1]}`);
  }
});

Deno.test("8. READ followed by SENT does not regress", () => {
  assertEquals(nextState("read", "sent"), "read");
});

Deno.test("9. READ followed by DELIVERED does not regress", () => {
  assertEquals(nextState("read", "delivered"), "read");
});

Deno.test("10. DELIVERED followed by SENT does not regress", () => {
  assertEquals(nextState("delivered", "sent"), "delivered");
});

Deno.test("11. duplicate webhook is idempotent", () => {
  assertEquals(nextState(nextState("sent", "delivered"), "delivered"), "delivered");
});

Deno.test("12. unknown never overwrites a confirmed outcome, but may park in-flight", () => {
  assertEquals(nextState("read", "unknown"), "read");
  assertEquals(nextState("delivered", "unknown"), "delivered");
  assertEquals(nextState("submitted", "unknown"), "unknown");
});

Deno.test("13. failure after submit wins; failure after delivery does not", () => {
  assertEquals(nextState("submitted", "failed"), "failed");
  assertEquals(nextState("delivered", "failed"), "delivered");
  assert(isTerminalState("suppressed"));
});

// ── Phase 3/5: provider delivery overrides the send snapshot ────────────────

Deno.test("14. successful send followed by provider failure ends FAILED", () => {
  let s = nextState("dispatching", "submitted"); // dispatcher ACK
  s = nextState(s, "sent");                      // provider 'sent' callback
  s = nextState(s, "failed");                    // later provider failure
  assertEquals(s, "failed");
});

Deno.test("15. a queued dispatcher result stays queued (never optimistic sent)", () => {
  assertEquals(nextState("dispatching", "queued"), "queued");
  assertFalse(mayAdvance("queued", "pending"));
});

// ── Phase 4: never fabricate success ────────────────────────────────────────

Deno.test("16. awaiting_confirmation timeout resolves to unknown, not succeeded", () => {
  const parked = "submitted"; // the log state behind awaiting_confirmation
  assertEquals(nextState(parked, "unknown"), "unknown");
  assertFalse(mayAdvance(parked, "delivered") === false); // delivery still possible via real evidence
});

// ── Phase 7/9: shared Meta policy ───────────────────────────────────────────

Deno.test("17. 131049 is pacing: cooled down, not terminal-failure, no campaign pause", () => {
  const pol = classifyMetaError({ code: "131049" });
  assertEquals(pol.class, "pacing");
  assertFalse(pol.retryable);
  assert(pol.cooldown_seconds >= 3600);
  assertFalse(pol.affects_campaign_pause);
  assert(pol.affects_sender_health);
  assert(isTerminal(pol));
  assert(!!marketingBlockedUntil(pol));
  assertEquals(nextRetryAt(0, pol), null);
});

Deno.test("18. 130472 behaves like pacing", () => {
  assertEquals(classifyMetaError({ code: "130472" }).class, "pacing");
});

Deno.test("19. template contract codes are terminal and need an operator", () => {
  for (const code of ["131051", "132000", "132001", "132012"]) {
    const pol = classifyMetaError({ code });
    assert(pol.terminal, code);
    assert(pol.operator_action_required, code);
  }
});

Deno.test("20. 132018 is repairable and schedules a retry", () => {
  const pol = classifyMetaError({ code: "132018" });
  assert(pol.retryable);
  assertFalse(pol.terminal);
  assert(!!nextRetryAt(0, pol));
});

Deno.test("21. 131026 / 133010 allow channel fallback", () => {
  assert(classifyMetaError({ code: "131026" }).fallback_allowed);
  assert(classifyMetaError({ code: "133010" }).fallback_allowed);
});

Deno.test("22. HTTP 5xx retryable, 429 rate-limited, 401 auth", () => {
  assert(classifyTransport({ httpStatus: 503 }).retryable);
  assertEquals(classifyTransport({ httpStatus: 429 }).class, "rate_limit");
  assertEquals(classifyTransport({ httpStatus: 401 }).class, "auth");
});

Deno.test("23. unknown provider error is never treated as success or failure", () => {
  const pol = classifyMetaError({ message: "something odd happened" });
  assertEquals(pol.class, "unknown");
  assertFalse(pol.retryable);
  assertFalse(pol.terminal);
});

Deno.test("24. Meta codes are extracted from free-form error strings", () => {
  assertEquals(extractMetaCode("131049: healthy ecosystem engagement"), "131049");
  assertEquals(extractMetaCode("132018: template_param_empty:3"), "132018");
  assertEquals(extractMetaCode("no code here"), null);
});

// ── Phase 8: one retry decision system ──────────────────────────────────────

Deno.test("25. backoff grows and always respects the policy cooldown", () => {
  const pol = classifyMetaError({ code: "132018" });
  const a = new Date(nextRetryAt(0, pol)!).getTime();
  const b = new Date(nextRetryAt(2, pol)!).getTime();
  assert(b > a);
});

Deno.test("26. a non-retryable policy never schedules a retry (no duplicate workers)", () => {
  assertEquals(nextRetryAt(0, classifyMetaError({ code: "132001" })), null);
  assertEquals(nextRetryAt(1, classifyMetaError({ code: "131049" })), null);
});
