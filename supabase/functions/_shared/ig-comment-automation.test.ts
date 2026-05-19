// Deno tests for the pure helpers in ig-comment-automation.ts
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { matchKeyword, renderTemplate } from "./ig-comment-automation.ts";

const base = { keywords: ["DETOX", "Reset"], match_type: "contains" as const, case_sensitive: false };

Deno.test("matchKeyword — case-insensitive contains", () => {
  assertEquals(matchKeyword("I want to detox now", base), "DETOX");
  assertEquals(matchKeyword("RESET please", base), "Reset");
  assertEquals(matchKeyword("nothing here", base), null);
});

Deno.test("matchKeyword — exact respects trim", () => {
  const c = { keywords: ["join"], match_type: "exact" as const, case_sensitive: false };
  assertEquals(matchKeyword("  JOIN  ", c), "join");
  assertEquals(matchKeyword("join now", c), null);
});

Deno.test("matchKeyword — case sensitive on demand", () => {
  const c = { keywords: ["INFO"], match_type: "contains" as const, case_sensitive: true };
  assertEquals(matchKeyword("info please", c), null);
  assertEquals(matchKeyword("send INFO", c), "INFO");
});

Deno.test("matchKeyword — starts_with", () => {
  const c = { keywords: ["price"], match_type: "starts_with" as const, case_sensitive: false };
  assertEquals(matchKeyword("price please", c), "price");
  assertEquals(matchKeyword("what price", c), null);
});

Deno.test("renderTemplate — substitutes and tolerates missing", () => {
  const out = renderTemplate("Hi {{first_name}}, your code is {{ code }}.", { first_name: "Alex" });
  assertEquals(out, "Hi Alex, your code is .");
});

Deno.test("renderTemplate — ignores unknown braces", () => {
  const out = renderTemplate("Static {{x}} text", {});
  assertEquals(out, "Static  text");
});
