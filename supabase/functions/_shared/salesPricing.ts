// _shared/salesPricing.ts
// v1.1.0 — Single pricing playbook for Website Chat and WhatsApp (new enquiries).
// Rules: quote only the plan asked about; original price first; offer (discounted) price on
// the first discount/bargain; the annual floor (lowest active annual discounted price, read
// live) as the last offer; then the front desk. Free days, freeze, group deals or any other
// promise go straight to the desk. Add-on prices are for verified members only.
// Pure functions are unit-tested; DB helpers take a service-role client.

export const DESK_PHONE = "8298293003";

export type PlanRow = { id: string; name: string; duration_days: number; price: number; discounted_price: number | null; branch_id?: string | null };
export type Duration = "monthly" | "quarterly" | "half_yearly" | "annual";
export type Stage = "original" | "offer" | "floor" | "desk";
export type QuoteState = { dur?: Duration; stage?: Stage; awaitingDuration?: boolean; awaitingLinkConfirm?: boolean; linkUrl?: string };
export type SalesMsg = { text: string; tel?: boolean; url?: string };
export type SalesEvent = "price_quoted" | "offer_revealed" | "floor_offered" | "desk_handoff" | "addon_prices_shown" | null;
export type SalesReply = {
  messages: SalesMsg[];
  quote: QuoteState;
  event: SalesEvent;
  plan?: PlanRow;
  amount?: number;
  /** Visitor said yes to the payment link — caller must create/reuse the link. */
  createLink?: { plan: PlanRow; amount: number; stage: Stage };
};

export const DUR_LABEL: Record<Duration, string> = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-Yearly", annual: "Annual" };
const DUR_MONTHS: Record<Duration, string> = { monthly: "1 month", quarterly: "3 months", half_yearly: "6 months", annual: "12 months" };

export const DESK_BEST = `I truly understand wanting the best value, and I'm sorry I can't go lower here. This is already our discounted offer price, and no further discount is possible over chat. For that price you get the premium Panatta training floor, a fully air-conditioned club, digital lockers, free steam, plus yoga, Pilates and group classes. If you'd still like to discuss it, you're most welcome to visit the club or call our front desk on ${DESK_PHONE}.`;
export const RE_VISITED = /\b(already (visited|seen|been|came|come|checked)|have visited|i visited|visited (already|before|the (club|gym))|seen the (club|gym|facility)|been there)\b/i;
export const DESK_OTHER = `For free days, freezes, group or couple memberships, or any other special arrangement, please contact our front desk on ${DESK_PHONE}.`;
export const ADDON_OUTSIDER = `Add-on rates for non-members are different. Please call the front desk on ${DESK_PHONE} for the current rate.`;
export const ASK_DURATION = "Which membership length are you interested in: Monthly, Quarterly, Half-Yearly or Annual?";
export const FLOOR_INCLUDES = "It includes free steam access, plus yoga, Pilates and group classes.";

