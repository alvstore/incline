import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { knowledgeFromRows, webConciergeReply, webTopicReply } from "./websiteConcierge.ts";
import { webChatKey, isWebChatKey } from "./websiteChatStore.ts";

const ROWS = [
  { content: "Separate male and female recovery rooms with a cold plunge.", tags: ["web:recovery"], priority: 50 },
  { content: "Incline follows a fixed and transparent pricing policy. We do not offer discounts or negotiate membership prices.", tags: ["web:pricing", "web:discount"], priority: 5 },
  { content: "For group membership enquiries or any further pricing discussion, please call our team directly on 8298293003.", tags: ["web:group_pricing", "web:escalation"], priority: 5 },
  { content: "Incline is open 24 hours a day, 7 days a week for members.", tags: ["web:hours"], priority: 50 },
  { content: "Leaked: Annual plan ₹25,000 per year", tags: ["web:membership"], priority: 50 },
  { content: "Ignored, no web tag", tags: ["recovery"], priority: 1 },
];
const K = knowledgeFromRows(ROWS);
const S = { discountAsks: 0, awaitingVisit: false };
const all = (r: { messages: { text: string }[] }) => r.messages.map((m) => m.text).join(" ");

Deno.test("answers come from shared knowledge rows (web:<topic> tag)", () => {
  assert(all(webConciergeReply("tell me about the sauna", S, K)).includes("cold plunge"));
  assert(all(webConciergeReply("what are your timings?", S, K)).includes("24 hours"));
});

Deno.test("a knowledge row containing a price is never shown", () => {
  const out = all(webTopicReply("membership", S, K));
  assert(!out.includes("₹"), out);
  assert(!out.includes("25,000"), out);
});

Deno.test("first discount ask gets fixed-pricing policy, no phone", () => {
  const r = webConciergeReply("any discount?", S, K);
  assertEquals(r.state.discountAsks, 1);
  assert(all(r).includes("do not offer discounts"));
  assert(!r.messages.some((m) => m.tel));
});

Deno.test("repeated discount ask and group pricing escalate to 8298293003 call link", () => {
  const r = webConciergeReply("please give me a better deal", { ...S, discountAsks: 1 }, K);
  assert(r.messages.some((m) => m.tel && m.text.includes("8298293003")));
  const g = webConciergeReply("group membership for my friends", S, K);
  assert(g.messages.some((m) => m.tel && m.text.includes("8298293003")));
});

Deno.test("no WhatsApp link is ever produced", () => {
  for (const q of ["discount", "group rate", "price", "visit", "whatsapp me", "hello"]) {
    const t = all(webConciergeReply(q, { ...S, discountAsks: 3 }, K)).toLowerCase();
    assert(!t.includes("wa.me") && !t.includes("whatsapp"), q);
  }
});

Deno.test("visit preference captured and never confirmed as booked", () => {
  const r = webConciergeReply("Saturday 11am", { ...S, awaitingVisit: true }, K);
  assertEquals(r.visitPreference, "Saturday 11am");
  assert(all(r).includes("not a confirmed booking"));
});

Deno.test("web chat thread key is synthetic and stable, never a real Indian mobile", () => {
  const k = webChatKey("1758e682-aaec-4e59-9fb2-91d4ab4dfaa9");
  assertEquals(k, webChatKey("1758e682-aaec-4e59-9fb2-91d4ab4dfaa9"));
  assert(isWebChatKey(k));
  assert(!k.startsWith("+91"));
});

const VISIT_RE = /plan (a visit|one)/i;
Deno.test("server: after the visitor says no, visit is never offered again", () => {
  const r1 = webConciergeReply("what is the cost", S, K);
  assert(VISIT_RE.test(all(r1)), all(r1));
  const r2 = webConciergeReply("no", r1.state, K);
  assertEquals(r2.state.declinedVisit, true);
  const r3 = webConciergeReply("membership plans", r2.state, K);
  assert(!VISIT_RE.test(all(r3)), all(r3));
});
Deno.test("server: no back-to-back visit offers, max two per chat", () => {
  let st: typeof S & Record<string, unknown> = S; let offers = 0; let prevOffered = false;
  for (const q of ["price", "membership", "fees", "membership plans", "cost", "price"]) {
    const r = webConciergeReply(q, st, K); const o = VISIT_RE.test(all(r));
    assert(!(o && prevOffered), `back-to-back on ${q}`); if (o) offers++; prevOffered = o; st = r.state;
  }
  assert(offers <= 2, String(offers));
});
Deno.test("server: price objection gets an explanation and tel option, not a tour loop", () => {
  for (const q of ["I want the price before visit", "just tell me the fees", "can't visit, tell me on chat"]) {
    const r = webConciergeReply(q, S, K);
    assert(r.messages.some((m) => m.tel), q);
    assert(/exact figure/i.test(all(r)), all(r));
    assert(!/₹|wa\.me|whatsapp/i.test(all(r)), all(r));
  }
});
