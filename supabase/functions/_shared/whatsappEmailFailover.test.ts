import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { shouldFailover } from "./whatsappEmailFailover.ts";

Deno.test("131049 on a retention notice falls back to email", () => {
  assertEquals(shouldFailover("131049", "retention_nudge"), true);
});
Deno.test("131026 (not on WhatsApp) falls back to email", () => {
  assertEquals(shouldFailover("131026", "membership_reminder"), true);
});
Deno.test("marketing sends never fail over", () => {
  assertEquals(shouldFailover("131049", "marketing"), false);
});
Deno.test("other errors do not fail over", () => {
  assertEquals(shouldFailover("131047", "retention_nudge"), false);
});