export const RE_SALES = {
  price: /\b(price|prices|pricing|cost|costs|fee|fees|charges?|rate|rates|how much|tariff|kitna|kitne|kitni|paisa|paise)\b|₹/i,
  discount: /\b(discount|discounts|disc|offers?|deal|deals|coupon|promo|cheaper|cheap|negotiat\w*|bargain|best price|lower (the )?price|reduce|concession|kam|less|too (much|high|expensive|costly)|expensive|costly|mehenga|mehnga|final price|last price|best rate)\b/i,
  other: /\b(freeze|unfreeze|pause|free (day|days|month|months|week|weeks|trial|pass)|extra (day|days|month|months|week|weeks)|bonus (month|months|days)|complimentary|group|couple|family|corporate|friends|bulk|waive\w*|refund|transfer)\b/i,
  addon: /\b(sauna|cold plunge|plunge|ice bath|posture|body scan|3d scan|3d posture|trueform|spectrum lounge)\b/i,
  buy: /\b(interested|i'?m in|want to (join|buy|pay|enrol|enroll|take|start)|sign me up|book (it|this|the plan)|send (me )?(the )?(payment )?link|payment link|pay (now|online)|let'?s do it|i('ll| will) take( it)?|go ahead|proceed)\b/i,
  yes: /^(yes|yeah|yep|ya|yup|sure|ok|okay|haan|han|ha|please|definitely|of course|go ahead|send( it)?|confirm(ed)?)\b/i,
  no: /^(no|nope|nah|not now|later|maybe later|nahi|na)\b/i,
};

export function matchDuration(text: string): Duration | undefined {
  const t = String(text || "").toLowerCase();
  if (/\b(annual|annually|yearly|year|1 ?yr|12 ?months?|saal)\b/.test(t)) return "annual";
  if (/\b(half[- ]?year\w*|6 ?months?|six months?|chhe mahine)\b/.test(t)) return "half_yearly";
  if (/\b(quarter\w*|3 ?months?|three months?)\b/.test(t)) return "quarterly";
  if (/\b(month|monthly|1 ?month|mahina|mahine)\b/.test(t)) return "monthly";
  return undefined;
}

function durOf(days: number): Duration | null {
  if (days >= 25 && days <= 35) return "monthly";
  if (days >= 85 && days <= 95) return "quarterly";
  if (days >= 175 && days <= 190) return "half_yearly";
  if (days >= 355 && days <= 370) return "annual";
  return null;
}
const isSpecialty = (n: string) => /pilates|day pass|trial/i.test(n);

/** Standard plan for a length = highest original price among general plans of that length. */
export function standardPlan(rows: PlanRow[], dur: Duration): PlanRow | undefined {
  return rows.filter((r) => durOf(r.duration_days) === dur && !isSpecialty(r.name) && r.price > 0)
    .sort((a, b) => b.price - a.price)[0];
}
/** Annual floor = active annual plan with the lowest positive discounted price. */
export function floorPlan(rows: PlanRow[]): PlanRow | undefined {
  return rows.filter((r) => durOf(r.duration_days) === "annual" && !isSpecialty(r.name) && Number(r.discounted_price) > 0)
    .sort((a, b) => Number(a.discounted_price) - Number(b.discounted_price))[0];
}
export const offerOf = (p: PlanRow) => (Number(p.discounted_price) > 0 && Number(p.discounted_price) < p.price ? Number(p.discounted_price) : null);
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Every amount a reply may legitimately contain (for the leak guard). */
export function allowedAmounts(rows: PlanRow[]): Set<number> {
  const s = new Set<number>();
  for (const r of rows) { if (r.price > 0) s.add(Math.round(r.price)); if (Number(r.discounted_price) > 0) s.add(Math.round(Number(r.discounted_price))); }
  return s;
}
/** True when text contains a ₹ amount that is not on the plan list. */
export function hasUnlistedAmount(text: string, allowed: Set<number>): boolean {
  const re = /(?:₹|rs\.?\s*|inr\s*)\s*([\d,]+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Math.round(Number(m[1].replace(/,/g, "")));
    if (Number.isFinite(n) && n > 0 && !allowed.has(n)) return true;
  }
  return false;
}

function stagePrice(rows: PlanRow[], q: QuoteState): { plan: PlanRow; amount: number } | null {
  if (!q.dur || !q.stage || q.stage === "desk") {
    if (q.dur && q.stage === "desk") {
      // after desk, the best price already offered still stands for a link
      const f = q.dur === "annual" ? floorPlan(rows) : undefined;
      const p = standardPlan(rows, q.dur);
      if (f && p && (offerOf(p) ?? p.price) > Number(f.discounted_price)) return { plan: f, amount: Number(f.discounted_price) };
      if (p) return { plan: p, amount: offerOf(p) ?? p.price };
    }
    return null;
  }
  if (q.stage === "floor") { const f = floorPlan(rows); return f ? { plan: f, amount: Number(f.discounted_price) } : null; }
  const p = standardPlan(rows, q.dur);
  if (!p) return null;
  return { plan: p, amount: q.stage === "offer" ? (offerOf(p) ?? p.price) : p.price };
}

function quoteOriginal(rows: PlanRow[], dur: Duration, q: QuoteState): SalesReply {
  const p = standardPlan(rows, dur);
  if (!p) return { messages: [{ text: `Our team will share the ${DUR_LABEL[dur]} membership rate with you. You can also call the front desk on ${DESK_PHONE}.`, tel: true }], quote: { ...q, dur, awaitingDuration: false }, event: "desk_handoff" };
  const offer = offerOf(p);
  if (offer) {
    return {
      messages: [
        { text: `The ${DUR_LABEL[dur]} membership (${DUR_MONTHS[dur]}) is ${inr(p.price)}, and right now it's available at our offer price of ${inr(offer)}.` },
        { text: `${dur === "annual" ? FLOOR_INCLUDES + " " : ""}This is already our discounted price. Would you like me to send a payment link, or do you have any questions?` },
      ],
      quote: { dur, stage: "offer", awaitingDuration: false }, event: "offer_revealed", plan: p, amount: offer,
    };
  }
  return {
    messages: [
      { text: `The ${DUR_LABEL[dur]} membership (${DUR_MONTHS[dur]}) is ${inr(p.price)}.` },
      { text: "It covers the Panatta training floor in a fully air-conditioned club, digital lockers and recovery access as per the plan. Would you like me to send a payment link, or do you have any questions?" },
    ],
    quote: { dur, stage: "original", awaitingDuration: false }, event: "price_quoted", plan: p, amount: p.price,
  };
}

function nextStage(rows: PlanRow[], q: QuoteState): SalesReply {
  const dur = q.dur!;
  const p = standardPlan(rows, dur);
  const offer = p ? offerOf(p) : null;
  if (q.stage === "original" && p && offer) {
    return {
      messages: [
        { text: `I can offer the ${DUR_LABEL[dur]} membership at ${inr(offer)} instead of ${inr(p.price)}.` },
        { text: "That's the full club experience: premium Panatta equipment, a calm air-conditioned space, digital lockers and our recovery suites. Shall I send the payment link at this price?" },
      ],
      quote: { ...q, stage: "offer" }, event: "offer_revealed", plan: p, amount: offer,
    };
  }
  const f = floorPlan(rows);
  const current = p ? (q.stage === "original" ? p.price : (offer ?? p.price)) : Infinity;
  if (dur === "annual" && (q.stage === "original" || q.stage === "offer") && f && Number(f.discounted_price) < current) {
    const amt = Number(f.discounted_price);
    return {
      messages: [
        { text: `As my final offer, the annual membership is ${inr(amt)}. ${FLOOR_INCLUDES}` },
        { text: "There is no further discount below this. Shall I send the payment link?" },
      ],
      quote: { ...q, stage: "floor" }, event: "floor_offered", plan: f, amount: amt,
    };
  }
  return { messages: [{ text: DESK_BEST, tel: true }], quote: { ...q, stage: "desk" }, event: "desk_handoff" };
}

/**
 * Handles one money-related turn. Returns null when the text is not about price/offers/
 * payment, so the caller's normal concierge answers it.
 * @param interest — the plan length the visitor picked during intake, if any.
 */
export function salesTurn(raw: string, q: QuoteState, rows: PlanRow[], opts: { isMember?: boolean; interest?: string | null; linksEnabled?: boolean } = {}): SalesReply | null {
  const t = String(raw ?? "").trim().slice(0, 300);
  if (!t) return null;
  const linksEnabled = opts.linksEnabled !== false;

  // Payment link confirmation
  if (q.awaitingLinkConfirm) {
    if (RE_SALES.yes.test(t) || /\bsend\b.*\blink\b/i.test(t)) {
      const sp = stagePrice(rows, q);
      if (sp && linksEnabled) return { messages: [], quote: { ...q, awaitingLinkConfirm: false }, event: null, createLink: { ...sp, stage: q.stage ?? "original" } };
      return { messages: [{ text: `Please call the front desk on ${DESK_PHONE} and they will complete your membership.`, tel: true }], quote: { ...q, awaitingLinkConfirm: false }, event: "desk_handoff" };
    }
    if (RE_SALES.no.test(t)) return { messages: [{ text: "No problem. What else would you like to know?" }], quote: { ...q, awaitingLinkConfirm: false }, event: null };
  }

  // Visitor already saw the club — don't push another visit; restate the standing offer.
  if (RE_VISITED.test(t)) {
    const sp = q.dur ? stagePrice(rows, q.stage ? q : { ...q, stage: "original" }) : null;
    if (sp && q.dur) return { messages: [{ text: `Wonderful, thank you for visiting us! So you've already experienced the club. The ${DUR_LABEL[q.dur]} membership is ${inr(sp.amount)} for you. Shall I send the payment link?` }], quote: { ...q, awaitingLinkConfirm: linksEnabled }, event: null, plan: sp.plan, amount: sp.amount };
    return { messages: [{ text: `Wonderful, thank you for visiting us! ${ASK_DURATION}` }], quote: { ...q, awaitingDuration: true }, event: null };
  }

  // Other promises: free days, freeze, group/couple, etc. Never invented.
  if (RE_SALES.other.test(t) && !/free steam/i.test(t)) return { messages: [{ text: DESK_OTHER, tel: true }], quote: { ...q, awaitingLinkConfirm: false }, event: "desk_handoff" };

  // Add-ons: members only
  if (RE_SALES.addon.test(t) && (RE_SALES.price.test(t) || RE_SALES.discount.test(t))) {
    if (opts.isMember) return null; // member channel uses get_member_addon_prices
    return { messages: [{ text: ADDON_OUTSIDER, tel: true }], quote: q, event: "desk_handoff" };
  }

  const said = matchDuration(t);
  const isPrice = RE_SALES.price.test(t);
  const isBargain = RE_SALES.discount.test(t) && !/\boffers?\b.*\binclud/i.test(t);
  const isBuy = RE_SALES.buy.test(t);

  // Duration answer after we asked
  if (q.awaitingDuration && said) return quoteOriginal(rows, said, q);

  if (isBargain) {
    const dur = said ?? q.dur;
    if (!dur) return { messages: [{ text: ASK_DURATION }], quote: { ...q, awaitingDuration: true }, event: null };
    if (!q.stage || q.dur !== dur) {
      const base = quoteOriginal(rows, dur, q);
      if (base.event === "offer_revealed") return base; // offer price already shown
      if (base.event !== "price_quoted") return base;
      return nextStage(rows, base.quote); // asking for a discount right away reveals the offer
    }
    if (q.stage === "desk") return { messages: [{ text: DESK_BEST, tel: true }], quote: q, event: "desk_handoff" };
    return nextStage(rows, q);
  }

  if (isBuy) {
    const dur = said ?? q.dur ?? matchDuration(opts.interest ?? "");
    if (!dur) return { messages: [{ text: ASK_DURATION }], quote: { ...q, awaitingDuration: true }, event: null };
    const sq: QuoteState = q.dur === dur && q.stage ? q : { dur, stage: "original" };
    const sp = stagePrice(rows, sq);
    if (!sp) return { messages: [{ text: `Please call the front desk on ${DESK_PHONE} and they will complete your membership.`, tel: true }], quote: sq, event: "desk_handoff" };
    if (!linksEnabled) return { messages: [{ text: `Wonderful! Please call the front desk on ${DESK_PHONE} to complete your ${DUR_LABEL[dur]} membership at ${inr(sp.amount)}.`, tel: true }], quote: sq, event: "desk_handoff" };
    return { messages: [{ text: `Great choice! To confirm: ${DUR_LABEL[dur]} membership at ${inr(sp.amount)}. Shall I send the payment link?` }], quote: { ...sq, awaitingLinkConfirm: true }, event: null, plan: sp.plan, amount: sp.amount };
  }

  if (isPrice || (said && /\b(plan|membership|package)\b/i.test(t))) {
    const dur = said ?? (q.dur ? undefined : matchDuration(opts.interest ?? "")) ?? q.dur;
    if (!dur) return { messages: [{ text: ASK_DURATION }], quote: { ...q, awaitingDuration: true }, event: null };
    if (q.dur === dur && q.stage && q.stage !== "original") {
      const sp = stagePrice(rows, q);
      if (sp) return { messages: [{ text: `As shared, the ${DUR_LABEL[dur]} membership is ${inr(sp.amount)} for you. Shall I send the payment link?` }], quote: { ...q, awaitingLinkConfirm: true }, event: null };
    }
    return quoteOriginal(rows, dur, q);
  }
  if (said && q.awaitingDuration === undefined && q.stage) return quoteOriginal(rows, said, q);
  return null;
}

/** Final message once a link exists. */
export function linkMessages(url: string, plan: PlanRow, amount: number, dur?: Duration): SalesMsg[] {
  return [
    { text: `Here is your secure payment link for the ${dur ? DUR_LABEL[dur] + " " : ""}membership (${inr(amount)}):`, url },
    { text: "Once payment is done, our front desk will contact you to complete your registration." },
  ];
}

/* ---------------------------- DB helpers ---------------------------- */
// deno-lint-ignore no-explicit-any
type Db = any;

export async function loadSalesCatalog(db: Db, branchId?: string | null): Promise<PlanRow[]> {
  let q = db.from("membership_plans").select("id, name, duration_days, price, discounted_price, branch_id")
    .eq("is_active", true).eq("is_visible_to_members", true);
  if (branchId) q = q.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data } = await q;
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    id: String(r.id), name: String(r.name ?? ""), duration_days: Number(r.duration_days) || 0,
    price: Number(r.price) || 0, discounted_price: r.discounted_price == null ? null : Number(r.discounted_price), branch_id: (r.branch_id as string) ?? null,
  }));
}

