import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleCaptureLead, shortReference, expectedStartFor, type CaptureDeps } from "./websiteLeadCapture.ts";
import { leadWelcomeChannels } from "./leadWelcome.ts";
import { websiteHandoffPrompt, websiteHandoffRef } from "./websiteHandoff.ts";

// ── Minimal in-memory mock of the supabase-js query builder ──────────────────
type Row = Record<string, any>;
function mockDb(seed: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { leads: [], profiles: [], branches: [{ id: "b1", code: "incline", is_active: true, created_at: "2026-01-01" }], lead_activities: [], ...seed };
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  let seq = 0;
  const get = (r: Row, k: string) => k.includes("->>") ? r[k.split("->>")[0]]?.[k.split("->>")[1]] : r[k];
  function q(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select"; let payload: Row = {};
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(get(r, k))), b),
      eq: (k: string, v: unknown) => (filters.push((r) => get(r, k) === v), b),
      insert: (p: Row) => { op = "insert"; payload = p; return b; },
      update: (p: Row) => { op = "update"; payload = p; return b; },
      run() {
        t[table] ??= [];
        if (op === "insert") { const row = { id: `${table}-${++seq}-0000-0000`, created_at: new Date().toISOString(), ...payload }; t[table].push(row); return [row]; }
        const rows = t[table].filter((r) => filters.every((f) => f(r)));
        if (op === "update") rows.forEach((r) => Object.assign(r, payload));
        return rows;
      },
      maybeSingle: async () => ({ data: b.run()[0] ?? null, error: null }),
      single: async () => { const d = b.run()[0]; return { data: d ?? null, error: d ? null : { code: "PGRST116" } }; },
      then: (res: (v: unknown) => void) => res({ data: b.run(), error: null }),
    };
    return b;
  }
  return { t, rpcCalls, db: { from: q, rpc: async (fn: string, args: Row) => (rpcCalls.push({ fn, args }), { data: true, error: null }) } };
}

const CONSENT_TEXT = "Open WhatsApp with my enquiry prefilled. Nothing is sent until I press Send.";
const base = {
  intake_type: "website_chatbot", fullName: "Aarav Shah", phone: "98290 12345", email: "aarav@example.com",
  fitness_goal: "Fat loss", joining_timeframe: "within_30_days", notes: "Morning slots?",
  preferred_contact_channel: "whatsapp", consent: { granted: true, text: CONSENT_TEXT, channels: ["whatsapp"] },
  submission_id: "sub_abcdefgh1", utm_source: "instagram", utm_campaign: "launch", landing_page: "https://theincline.in/", referrer_url: "https://instagram.com/",
  branch_id: "attacker-branch",
};
const meta = { ip: "1.2.3.4", userAgent: "test" };
function deps(db: any, notified: any[] = []): CaptureDeps {
  return { db, notify: (a) => notified.push(a), now: new Date("2026-11-05T09:00:00Z") };
}

Deno.test("new chatbot enquiry creates exactly one website_chatbot lead with goal, timeframe and UTM", async () => {
  const m = mockDb(); const notified: any[] = [];
  const r = await handleCaptureLead(base, meta, deps(m.db, notified));
  assertEquals(r.status, 200);
  assertEquals(r.body.created, true);
  assertEquals(m.t.leads.length, 1);
  const lead = m.t.leads[0];
  assertEquals(lead.source, "website_chatbot");
  assertEquals(lead.fitness_goal, "Fat loss");
  assertEquals(lead.expected_start_date, "2026-12-05");
  assertEquals(lead.utm_source, "instagram");
  assertEquals(lead.phone, "+919829012345");
  assertEquals(lead.branch_id, "b1"); // raw browser branch_id ignored
  assertEquals(r.body.lead_id, lead.id);
  assertEquals(r.body.reference, shortReference(lead.id));
  assertEquals(m.t.lead_activities[0].activity_type, "website_chatbot_lead_saved");
  assertEquals(m.t.lead_activities[0].metadata.handoff_choice, "whatsapp");
  assert(!JSON.stringify(m.t.lead_activities[0].metadata).includes("9829012345"));
  assertEquals(notified, [{ lead_id: lead.id, branch_id: "b1", suppress_lead_welcome: true }]);
});

Deno.test("WhatsApp handoff consent is recorded for whatsapp channel only, with exact text", async () => {
  const m = mockDb();
  await handleCaptureLead(base, meta, deps(m.db));
  assertEquals(m.rpcCalls.length, 1);
  assertEquals(m.rpcCalls[0].args.p_channels, ["whatsapp"]);
  assertEquals(m.rpcCalls[0].args.p_source, "website_chatbot");
  assertEquals(m.rpcCalls[0].args.p_consent_text, CONSENT_TEXT);
  assertEquals(m.rpcCalls[0].args.p_action, "grant");
});

Deno.test("callback-only option records no WhatsApp opt-in", async () => {
  const m = mockDb();
  const r = await handleCaptureLead({ ...base, preferred_contact_channel: "callback", consent: null }, meta, deps(m.db));
  assertEquals(r.body.created, true);
  assertEquals(m.rpcCalls.length, 0);
  assertEquals(m.t.leads[0].preferred_contact_channel, undefined);
});

Deno.test("whatsapp choice without explicit consent is rejected", async () => {
  const m = mockDb();
  const r = await handleCaptureLead({ ...base, consent: { granted: false } }, meta, deps(m.db));
  assertEquals(r.status, 400);
  assertEquals(m.t.leads.length, 0);
});

