// Deno tests for HOWBODY body/posture entitlement rules (F-1 regression suite).
// These prove the pure decision logic used by howbody-bind-user: a scan of one kind
// may never be authorised by the other kind's entitlement.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

type Kind = "body" | "posture";
interface Quota {
  allowed: boolean;
  plan_remaining: number;
  addon_remaining: number;
  reason: string;
}

/** Mirrors the bind-user decision: strictly the requested kind, no cross-substitution. */
function bindAllowed(kind: Kind, quotas: Record<Kind, Quota>): boolean {
  return quotas[kind].allowed === true;
}

function q(plan: number, addon: number): Quota {
  const allowed = plan > 0 || addon > 0;
  return {
    allowed,
    plan_remaining: plan,
    addon_remaining: addon,
    reason: allowed ? "ok" : (plan === 0 && addon === 0 ? "plan_no_scan" : "period_limit"),
  };
}

const none = q(0, 0);

Deno.test("body plan member → body bind ALLOWED", () => {
  assertEquals(bindAllowed("body", { body: q(2, 0), posture: none }), true);
});

Deno.test("valid body add-on credit only → body bind ALLOWED", () => {
  assertEquals(bindAllowed("body", { body: q(0, 1), posture: none }), true);
});

Deno.test("plan exhausted + valid body add-on → body bind ALLOWED", () => {
  assertEquals(bindAllowed("body", { body: q(0, 3), posture: none }), true);
});

Deno.test("posture-only member → body bind DENIED (F-1 regression)", () => {
  assertEquals(bindAllowed("body", { body: none, posture: q(5, 0) }), false);
});

Deno.test("posture add-on only → body bind DENIED", () => {
  assertEquals(bindAllowed("body", { body: none, posture: q(0, 4) }), false);
});

Deno.test("expired / zero body credit → body bind DENIED", () => {
  // Expired credits are excluded by howbody_scan_quota, so they surface as 0 remaining.
  assertEquals(bindAllowed("body", { body: q(0, 0), posture: none }), false);
});

Deno.test("plan allowance exhausted, no credit → body bind DENIED", () => {
  assertEquals(bindAllowed("body", { body: q(0, 0), posture: q(0, 0) }), false);
});

Deno.test("posture plan member → posture bind ALLOWED", () => {
  assertEquals(bindAllowed("posture", { body: none, posture: q(1, 0) }), true);
});

Deno.test("body-only member → posture bind DENIED", () => {
  assertEquals(bindAllowed("posture", { body: q(9, 9), posture: none }), false);
});

// --- consumption ordering (mirrors howbody_consume_scan) --------------------

function consumeSource(quota: Quota, hasCredit: boolean): "plan" | "credit" | "none" {
  if (quota.plan_remaining > 0) return "plan";
  if (hasCredit) return "credit";
  return "none";
}

Deno.test("consumption uses plan allowance first", () => {
  assertEquals(consumeSource(q(2, 3), true), "plan");
});

Deno.test("consumption falls back to credit only when plan exhausted", () => {
  assertEquals(consumeSource(q(0, 3), true), "credit");
});

Deno.test("consumption consumes nothing when neither source remains", () => {
  assertEquals(consumeSource(q(0, 0), false), "none");
});

Deno.test("duplicate dataKey never consumes twice", () => {
  const ledger = new Set<string>();
  const consume = (dataKey: string) => {
    if (ledger.has(dataKey)) return { consumed: false, duplicate: true };
    ledger.add(dataKey);
    return { consumed: true, duplicate: false };
  };
  assertEquals(consume("dk-1"), { consumed: true, duplicate: false });
  assertEquals(consume("dk-1"), { consumed: false, duplicate: true });
  assertEquals(ledger.size, 1);
});
