import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkLimits } from "./authRateLimit.ts";

function fakeRpc() {
  const counts = new Map<string, number>();
  return (fn: string, a: Record<string, unknown>) => {
    if (fn !== "hit_public_form_rate_limit") return Promise.resolve({ data: null, error: null });
    const k = a.p_key as string; const n = (counts.get(k) ?? 0) + 1; counts.set(k, n);
    return Promise.resolve({ data: n <= (a.p_limit as number), error: null });
  };
}

Deno.test("6th phone sign-in attempt in a minute is refused", async () => {
  const rpc = fakeRpc(); const rules = [{ key: "phone:+919999999999", limit: 5, windowSeconds: 60 }];
  for (let i = 0; i < 5; i++) assertEquals(await checkLimits(rpc, rules, "login"), null);
  assertEquals(await checkLimits(rpc, rules, "login"), 60);
});

Deno.test("4th password reset for one email in 10 min is refused", async () => {
  const rpc = fakeRpc(); const rules = [{ key: "email:a@b.co", limit: 3, windowSeconds: 600 }];
  for (let i = 0; i < 3; i++) assertEquals(await checkLimits(rpc, rules, "reset"), null);
  assertEquals(await checkLimits(rpc, rules, "reset"), 600);
});

Deno.test("limiter outage fails open", async () => {
  const rpc = () => Promise.resolve({ data: null, error: { message: "down" } });
  assertEquals(await checkLimits(rpc, [{ key: "x", limit: 1, windowSeconds: 60 }], "login"), null);
});