export async function flagEnabled(db: Db, key: string): Promise<boolean> {
  try {
    const { data } = await db.from("settings").select("value").is("branch_id", null).eq("key", key).maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    if (v === false || (v && typeof v === "object" && (v as { enabled?: unknown }).enabled === false)) return false;
    return true;
  } catch { return true; }
}

export async function logSalesEvent(db: Db, e: { branch_id?: string | null; lead_id?: string | null; channel: "web_chat" | "whatsapp"; event: string; plan_id?: string | null; amount?: number | null; metadata?: Record<string, unknown> }) {
  try { await db.from("sales_quote_events").insert({ ...e, metadata: e.metadata ?? {} }); } catch { console.error("[sales] audit insert failed"); }
}

/** Members-only add-on prices (sauna, cold plunge, 3D posture/body scan). */
export async function memberAddonPrices(db: Db, branchId: string | null): Promise<Array<{ name: string; price: number; sessions: number }>> {
  let q = db.from("benefit_packages").select("name, price, quantity, benefit_type, branch_id").eq("is_active", true)
    .in("benefit_type", ["sauna_access", "sauna_session", "ice_bath", "body_scan", "posture_scan", "steam_access"]);
  if (branchId) q = q.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data } = await q;
  return (Array.isArray(data) ? data : []).filter((r: Record<string, unknown>) => Number(r.price) > 0)
    .map((r: Record<string, unknown>) => ({ name: String(r.name), price: Number(r.price), sessions: Number(r.quantity) || 1 }));
}

