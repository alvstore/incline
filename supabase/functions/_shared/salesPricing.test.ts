import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { salesTurn, matchDuration, hasUnlistedAmount, allowedAmounts, type PlanRow, type QuoteState } from "./salesPricing.ts";

const PLANS: PlanRow[] = [
  { id: "d", name: "Day Pass", duration_days: 1, price: 999, discounted_price: null },
  { id: "m", name: "Premium Monthly", duration_days: 30, price: 5000, discounted_price: null },
  { id: "pil", name: "Incline Pilates Starter", duration_days: 30, price: 8000, discounted_price: null },
  { id: "q", name: "Quarterly Plan", duration_days: 90, price: 13900, discounted_price: 12000 },
  { id: "h", name: "Half Yearly Plan", duration_days: 180, price: 19999, discounted_price: 18000 },
  { id: "a", name: "Annual Plan", duration_days: 365, price: 42900, discounted_price: 36900 },
  { id: "f", name: "Essential Annual - Founder's Pass", duration_days: 365, price: 28900, discounted_price: 25000 },
];
const all = (r: { messages: { text: string }[] } | null) => (r?.messages ?? []).map((m) => m.text).join(" ");

function chat(lines: string[], start: QuoteState = {}) {
  let q = start; const out = [];
  for (const l of lines) { const r = salesTurn(l, q, PLANS); out.push(r); if (r) q = r.quote; }
  return out;
}

Deno.test("price question without a plan asks which length, never lists every price", () => {
  const r = salesTurn("what is the price", {}, PLANS)!;
  assertMatch(all(r), /Monthly, Quarterly, Half-Yearly or Annual/);
  assert(!/₹/.test(all(r)));
});

Deno.test("quotes only the plan asked about: original and offer price together", () => {
  const r = salesTurn("annual price?", {}, PLANS)!;
  assertMatch(all(r), /₹42,900.*offer price of ₹36,900/);
  assert(!/25,000|13,900|5,000/.test(all(r)));
  assertEquals(r.event, "offer_revealed");
});

Deno.test("annual negotiation: original+offer -> ₹25,000 floor -> humble front desk", () => {
  const [a, c, d] = chat(["annual price", "any discount?", "can you do less"]);
  assertMatch(all(a), /₹36,900/);
  assertMatch(all(c), /₹25,000/); assertMatch(all(c), /steam/); assertMatch(all(c), /yoga, Pilates/); assertEquals(c!.event, "floor_offered");
  assertMatch(all(d), /no further discount/); assertMatch(all(d), /visit the club or call our front desk on 8298293003/); assert(!/₹/.test(all(d)));
  assert(!/₹2[0-4],\d{3}/.test([a, c, d].map(all).join(" ")), "never below the floor");
});

const LIVE: PlanRow[] = PLANS.filter((p) => p.id !== "a");
Deno.test("live catalog: annual shows ₹28,900 -> ₹25,000 and refuses further discount", () => {
  let q: QuoteState = {};
  const a = salesTurn("Annual", { awaitingDuration: true }, LIVE)!; q = a.quote;
  assertMatch(all(a), /₹28,900.*₹25,000/); assertMatch(all(a), /already our discounted price/);
  const b = salesTurn("any more discount?", q, LIVE)!;
  assertMatch(all(b), /no further discount/); assert(b.messages[0].tel); assert(!/₹/.test(all(b)));
  const v = salesTurn("Have already visited", a.quote, LIVE)!;
  assertMatch(all(v), /thank you for visiting.*₹25,000.*payment link/);
});

Deno.test("first ask for offers shows the offer price, not the desk", () => {
  const r = salesTurn("any offers on quarterly", {}, PLANS)!;
  assertMatch(all(r), /₹13,900.*₹12,000/);
});

Deno.test("no discount after offer on non-annual plans: straight to front desk", () => {
  const [, c] = chat(["quarterly price", "discount please"]);
  assertMatch(all(c), /8298293003/);
  assert(!/₹/.test(all(c)));
});

Deno.test("monthly has no offer price, so bargaining goes to the desk", () => {
  const [, b] = chat(["monthly fees", "discount?"]);
  assertMatch(all(b), /no further discount.*8298293003/);
});

Deno.test("free days, freeze, group and couple deals go to the front desk", () => {
  for (const t of ["can I get free days", "can I freeze my plan", "group discount for 3 friends", "couple membership price", "extra month free?"]) {
    const r = salesTurn(t, {}, PLANS)!;
    assertMatch(all(r), /front desk on 8298293003/, t);
    assert(r.messages[0].tel);
  }
});

Deno.test("add-on prices are never shown to outsiders", () => {
  const r = salesTurn("what is the sauna price", {}, PLANS)!;
  assertMatch(all(r), /non-members are different.*8298293003/);
  assert(!/₹/.test(all(r)));
  assertEquals(salesTurn("cold plunge price", {}, PLANS, { isMember: true }), null);
});

Deno.test("payment link only after an explicit yes, at the current stage price", () => {
  const [, interest, yes] = chat(["annual price", "I want to join", "yes"]);
  assertMatch(all(interest), /₹36,900.*payment link\?/);
  assertEquals(interest!.createLink, undefined);
  assertEquals(yes!.createLink?.amount, 36900);
  assertEquals(yes!.createLink?.plan.id, "a");
});

Deno.test("saying no to the link creates nothing", () => {
  const [, , no] = chat(["half yearly price", "send me the payment link", "no"]);
  assertEquals(no!.createLink, undefined);
});

Deno.test("link at floor uses the Founder's Pass amount", () => {
  const r = chat(["annual price", "discount", "ok I'll take it", "yes"]);
  assertEquals(r[3]!.createLink?.amount, 25000);
  assertEquals(r[3]!.createLink?.plan.id, "f");
});

Deno.test("links switched off: desk instead of link", () => {
  const r = salesTurn("I want to join annual", {}, PLANS, { linksEnabled: false })!;
  assertMatch(all(r), /8298293003/);
  assertEquals(r.createLink, undefined);
});

Deno.test("non-pricing questions are left to the concierge", () => {
  assertEquals(salesTurn("do you have a sauna?", {}, PLANS), null);
  assertEquals(salesTurn("where are you located", {}, PLANS), null);
});

Deno.test("leak guard flags amounts not on the plan list", () => {
  const ok = allowedAmounts(PLANS);
  assert(!hasUnlistedAmount("Annual is ₹36,900", ok));
  assert(hasUnlistedAmount("Special ₹20,000 today", ok));
});

Deno.test("half yearly is not mistaken for annual", () => {
  assertEquals(matchDuration("Half yearly"), "half_yearly");
  assertEquals(matchDuration("half-yearly fees"), "half_yearly");
  assertEquals(matchDuration("yearly"), "annual");
});

Deno.test("bare plan name quotes that plan", () => {
  const r = salesTurn("Half-yearly", {}, PLANS)!;
  assertEquals(r.quote.dur, "half_yearly");
});
Deno.test("day pass quotes the day pass plan", () => {
  const r = salesTurn("Day pass fees", { dur: "quarterly", stage: "offer" }, PLANS)!;
  assertMatch(r.messages[0].text, /₹999/);
});
