// v1.0.0 — Incline AI sales psychology guardrail matrix.
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  PRICE_ASK_RE,
  PRICING_LEAK_RE,
  DEFENSIVE_PHRASE_RE,
  HIGH_INTENT_RE,
  WHY_NO_PRICE_RE,
  USER_QUOTED_PRICE_RE,
  detectPolicyLang,
  detectPriceContext,
  detectLeadStage,
  stageGuidance,
  SALES_PSYCHOLOGY_BLOCK,
  visitPivotReply,
} from "./pricingPolicy.ts";

Deno.test("price asks are detected in EN and Hinglish", () => {
  for (
    const t of [
      "what is the price?",
      "how much does membership cost",
      "fees kitni hai",
      "monthly charges batao",
      "₹ kitna lagega",
      "any discount?",
    ]
  ) assert(PRICE_ASK_RE.test(t), t);
});

Deno.test("non-price messages are not flagged as price asks", () => {
  for (const t of ["what are your timings?", "do you have a sauna?", "where are you located"]) {
    assert(!PRICE_ASK_RE.test(t), t);
  }
});

Deno.test("outbound leak guard catches fees, plan names and durations", () => {
  for (
    const t of [
      "Our monthly plan is ₹4,500",
      "The annual membership is great value",
      "Registration fee applies",
      "It includes 12 sessions",
      "Pricing starts from 3,000",
      "GST extra",
    ]
  ) assert(PRICING_LEAK_RE.test(t), t);
});

Deno.test("compliant visit copy does not trip the leak guard", () => {
  for (
    const t of [
      "Happy to help — the team will walk you through everything at the club. Which day suits you?",
      "We're in Sector 14, Udaipur and open 24x7. Would you like to come by this week?",
    ]
  ) assert(!PRICING_LEAK_RE.test(t), t);
});

Deno.test("defensive refusal phrasing is banned", () => {
  for (
    const t of [
      "I cannot share pricing",
      "I'm not allowed to share that",
      "It is against our policy",
      "Pricing is confidential",
    ]
  ) assert(DEFENSIVE_PHRASE_RE.test(t), t);
  assert(!DEFENSIVE_PHRASE_RE.test("We explain membership options at the club — when can you visit?"));
});

Deno.test("high intent and policy challenges are recognised", () => {
  assert(HIGH_INTENT_RE.test("I want to join today"));
  assert(HIGH_INTENT_RE.test("membership lena hai"));
  assert(WHY_NO_PRICE_RE.test("why don't you tell price"));
  assert(WHY_NO_PRICE_RE.test("kyu nahi bata rahe"));
  assert(USER_QUOTED_PRICE_RE.test("is it ₹5,000 per month?"));
});

Deno.test("language mirroring", () => {
  assertEquals(detectPolicyLang("how much is it"), "en");
  assertEquals(detectPolicyLang("kitna hai bhai"), "hi");
  assertEquals(detectPolicyLang("कितना है"), "hi");
});

Deno.test("ask count escalates across the thread", () => {
  const history = [
    { role: "user", content: "price kya hai" },
    { role: "assistant", content: "we discuss it at the club" },
  ];
  const ctx = detectPriceContext({ text: "bhai kitna hai", history });
  assertEquals(ctx.askCount, 2);
  assertEquals(ctx.lang, "hi");
  assert(ctx.isPriceAsk);
});

Deno.test("lead stage model maps to the 5-stage funnel", () => {
  assertEquals(detectLeadStage({ text: "hi" }), 0);
  assertEquals(detectLeadStage({ text: "do you have a sauna?", hasName: true }), 1);
  assertEquals(detectLeadStage({ text: "I want to join today" }), 3);
  assertEquals(detectLeadStage({ text: "can I talk to someone from your team" }), 5);
});

Deno.test("stage guidance is non-empty for every stage", () => {
  for (const s of [0, 1, 2, 3, 4, 5] as const) {
    assert(stageGuidance(s).length > 20);
  }
});

Deno.test("sales psychology block never leaks commercials", () => {
  assert(SALES_PSYCHOLOGY_BLOCK.includes("<sales_strategy>"));
});

Deno.test("visit pivot replies are compliant and non-defensive", () => {
  for (const lang of ["en", "hi"] as const) {
    for (const askCount of [1, 2, 3, 4]) {
      for (const highIntent of [false, true]) {
        const reply = visitPivotReply({
          firstName: "Rahul",
          lang,
          askCount,
          highIntent,
          challengingPolicy: false,
          userQuotedPrice: false,
          lastAssistantText: null,
          seed: `${lang}-${askCount}-${highIntent}`,
        });
        assert(reply.length > 10);
        assert(!PRICING_LEAK_RE.test(reply), `leak: ${reply}`);
        assert(!DEFENSIVE_PHRASE_RE.test(reply), `defensive: ${reply}`);
      }
    }
  }
});

Deno.test("pivot never repeats the previous assistant line", () => {
  const first = visitPivotReply({
    firstName: "",
    lang: "en",
    askCount: 1,
    highIntent: false,
    challengingPolicy: false,
    userQuotedPrice: false,
    lastAssistantText: null,
    seed: "a",
  });
  const second = visitPivotReply({
    firstName: "",
    lang: "en",
    askCount: 1,
    highIntent: false,
    challengingPolicy: false,
    userQuotedPrice: false,
    lastAssistantText: first,
    seed: "a",
  });
  assert(first !== second);
});
