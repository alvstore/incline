import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleCaptureLead, shortReference, expectedStartFor, type CaptureDeps } from "./websiteLeadCapture.ts";
import { leadWelcomeChannels } from "./leadWelcome.ts";
import { websiteHandoffPrompt, websiteHandoffRef } from "./websiteHandoff.ts";

// ── Minimal in-memory mock of the supabase-js query builder ──────────────────
type Row = Record<string, any>;
function mockDb(seed: Record<string, Row[]> = {}) {
  const t: Record<string, Row[]> = { membership_plans: PLANS.map((p) => ({ ...p })), leads: [], profiles: [], branches: [{ id: "b1", code: "incline", is_active: true, created_at: "2026-01-01" }], lead_activities: [], ...seed };
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

const base = {
  intake_type: "website_chatbot", fullName: "Aarav Shah", phone: "98290 12345", email: "aarav@example.com",
  plan_interest: "Quarterly Plan", joining_timeframe: "within_30_days", notes: "Morning slots?",
  submission_id: "sub_abcdefgh1", utm_source: "instagram", utm_campaign: "launch", landing_page: "https://theincline.in/", referrer_url: "https://instagram.com/",
  branch_id: "attacker-branch",
};
const PLANS = [
  { name: "Quarterly Plan", is_active: true, is_visible_to_members: true, display_order: 1, price: 9999 },
  { name: "Retired Plan", is_active: false, is_visible_to_members: true, display_order: 2, price: 1 },
];
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
  assertEquals(lead.expected_start_date, "2026-12-05");
  assertEquals(lead.utm_source, "instagram");
  assertEquals(lead.phone, "+919829012345");
  assertEquals(lead.branch_id, "b1"); // raw browser branch_id ignored
  assertEquals(r.body.lead_id, lead.id);
  assertEquals(r.body.reference, shortReference(lead.id));
  assertEquals(m.t.lead_activities[0].activity_type, "website_chatbot_lead_saved");
  assertEquals(m.t.lead_activities[0].metadata.plan_interest, "Quarterly Plan");
  assertEquals(lead.plan_interest, "Quarterly Plan");
  assertEquals(lead.email, "aarav@example.com");
  assert(!JSON.stringify(m.t.lead_activities[0].metadata).includes("9829012345"));
  assertEquals(notified, [{ lead_id: lead.id, branch_id: "b1", suppress_lead_welcome: true }]);
});

Deno.test("chatbot never records consent or sets a WhatsApp contact channel", async () => {
  const m = mockDb();
  await handleCaptureLead({ ...base, preferred_contact_channel: "whatsapp", consent: { granted: true, channels: ["whatsapp"], text: "x" } }, meta, deps(m.db));
  assertEquals(m.rpcCalls.length, 0);
  assertEquals(m.t.leads[0].preferred_contact_channel, undefined);
});

Deno.test("email is compulsory and validated for chatbot leads", async () => {
  const m = mockDb();
  const missing = await handleCaptureLead({ ...base, email: "" }, meta, deps(m.db));
  assertEquals(missing.status, 400);
  assertEquals(missing.body.error, "Email is required to register your enquiry");
  assertEquals((await handleCaptureLead({ ...base, email: "aarav@" }, meta, deps(m.db))).status, 400);
  assertEquals(m.t.leads.length, 0);
  await handleCaptureLead({ ...base, email: "Aarav@Example.com" }, meta, deps(m.db));
  assertEquals(m.t.leads[0].email, "aarav@example.com");
});

Deno.test("interest must be an active plan name or a grounded category; plans list has no prices", async () => {
  const m = mockDb();
  const plans = await handleCaptureLead({ intake_type: "website_chatbot", action: "plans" }, meta, deps(m.db));
  assertEquals(plans.body.plans, ["Quarterly Plan"]);
  assert(!JSON.stringify(plans.body).includes("9999"));
  assertEquals((await handleCaptureLead({ ...base, plan_interest: "Retired Plan" }, meta, deps(m.db))).status, 400);
  assertEquals((await handleCaptureLead({ ...base, plan_interest: "50% off deal" }, meta, deps(m.db))).status, 400);
  assertEquals((await handleCaptureLead({ ...base, plan_interest: "Recovery & wellness" }, meta, deps(m.db))).status, 200);
  assertEquals(m.t.leads[0].plan_interest, "Recovery & wellness");
});

Deno.test("visit preference needs the original submission proof and books nothing", async () => {
  const m = mockDb();
  const r = await handleCaptureLead(base, meta, deps(m.db));
  const forged = await handleCaptureLead({ intake_type: "website_chatbot", action: "visit_preference", lead_id: r.body.lead_id, submission_id: "sub_wrong0000", visit_preference: "Sat 10am" }, meta, deps(m.db));
  assertEquals(forged.status, 400); // lead_id not a UUID in mock → still rejected
  m.t.leads[0].id = "0e5f2a10-0000-4000-8000-000000000000"; m.t.lead_activities[0].lead_id = m.t.leads[0].id;
  const bad = await handleCaptureLead({ intake_type: "website_chatbot", action: "visit_preference", lead_id: m.t.leads[0].id, submission_id: "sub_wrong0000", visit_preference: "Sat 10am" }, meta, deps(m.db));
  assertEquals(bad.status, 404);
  const ok = await handleCaptureLead({ intake_type: "website_chatbot", action: "visit_preference", lead_id: m.t.leads[0].id, submission_id: base.submission_id, visit_preference: "Sat 10am", topics: ["recovery", "evil"] }, meta, deps(m.db));
  assertEquals(ok.body.status, "visit_noted");
  const act = m.t.lead_activities.at(-1)!;
  assertEquals(act.activity_type, "website_chatbot_visit_request");
  assertEquals(act.metadata.topics, ["recovery"]);
  assertEquals(m.t.leads[0].preferred_time, "Sat 10am");
});

Deno.test("duplicate submission / same phone returns existing lead without duplicates", async () => {
  const m = mockDb(); const notified: any[] = [];
  const first = await handleCaptureLead(base, meta, deps(m.db, notified));
  const again = await handleCaptureLead(base, meta, deps(m.db, notified));
  assertEquals(m.t.leads.length, 1);
  assertEquals(again.body.lead_id, first.body.lead_id);
  assertEquals(again.body.existing, true);
  assertEquals(m.t.lead_activities.length, 1); // same submission_id → no extra activity
  assertEquals(notified.length, 1);
  // A new submission from the same phone (different format) logs a return event.
  await handleCaptureLead({ ...base, phone: "+91 98290-12345", submission_id: "sub_second99" }, meta, deps(m.db));
  assertEquals(m.t.leads.length, 1);
  assertEquals(m.t.lead_activities[1].activity_type, "website_chatbot_returned");
});

Deno.test("existing lead: public submission never modifies the lead row", async () => {
  const m = mockDb({ leads: [{ id: "lead-old", branch_id: "b1", phone: "9829012345", source: "instagram", status: "qualified", notes: "VIP referral", plan_interest: null, email: null }] });
  const r = await handleCaptureLead(base, meta, deps(m.db));
  const l = m.t.leads[0];
  assertEquals(r.body.lead_id, "lead-old");
  assertEquals(l.notes, "VIP referral");
  assertEquals(l.source, "instagram");
  assertEquals(l.status, "qualified");
  assertEquals(l.plan_interest, null);
  assertEquals(l.email, null);
  assertEquals(m.t.lead_activities.at(-1).metadata.unverified, true);
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
  assertEquals((await handleCaptureLead({ ...base, joining_timeframe: "tomorrow!" }, meta, deps(m.db))).status, 400);
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
