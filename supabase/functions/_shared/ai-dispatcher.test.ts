import { assertEquals } from "jsr:@std/assert@1";
import { isFallbackEligible } from "./ai-dispatcher.ts";

Deno.test("busy, down and timeouts switch to the backup", () => {
  assertEquals(isFallbackEligible(new Error("lovable HTTP 429: rate")), true);
  assertEquals(isFallbackEligible(new Error("lovable HTTP 503: down")), true);
  assertEquals(isFallbackEligible(new Error("The signal has been aborted")), true);
});
Deno.test("out of credits switches to the backup", () => {
  assertEquals(isFallbackEligible(new Error("lovable HTTP 402: credits")), true);
  assertEquals(isFallbackEligible(new Error("lovable HTTP 403: credit_limit_reached")), true);
});
Deno.test("bad requests, auth and refusals never switch", () => {
  assertEquals(isFallbackEligible(new Error("lovable HTTP 400: bad")), false);
  assertEquals(isFallbackEligible(new Error("lovable HTTP 401: key")), false);
  assertEquals(isFallbackEligible(new Error("lovable HTTP 403: provider denied")), false);
});