/**
 * Creates (or reuses) one Razorpay payment link per lead+plan+amount. The link is not tied to
 * an invoice: payment-webhook marks it paid and the desk converts the lead and records payment.
 */
export async function ensureLeadPaymentLink(db: Db, p: { lead: { id: string; branch_id: string; full_name?: string | null; phone?: string | null; email?: string | null }; plan: PlanRow; amount: number; stage: Stage; channel: "web_chat" | "whatsapp" }): Promise<{ url: string; reused: boolean } | { error: string }> {
  const { data: existing } = await db.from("sales_payment_links").select("id, short_url")
    .eq("lead_id", p.lead.id).eq("plan_id", p.plan.id).eq("amount", p.amount).eq("status", "created").maybeSingle();
  if (existing?.short_url) return { url: existing.short_url, reused: true };

  const creds = await razorpayCreds(db, p.lead.branch_id);
  if (!creds) return { error: "no_gateway" };
  const { data: row, error } = await db.from("sales_payment_links").insert({
    branch_id: p.lead.branch_id, lead_id: p.lead.id, plan_id: p.plan.id, amount: p.amount, stage: p.stage, channel: p.channel,
  }).select("id").single();
  if (error || !row) {
    const { data: again } = await db.from("sales_payment_links").select("short_url")
      .eq("lead_id", p.lead.id).eq("plan_id", p.plan.id).eq("amount", p.amount).eq("status", "created").maybeSingle();
    return again?.short_url ? { url: again.short_url, reused: true } : { error: "link_conflict" };
  }
  const digits = String(p.lead.phone ?? "").replace(/\D/g, "").slice(-10);
  const body = {
    amount: Math.round(p.amount * 100), currency: "INR", accept_partial: false,
    reference_id: `sl-${String(row.id).replace(/-/g, "").slice(0, 32)}`,
    description: `${p.plan.name} membership`,
    customer: { name: p.lead.full_name || undefined, email: p.lead.email || undefined, contact: digits.length === 10 ? `+91${digits}` : undefined },
    notify: { sms: false, email: false }, reminder_enable: false,
    notes: { kind: "sales_lead", sales_link_id: row.id, lead_id: p.lead.id, plan_id: p.plan.id },
  };
  try {
    const resp = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${creds.key_id}:${creds.key_secret}`) },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.short_url) {
      await db.from("sales_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", row.id);
      return { error: "gateway_failed" };
    }
    await db.from("sales_payment_links").update({ gateway_link_id: data.id, short_url: data.short_url, updated_at: new Date().toISOString() }).eq("id", row.id);
    // Desk task so a person follows every link.
    try {
      await db.from("tasks").insert({
        branch_id: p.lead.branch_id, title: `Payment link sent: ${p.lead.full_name || "enquiry"} – ${p.plan.name} ${inr(p.amount)}`,
        description: `Sent via ${p.channel === "web_chat" ? "website chat" : "WhatsApp"} at the ${p.stage} price. Confirm payment, convert the lead and record the payment.`,
        priority: "high", status: "pending", linked_entity_type: "lead", linked_entity_id: p.lead.id,
      });
    } catch { console.error("[sales] desk task insert failed"); }
    return { url: data.short_url, reused: false };
  } catch {
    await db.from("sales_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", row.id);
    return { error: "gateway_unavailable" };
  }
}

async function razorpayCreds(db: Db, branchId: string): Promise<{ key_id: string; key_secret: string } | null> {
  for (const scope of [branchId, null]) {
    let q = db.from("integration_settings").select("credentials").eq("integration_type", "payment_gateway").eq("provider", "razorpay").eq("is_active", true);
    q = scope ? q.eq("branch_id", scope) : q.is("branch_id", null);
    const { data } = await q.maybeSingle();
    const c = data?.credentials;
    if (c?.key_id && c?.key_secret) return { key_id: c.key_id, key_secret: c.key_secret };
  }
  return null;
}