Deno.test("duplicate submission / same phone returns existing lead without duplicates", async () => {
  const m = mockDb(); const notified: any[] = [];
  const first = await handleCaptureLead(base, meta, deps(m.db, notified));
  const again = await handleCaptureLead(base, meta, deps(m.db, notified));
  assertEquals(m.t.leads.length, 1);
  assertEquals(again.body.lead_id, first.body.lead_id);
  assertEquals(again.body.existing, true);
  assertEquals(m.t.lead_activities.length, 1); // same submission_id → no extra activity
  assertEquals(m.rpcCalls.length, 1);          // ...and no duplicate consent
  assertEquals(notified.length, 1);
  // A new submission from the same phone (different format) logs a return event.
  await handleCaptureLead({ ...base, phone: "+91 98290-12345", submission_id: "sub_second99" }, meta, deps(m.db));
  assertEquals(m.t.leads.length, 1);
  assertEquals(m.t.lead_activities[1].activity_type, "website_chatbot_returned");
});

Deno.test("existing lead: only empty fields are filled; notes/source/status kept", async () => {
  const m = mockDb({ leads: [{ id: "lead-old", branch_id: "b1", phone: "9829012345", source: "instagram", status: "qualified", notes: "VIP referral", fitness_goal: null, email: null }] });
  const r = await handleCaptureLead(base, meta, deps(m.db));
  const l = m.t.leads[0];
  assertEquals(r.body.lead_id, "lead-old");
  assertEquals(l.notes, "VIP referral");
  assertEquals(l.source, "instagram");
  assertEquals(l.status, "qualified");
  assertEquals(l.fitness_goal, "Fat loss");
  assertEquals(l.email, "aarav@example.com");
});

Deno.test("existing member phone does not create a lead", async () => {
  const m = mockDb({ profiles: [{ id: "p1", phone: "+919829012345" }] });
  const notified: any[] = [];
  const r = await handleCaptureLead(base, meta, deps(m.db, notified));
  assertEquals(r.body.already_member, true);
  assertEquals(r.body.lead_id, undefined);
  assertEquals(m.t.leads.length, 0);
  assertEquals(notified.length, 0);
});

Deno.test("honeypot and rate limit write nothing", async () => {
  const m = mockDb();
  const hp = await handleCaptureLead({ ...base, company_website: "spam.example" }, meta, deps(m.db));
  assertEquals(hp.status, 200);
  const limited = await handleCaptureLead(base, meta, { ...deps(m.db), rateLimit: async () => false });
  assertEquals(limited.status, 429);
  assertEquals(m.t.leads.length, 0);
});

Deno.test("validation: non-Indian mobile, bad goal, long note truncated", async () => {
  const m = mockDb();
  assertEquals((await handleCaptureLead({ ...base, phone: "12345" }, meta, deps(m.db))).status, 400);
  assertEquals((await handleCaptureLead({ ...base, fitness_goal: "<script>" }, meta, deps(m.db))).status, 400);
  await handleCaptureLead({ ...base, notes: "x".repeat(2000) }, meta, deps(m.db));
  assertEquals(m.t.leads[0].notes.length, 280);
});

Deno.test("embed form keeps its anti-enumeration response contract", async () => {
  const m = mockDb({ profiles: [{ id: "p1", phone: "+919829012345" }] });
  const r = await handleCaptureLead({ fullName: "Aarav", phone: "9829012345" }, meta, deps(m.db));
  assertEquals(r.body, { success: true, message: "Thank you! We will contact you soon." });
  const m2 = mockDb(); const n: any[] = [];
  const r2 = await handleCaptureLead({ fullName: "Aarav", phone: "9829012345", consent: { granted: true } }, meta, deps(m2.db, n));
  assertEquals(r2.body, { success: true, message: "Thank you! We will contact you soon." });
  assertEquals(m2.t.leads[0].source, "website");
  assertEquals(n[0].suppress_lead_welcome, false);
  assertEquals(m2.rpcCalls[0].args.p_channels, ["sms", "email", "rcs", "whatsapp"]);
});

Deno.test("suppress_lead_welcome blocks prospect WhatsApp/SMS/email welcomes only", () => {
  const rules = { sms_to_lead: true, whatsapp_to_lead: true, email_to_lead: true };
  const lead = { phone: "+919829012345", email: "a@b.co" };
  assertEquals(leadWelcomeChannels(rules, lead, true), []);
  assertEquals(leadWelcomeChannels(rules, lead, false), ["sms", "whatsapp", "email"]);
});

Deno.test("expected start mapping", () => {
  const now = new Date("2026-11-05T20:00:00Z"); // already 6 Nov in IST
  assertEquals(expectedStartFor("ready_now", now), "2026-11-06");
  assertEquals(expectedStartFor("exploring", now), null);
});

Deno.test("WhatsApp handoff: website draft from an unmatched number asks for the website mobile", () => {
  const msg = "Hi Incline, I'm Aarav. I just sent an enquiry on your website (ref WEB-AB12CD).";
  assertEquals(websiteHandoffRef(msg), "WEB-AB12CD");
  assert(websiteHandoffPrompt(msg, false)?.includes("mobile number they entered on the website"));
  assertEquals(websiteHandoffPrompt(msg, true), null); // matched lead → hydration handles it
  assertEquals(websiteHandoffPrompt("hello", false), null);
});
