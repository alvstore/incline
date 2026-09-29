// whatsapp-member-menu.ts — v1.1.0
// Deterministic (zero-LLM) WhatsApp self-service gateway for ACTIVE members.
//
// Epic 1  Phone normalisation + active-member resolution
// Epic 2  Interactive menu engine + 8 deterministic handlers
// Epic 3  Free-text exception triage -> high priority `tasks` + instant ack
// Epic 4  Non-members fall through to the Ananya lead agent (caller decides)
//
// The caller (whatsapp-webhook / meta-webhook) passes the inbound text; we
// return a reply string. When the reply is an interactive block we return the
// canonical brain JSON shape ({"type":"interactive_list", ...}) which
// `sendAiReply` already knows how to turn into a Meta payload.

// deno-lint-ignore-file no-explicit-any

const PORTAL = "https://theincline.in";
const IST = "Asia/Kolkata";

export interface MemberContext {
  memberId: string;
  branchId: string;
  memberCode: string | null;
  fullName: string;
  firstName: string;
  assignedTrainerId: string | null;
  gender: string | null;
}

// ─── Epic 1: phone normalisation ──────────────────────────────────────────────

export function phoneVariants(raw: string): string[] {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return [];
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  const set = new Set<string>([digits, local, `91${local}`, `+91${local}`, `+${digits}`]);
  return [...set].filter(Boolean);
}

export async function resolveActiveMember(
  supabase: any,
  phone: string,
  branchId: string | null,
): Promise<MemberContext | null> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return null;

  const build = (m: any, profileName?: string | null, profileGender?: string | null): MemberContext => {
    const fullName = profileName || m?.profiles?.full_name || "there";
    return {
      memberId: m.id,
      branchId: m.branch_id,
      memberCode: m.member_code ?? null,
      fullName,
      firstName: String(fullName).trim().split(/\s+/)[0] || "there",
      assignedTrainerId: m.assigned_trainer_id ?? null,
      gender: (profileGender ?? m?.profiles?.gender ?? null) as string | null,
    };
  };

  // Primary: profiles.phone -> members
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, gender")
    .in("phone", variants)
    .limit(5);

  for (const p of profiles ?? []) {
    const { data: m } = await supabase
      .from("members")
      .select("id, branch_id, member_code, status, assigned_trainer_id")
      .eq("user_id", p.id)
      .eq("status", "active")
      .maybeSingle();
    if (m) return build(m, p.full_name, p.gender);
  }

  // Fallback: an alternate / international number linked to a member
  const { data: linked } = await supabase
    .from("whatsapp_chat_settings")
    .select("linked_member_id")
    .in("phone_number", variants)
    .not("linked_member_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (linked?.linked_member_id) {
    const { data: m } = await supabase
      .from("members")
      .select("id, branch_id, member_code, status, assigned_trainer_id, profiles:user_id(full_name, gender)")
      .eq("id", linked.linked_member_id)
      .eq("status", "active")
      .maybeSingle();
    if (m) return build(m);
  }

  return null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const istDate = (d = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d); // YYYY-MM-DD

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const prettyDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC", day: "numeric", month: "short",
  });

const weekday = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short" });

// "Today" / "Tomorrow" / "Thu 2 Oct"
const dayLabel = (iso: string): string => {
  const today = istDate();
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return `${weekday(iso)} ${prettyDate(iso)}`;
};

// Compact variant that fits Meta's 24-char row titles: "Today" / "Tmrw" / "2 Oct"
const dayShort = (iso: string): string => {
  const today = istDate();
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tmrw";
  return prettyDate(iso);
};

// Initials used to keep slot row titles unique per facility: "Steam room" -> "SR"
const typeInitials = (name: string): string =>
  String(name).split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

const prettyTime = (hhmmss: string): string => {
  const [h, m] = String(hhmmss).split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
};

const tsTime = (ts: string): string =>
  new Date(ts).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cut = (s: string, n: number) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

interface Row { id: string; title: string; description?: string }

function list(body: string, button: string, rows: Row[], title = "Options"): string {
  return JSON.stringify({
    type: "interactive_list",
    body,
    button: cut(button, 20),
    sections: [{ title: cut(title, 24), rows: rows.slice(0, 10).map((r) => ({
      id: r.id,
      title: cut(r.title, 24),
      ...(r.description ? { description: cut(r.description, 72) } : {}),
    })) }],
  });
}

const BACK = "\n\nReply *Menu* anytime to return to the options.";

// ─── the menu ─────────────────────────────────────────────────────────────────

const MENU: Row[] = [
  { id: "MENU_MEMBERSHIP", title: "Membership details", description: "Plan, validity and days left" },
  { id: "MENU_CLASS", title: "Book a class", description: "Today's group class schedule" },
  { id: "MENU_RECOVERY", title: "Book recovery suite", description: "Steam, ice bath or sauna" },
  { id: "MENU_BALANCE", title: "My benefit balance", description: "Sessions left on every benefit" },
  { id: "MENU_TRAINER", title: "My trainer & sessions", description: "Coach and training balance" },
  { id: "MENU_MY_PLANS", title: "My workout & diet", description: "Open your assigned plans" },
  { id: "MENU_REQUEST_PLAN", title: "Request a new plan", description: "Ask your coach for a plan" },
  { id: "MENU_ATTENDANCE", title: "Last 7 days visits", description: "Your recent check-ins" },
  { id: "MENU_HUMAN", title: "Speak with front desk", description: "A team member will reply" },
];

function mainMenu(ctx: MemberContext): string {
  return list(
    `Welcome back, ${ctx.firstName}! ✨\nChoose what you'd like to do at Incline:`,
    "View services",
    MENU,
    "Incline Member Gateway",
  );
}

const GREETING_RE = /^(hi|hii+|hey+|hello|menu|main menu|start|options|help|namaste|hola)\b[!. ]*$/i;

// ─── handlers ─────────────────────────────────────────────────────────────────

async function activeMembership(supabase: any, memberId: string) {
  const today = istDate();
  const { data } = await supabase
    .from("memberships")
    .select("id, start_date, end_date, status, membership_plans:plan_id(name)")
    .eq("member_id", memberId)
    .eq("status", "active")
    .gte("end_date", today)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function handleMembership(supabase: any, ctx: MemberContext): Promise<string> {
  const ms = await activeMembership(supabase, ctx.memberId);
  if (!ms) {
    return `Hi ${ctx.firstName}, I can't see an active membership on your account right now. Our front desk can sort this out for you — reply *Front desk* and we'll get on it.${BACK}`;
  }
  const daysLeft = Math.max(
    0,
    Math.round((new Date(`${ms.end_date}T00:00:00Z`).getTime() - new Date(`${istDate()}T00:00:00Z`).getTime()) / 86400000),
  );
  return [
    "💳 *Your Incline membership*",
    "",
    `Name: ${ctx.fullName}${ctx.memberCode ? ` (${ctx.memberCode})` : ""}`,
    `Plan: ${ms.membership_plans?.name ?? "Membership"}`,
    `Started: ${prettyDate(ms.start_date)}`,
    `Valid till: ${prettyDate(ms.end_date)}`,
    `Days remaining: ${daysLeft}`,
  ].join("\n") + BACK;
}

// Upcoming classes: today's remaining sessions first, then the next 7 days.
// (Members message us in the evening, when today's schedule is already over.)
async function upcomingClasses(supabase: any, ctx: MemberContext) {
  const today = istDate();
  const { data } = await supabase
    .from("classes")
    .select("id, name, scheduled_at, capacity, booked_count, venue, external_trainer_name, session_date")
    .eq("branch_id", ctx.branchId)
    .gte("session_date", today)
    .lte("session_date", addDays(today, 7))
    .eq("is_active", true)
    .is("cancelled_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(40);
  return (data ?? [])
    .filter((c: any) => new Date(c.scheduled_at).getTime() > Date.now() - 15 * 60_000)
    .slice(0, 9);
}

const classRowTitle = (c: any) =>
  cut(`${cut(c.name, 9)} ${dayShort(c.session_date)} ${tsTime(c.scheduled_at).replace(/\s/g, "")}`, 24);

async function handleClasses(supabase: any, ctx: MemberContext): Promise<string> {
  const classes = await upcomingClasses(supabase, ctx);
  if (classes.length === 0) {
    return `No group classes on the schedule for the coming week, ${ctx.firstName}. Your portal always has the latest: ${PORTAL}/my-classes${BACK}`;
  }
  const today = istDate();
  const rows: Row[] = classes.map((c: any) => {
    const left = Math.max(0, (c.capacity ?? 0) - (c.booked_count ?? 0));
    return {
      id: `CLASS:${c.id}`,
      title: classRowTitle(c),
      description: cut(
        `${c.name} · ${dayLabel(c.session_date)} ${tsTime(c.scheduled_at)} · ${left > 0 ? `${left} spots left` : "Full"}`,
        72,
      ),
    };
  });
  const scope = classes.every((c: any) => c.session_date === today) ? "Today's classes" : "Upcoming classes";
  return list(`${scope} at Incline, ${ctx.firstName}. Tap one to book instantly:`, "See classes", rows, cut(scope, 24));
}

async function bookClassByTitle(supabase: any, ctx: MemberContext, title: string): Promise<string | null> {
  const classes = await upcomingClasses(supabase, ctx);
  const match = classes.find((c: any) => norm(classRowTitle(c)) === norm(title));
  if (!match) return null;
  const { data, error } = await supabase.rpc("book_class", { _class_id: match.id, _member_id: ctx.memberId });
  if (error) return `I couldn't complete that booking just now (${error.message}). Please try again or reply *Front desk*.${BACK}`;
  if (!data?.success) return `I couldn't book that class: ${data?.error ?? "not available"}.${BACK}`;
  return `✅ You're booked for *${match.name}* on ${dayLabel(match.session_date)} at ${tsTime(match.scheduled_at)}. See you on the floor!${BACK}`;
}

// Recovery rooms are gender-specific (Steam Room Male / Steam Room Female …).
// Only the facilities matching the member's profile gender may be offered,
// otherwise the same 6:00 AM steam slot shows up twice — once per room.
async function recoveryContext(supabase: any, ctx: MemberContext) {
  const g = String(ctx.gender ?? "").toLowerCase();

  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name, benefit_type_id, gender_access, is_active, under_maintenance")
    .eq("branch_id", ctx.branchId)
    .eq("is_active", true);

  const facIdsByType = new Map<string, string[]>();
  for (const f of facilities ?? []) {
    if (f.under_maintenance) continue;
    const access = String(f.gender_access ?? "all").toLowerCase();
    const allowed = access === "all" || access === "any" || !access || (g ? access === g : true);
    if (!allowed || !f.benefit_type_id) continue;
    const arr = facIdsByType.get(f.benefit_type_id) ?? [];
    arr.push(f.id);
    facIdsByType.set(f.benefit_type_id, arr);
  }

  const { data: allTypes } = await supabase
    .from("benefit_types")
    .select("id, name, code")
    .eq("branch_id", ctx.branchId)
    .eq("is_bookable", true)
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .limit(20);

  const types = (allTypes ?? []).filter((t: any) => (facIdsByType.get(t.id) ?? []).length > 0);
  return { types, facIdsByType };
}

async function unitsFor(supabase: any, ctx: MemberContext, membershipId: string | null, typeId: string): Promise<number> {
  const { data } = await supabase.rpc("benefit_available_units", {
    p_member_id: ctx.memberId,
    p_membership_id: membershipId,
    p_benefit_type: "other",
    p_benefit_type_id: typeId,
    p_date: istDate(),
  });
  return typeof data === "number" ? data : 0;
}

const RECOVERY_WINDOW_DAYS = 6; // today + 6 => a full week of choices

// Step 1 — which recovery service (only those with sessions left).
async function handleRecovery(supabase: any, ctx: MemberContext): Promise<string> {
  const { types } = await recoveryContext(supabase, ctx);
  if (types.length === 0) {
    return `Recovery bookings aren't open on WhatsApp right now. You can book from your portal: ${PORTAL}/my-benefits${BACK}`;
  }
  const ms = await activeMembership(supabase, ctx.memberId);
  const rows: Row[] = [];
  for (const t of types) {
    const units = await unitsFor(supabase, ctx, ms?.id ?? null, t.id);
    if (units === 0) continue;
    rows.push({
      id: `FAC:${t.id}`,
      title: cut(t.name, 24),
      description: units < 0 ? "Unlimited · tap to pick a day" : `${units} session${units === 1 ? "" : "s"} left · tap to pick a day`,
    });
  }
  if (rows.length === 0) {
    return `You don't have any steam, sauna or ice bath sessions left right now, ${ctx.firstName}. Reply *Front desk* to add sessions or see add-ons at ${PORTAL}/my-benefits${BACK}`;
  }
  return list(`Which recovery service would you like, ${ctx.firstName}? Only services with sessions left are shown.`, "See services", rows, "Recovery suite");
}

async function openSlots(
  supabase: any,
  ctx: MemberContext,
  facilityIds: string[],
  dateFrom: string,
  dateTo: string,
) {
  if (facilityIds.length === 0) return [];
  const today = istDate();
  const { data } = await supabase
    .from("benefit_slots")
    .select("id, slot_date, start_time, end_time, capacity, booked_count, facility_id")
    .eq("branch_id", ctx.branchId)
    .in("facility_id", facilityIds)
    .eq("is_active", true)
    .gte("slot_date", dateFrom)
    .lte("slot_date", dateTo)
    .order("slot_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(400);

  const nowHm = new Date().toLocaleTimeString("en-GB", { timeZone: IST, hour12: false }).slice(0, 5);
  const seen = new Set<string>();
  return (data ?? [])
    .filter((s: any) => (s.capacity ?? 0) - (s.booked_count ?? 0) > 0)
    .filter((s: any) => s.slot_date !== today || String(s.start_time).slice(0, 5) > nowHm)
    .filter((s: any) => {
      const key = `${s.slot_date}|${String(s.start_time).slice(0, 5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Row titles are the only thing Meta echoes back, so they must be unique and
// short enough (24 chars) to survive without truncation.
const dateRowTitle = (typeName: string, iso: string) => cut(`${typeInitials(typeName)} · ${dayShort(iso)}`, 24);
const slotRowTitle = (typeName: string, s: any) =>
  cut(`${typeInitials(typeName)} ${dayShort(s.slot_date)} ${prettyTime(s.start_time).replace(/\s/g, "")}`, 24);

// Step 2 — which day.
async function handleFacilityDates(supabase: any, ctx: MemberContext, typeId: string, typeName: string): Promise<string> {
  const ms = await activeMembership(supabase, ctx.memberId);
  const units = await unitsFor(supabase, ctx, ms?.id ?? null, typeId);
  if (units === 0) {
    return `You have no ${typeName} sessions left, ${ctx.firstName}. Reply *Front desk* to add sessions.${BACK}`;
  }
  const { facIdsByType } = await recoveryContext(supabase, ctx);
  const today = istDate();
  const slots = await openSlots(supabase, ctx, facIdsByType.get(typeId) ?? [], today, addDays(today, RECOVERY_WINDOW_DAYS));
  if (slots.length === 0) {
    return `No open ${typeName} times in the next week, ${ctx.firstName}. Our front desk can help — reply *Front desk*, or check ${PORTAL}/my-benefits${BACK}`;
  }

  const byDate = new Map<string, number>();
  for (const s of slots) byDate.set(s.slot_date, (byDate.get(s.slot_date) ?? 0) + 1);

  const rows: Row[] = [...byDate.entries()].slice(0, 9).map(([iso, count]) => ({
    id: `FACDATE:${typeId}:${iso}`,
    title: dateRowTitle(typeName, iso),
    description: cut(`${dayLabel(iso)} · ${count} time${count === 1 ? "" : "s"} open`, 72),
  }));

  const left = units < 0 ? "unlimited sessions" : `${units} session${units === 1 ? "" : "s"} left`;
  return list(
    `${typeName} — you have ${left}.\nWhich day would you like, ${ctx.firstName}?`,
    "Pick a day",
    rows,
    cut(`${typeName} · days`, 24),
  );
}

// Step 3 — which time on that day.
async function handleFacilityTimes(
  supabase: any,
  ctx: MemberContext,
  typeId: string,
  typeName: string,
  iso: string,
): Promise<string> {
  const { facIdsByType } = await recoveryContext(supabase, ctx);
  const slots = await openSlots(supabase, ctx, facIdsByType.get(typeId) ?? [], iso, iso);
  if (slots.length === 0) {
    return `${typeName} is fully booked on ${dayLabel(iso)}, ${ctx.firstName}. Reply *Book recovery suite* to pick another day.${BACK}`;
  }
  const rows: Row[] = slots.slice(0, 9).map((s: any) => ({
    id: `SLOT:${s.id}`,
    title: slotRowTitle(typeName, s),
    description: cut(
      `${prettyTime(s.start_time)}${s.end_time ? ` – ${prettyTime(s.end_time)}` : ""} · ${(s.capacity ?? 0) - (s.booked_count ?? 0)} spots open`,
      72,
    ),
  }));
  return list(
    `${typeName} · ${dayLabel(iso)}\nTap a time to reserve it, ${ctx.firstName}:`,
    "Pick a time",
    rows,
    cut(`${dayLabel(iso)} times`, 24),
  );
}

// Resolve a tapped day row ("SR · Tmrw") back to its service + date.
async function dateTapTarget(supabase: any, ctx: MemberContext, title: string) {
  const { types } = await recoveryContext(supabase, ctx);
  const today = istDate();
  const n = norm(title);
  for (const t of types) {
    for (let i = 0; i <= RECOVERY_WINDOW_DAYS; i++) {
      const iso = addDays(today, i);
      if (norm(dateRowTitle(t.name, iso)) === n) return { typeId: t.id, typeName: t.name, iso };
    }
  }
  return null;
}

async function bookSlotByTitle(supabase: any, ctx: MemberContext, title: string): Promise<string | null> {
  const { types, facIdsByType } = await recoveryContext(supabase, ctx);
  const today = istDate();
  const n = norm(title);
  for (const t of types) {
    const slots = await openSlots(supabase, ctx, facIdsByType.get(t.id) ?? [], today, addDays(today, RECOVERY_WINDOW_DAYS));
    const match = slots.find((s: any) => norm(slotRowTitle(t.name, s)) === n);
    if (!match) continue;
    const ms = await activeMembership(supabase, ctx.memberId);
    const { data, error } = await supabase.rpc("book_facility_slot", {
      p_slot_id: match.id,
      p_member_id: ctx.memberId,
      p_membership_id: ms?.id ?? null,
      p_source: "whatsapp_ai",
    });
    if (error) return `I couldn't reserve that slot (${error.message}). Please try another time or reply *Front desk*.${BACK}`;
    if (!data?.success) return `I couldn't reserve that slot: ${data?.error ?? "not available"}.${BACK}`;
    const left = await unitsFor(supabase, ctx, ms?.id ?? null, t.id);
    const leftTxt = left < 0 ? "" : ` You have ${left} ${t.name} session${left === 1 ? "" : "s"} left.`;
    return `✅ Reserved — *${t.name}* on ${dayLabel(match.slot_date)} at ${prettyTime(match.start_time)}.${leftTxt} Please arrive 5 minutes early.${BACK}`;
  }
  return null;
}

async function handleBalance(supabase: any, ctx: MemberContext): Promise<string> {
  const ms = await activeMembership(supabase, ctx.memberId);
  const ids = new Map<string, string>();

  if (ms) {
    const { data: plan } = await supabase
      .from("memberships")
      .select("plan_id")
      .eq("id", ms.id)
      .maybeSingle();
    if (plan?.plan_id) {
      const { data: pbs } = await supabase
        .from("plan_benefits")
        .select("benefit_type, benefit_type_id, benefit_types:benefit_type_id(name)")
        .eq("plan_id", plan.plan_id);
      for (const pb of pbs ?? []) {
        if (pb.benefit_type_id) ids.set(pb.benefit_type_id, pb.benefit_types?.name ?? pb.benefit_type);
      }
    }
  }

  for (const table of ["member_benefit_credits", "member_comps"]) {
    const { data } = await supabase
      .from(table)
      .select("benefit_type_id, benefit_types:benefit_type_id(name)")
      .eq("member_id", ctx.memberId);
    for (const r of data ?? []) {
      if (r.benefit_type_id && !ids.has(r.benefit_type_id)) ids.set(r.benefit_type_id, r.benefit_types?.name ?? "Benefit");
    }
  }

  if (ids.size === 0) {
    return `I couldn't find any session-based benefits on your account yet, ${ctx.firstName}. Your full list is here: ${PORTAL}/my-benefits${BACK}`;
  }

  const lines: string[] = [];
  for (const [typeId, name] of ids) {
    const { data: units } = await supabase.rpc("benefit_available_units", {
      p_member_id: ctx.memberId,
      p_membership_id: ms?.id ?? null,
      p_benefit_type: "other",
      p_benefit_type_id: typeId,
      p_date: istDate(),
    });
    const n = typeof units === "number" ? units : 0;
    lines.push(`• ${name}: ${n < 0 ? "Unlimited" : `${n} left`}`);
  }

  return `📊 *Your benefit balance*\n\n${lines.join("\n")}\n\nFull details: ${PORTAL}/my-benefits${BACK}`;
}

async function handleTrainer(supabase: any, ctx: MemberContext): Promise<string> {
  const lines: string[] = ["🥊 *Your coaching*", ""];

  let trainerName: string | null = null;
  if (ctx.assignedTrainerId) {
    const { data: t } = await supabase
      .from("trainers")
      .select("specializations, profiles:user_id(full_name, phone)")
      .eq("id", ctx.assignedTrainerId)
      .maybeSingle();
    trainerName = t?.profiles?.full_name ?? null;
    if (trainerName) {
      lines.push(`Assigned trainer: ${trainerName}`);
      if (Array.isArray(t?.specializations) && t.specializations.length) {
        lines.push(`Focus: ${t.specializations.slice(0, 3).join(", ")}`);
      }
    }
  }

  const { data: pt } = await supabase
    .from("member_pt_packages")
    .select("sessions_total, sessions_used, sessions_remaining, expiry_date, package_type, pt_packages:package_id(name), trainers:trainer_id(profiles:user_id(full_name))")
    .eq("member_id", ctx.memberId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pt) {
    lines.push("");
    lines.push(`Package: ${pt.pt_packages?.name ?? "Personal training"}`);
    if (pt.package_type === "monthly") {
      lines.push(`Coaching valid till: ${pt.expiry_date ? prettyDate(pt.expiry_date) : "—"}`);
    } else {
      lines.push(`Sessions: ${pt.sessions_remaining ?? 0} of ${pt.sessions_total ?? 0} remaining`);
      if (pt.expiry_date) lines.push(`Valid till: ${prettyDate(pt.expiry_date)}`);
    }
    const coach = pt.trainers?.profiles?.full_name;
    if (coach && coach !== trainerName) lines.push(`Coach: ${coach}`);
  } else if (!trainerName) {
    return `You don't have a trainer assigned yet, ${ctx.firstName}. Reply *Front desk* and our team will match you with a coach.${BACK}`;
  } else {
    lines.push("");
    lines.push("No active personal-training package right now.");
  }

  return lines.join("\n") + BACK;
}

async function handleMyPlans(supabase: any, ctx: MemberContext): Promise<string> {
  const today = istDate();
  // Show the latest plan of each kind even when its validity window has passed —
  // a member whose diet plan expired still wants to open it (and know it lapsed).
  const { data: plans } = await supabase
    .from("member_fitness_plans")
    .select("plan_type, plan_name, valid_until, source_kind")
    .eq("member_id", ctx.memberId)
    .order("created_at", { ascending: false })
    .limit(20);

  const pick = (kind: string) => {
    const of = (plans ?? []).filter((p: any) => p.plan_type === kind);
    return of.find((p: any) => !p.valid_until || p.valid_until >= today) ?? of[0] ?? null;
  };

  const workout = pick("workout");
  let diet = pick("diet");

  if (!diet) {
    const { data: dp } = await supabase
      .from("diet_plans")
      .select("name, end_date")
      .eq("member_id", ctx.memberId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dp) diet = { plan_name: dp.name, plan_type: "diet", valid_until: dp.end_date } as any;
  }

  if (!workout && !diet) {
    return `You don't have a workout or diet plan assigned yet, ${ctx.firstName}. Reply *Request plan* and I'll ask your coach to prepare one.${BACK}`;
  }

  const stamp = (p: any) => {
    if (!p?.valid_until) return "";
    return p.valid_until >= today
      ? `\nValid till: ${prettyDate(p.valid_until)}`
      : `\n⚠️ Expired on ${prettyDate(p.valid_until)} — reply *Request plan* for a fresh one.`;
  };

  const lines = ["📥 *Your assigned plans*", ""];
  if (workout) {
    lines.push(`🏋️ Workout: ${workout.plan_name}${stamp(workout)}\nOpen & download: ${PORTAL}/my-workout`);
  } else {
    lines.push("🏋️ Workout: none assigned yet — reply *Request plan*.");
  }
  lines.push("");
  if (diet) {
    lines.push(`🥗 Diet: ${diet.plan_name}${stamp(diet)}\nOpen & download: ${PORTAL}/my-diet`);
  } else {
    lines.push("🥗 Diet: none assigned yet — reply *Request plan*.");
  }
  lines.push("");
  lines.push("Sign in with your registered number to view or download.");
  return lines.join("\n") + BACK;
}

async function createTask(
  supabase: any,
  ctx: MemberContext,
  title: string,
  description: string,
  slaHours: number,
): Promise<void> {
  let assignedTo: string | null = null;
  if (ctx.assignedTrainerId) {
    const { data: t } = await supabase.from("trainers").select("user_id").eq("id", ctx.assignedTrainerId).maybeSingle();
    assignedTo = t?.user_id ?? null;
  }
  await supabase.from("tasks").insert({
    branch_id: ctx.branchId,
    title: cut(title, 120),
    description,
    priority: "high",
    status: "pending",
    assigned_to: assignedTo,
    sla_hours: slaHours,
    linked_entity_type: "member",
    linked_entity_id: ctx.memberId,
    member_created: true,
  });
}

function handleRequestPlanMenu(ctx: MemberContext): string {
  return list(
    `What would you like your coach to prepare, ${ctx.firstName}?`,
    "Choose",
    [
      { id: "REQ_WORKOUT", title: "Workout plan", description: "A training programme built for you" },
      { id: "REQ_DIET", title: "Diet plan", description: "A nutrition plan built for you" },
      { id: "REQ_BOTH", title: "Both plans", description: "Workout and diet together" },
    ],
    "Request a plan",
  );
}

async function handleRequestPlan(supabase: any, ctx: MemberContext, kind: "workout" | "diet" | "both"): Promise<string> {
  const label = kind === "both" ? "workout & diet plan" : `${kind} plan`;
  await createTask(
    supabase,
    ctx,
    `Plan request: ${ctx.fullName}`,
    `${ctx.fullName}${ctx.memberCode ? ` (${ctx.memberCode})` : ""} requested a ${label} via WhatsApp.`,
    24,
  );
  return `Done, ${ctx.firstName}! Your request for a ${label} has gone to your coach. They'll publish it to your portal shortly. ✨${BACK}`;
}

async function handleAttendance(supabase: any, ctx: MemberContext): Promise<string> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from("member_attendance")
    .select("check_in, check_out")
    .eq("member_id", ctx.memberId)
    .gte("check_in", since)
    .order("check_in", { ascending: false })
    .limit(20);

  if (!data || data.length === 0) {
    return `No check-ins in the last 7 days, ${ctx.firstName}. We'd love to see you back on the floor! 💪${BACK}`;
  }

  const lines = data.map((a: any) => {
    const day = new Date(a.check_in).toLocaleDateString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" });
    const out = a.check_out ? tsTime(a.check_out) : "—";
    let dur = "";
    if (a.check_out) {
      const mins = Math.round((new Date(a.check_out).getTime() - new Date(a.check_in).getTime()) / 60000);
      dur = ` · ${Math.floor(mins / 60)}h ${mins % 60}m`;
    }
    return `• ${day}: ${tsTime(a.check_in)} → ${out}${dur}`;
  });

  return `🕒 *Last 7 days*\n\n${lines.join("\n")}\n\nTotal visits: ${data.length}${BACK}`;
}

async function handleHuman(supabase: any, ctx: MemberContext, phone: string): Promise<string> {
  await supabase.from("whatsapp_chat_settings").upsert(
    {
      branch_id: ctx.branchId,
      phone_number: phone,
      bot_active: false,
      bot_paused_until: new Date(Date.now() + 4 * 3600_000).toISOString(),
      bot_paused_reason: "member_requested_front_desk",
      handoff_reason: "member_requested_front_desk",
      handoff_requested_at: new Date().toISOString(),
      is_unread: true,
    },
    { onConflict: "branch_id,phone_number" },
  );
  await createTask(
    supabase,
    ctx,
    `Front desk request: ${ctx.fullName}`,
    `${ctx.fullName}${ctx.memberCode ? ` (${ctx.memberCode})` : ""} asked to speak with the front desk on WhatsApp (${phone}).`,
    2,
  );
  return `Our front desk team on duty has been notified, ${ctx.firstName}. Someone will reply to you here shortly. ✨`;
}

async function handleTriage(supabase: any, ctx: MemberContext, text: string, phone: string): Promise<string> {
  await createTask(
    supabase,
    ctx,
    `Member WhatsApp: ${ctx.fullName}`,
    `"${cut(text, 900)}"\n\nFrom: ${phone}${ctx.memberCode ? ` · ${ctx.memberCode}` : ""}`,
    2,
  );
  await supabase.from("whatsapp_chat_settings").upsert(
    { branch_id: ctx.branchId, phone_number: phone, is_unread: true },
    { onConflict: "branch_id,phone_number" },
  );
  return `Got it, ${ctx.firstName}! I've flagged your message to our front desk manager on duty. Someone from our team will respond to you right away. ✨${BACK}`;
}

// ─── router ───────────────────────────────────────────────────────────────────

export async function runMemberGateway(
  supabase: any,
  ctx: MemberContext,
  text: string,
  phone: string,
): Promise<string> {
  const raw = String(text || "").trim();
  const n = norm(raw);

  if (!raw || GREETING_RE.test(raw)) return mainMenu(ctx);

  // Exact sub-menu taps first (service / day / time titles echoed back by Meta),
  // otherwise keyword routing below would bounce "Steam room" back to the menu.
  const menuMatch = MENU.find((r) => norm(r.title) === n);
  if (!menuMatch) {
    const { types } = await recoveryContext(supabase, ctx);
    const fac = types.find((t: any) => norm(cut(t.name, 24)) === n);
    if (fac) return await handleFacilityDates(supabase, ctx, fac.id, fac.name);

    const dayTap = await dateTapTarget(supabase, ctx, raw);
    if (dayTap) return await handleFacilityTimes(supabase, ctx, dayTap.typeId, dayTap.typeName, dayTap.iso);

    const slotTap = await bookSlotByTitle(supabase, ctx, raw);
    if (slotTap) return slotTap;

    const classTap = await bookClassByTitle(supabase, ctx, raw);
    if (classTap) return classTap;
  }
  const pick = menuMatch?.id
    ?? (/(membership|my plan\b|validity|expiry)/.test(n) ? "MENU_MEMBERSHIP" : null)
    ?? (/(book a class|class|yoga|pilates|zumba|hiit)/.test(n) ? "MENU_CLASS" : null)
    ?? (/(recovery|steam|sauna|ice bath|cold plunge)/.test(n) ? "MENU_RECOVERY" : null)
    ?? (/(balance|sessions left|benefit)/.test(n) ? "MENU_BALANCE" : null)
    ?? (/(trainer|coach|pt session)/.test(n) ? "MENU_TRAINER" : null)
    ?? (/(request plan|new plan|need a plan)/.test(n) ? "MENU_REQUEST_PLAN" : null)
    ?? (/(my workout|my diet|download plan|diet plan|workout plan)/.test(n) ? "MENU_MY_PLANS" : null)
    ?? (/(attendance|visits|check in history|last 7 days)/.test(n) ? "MENU_ATTENDANCE" : null)
    ?? (/(front desk|human|agent|talk to someone|manager)/.test(n) ? "MENU_HUMAN" : null);

  switch (pick) {
    case "MENU_MEMBERSHIP": return await handleMembership(supabase, ctx);
    case "MENU_CLASS": return await handleClasses(supabase, ctx);
    case "MENU_RECOVERY": return await handleRecovery(supabase, ctx);
    case "MENU_BALANCE": return await handleBalance(supabase, ctx);
    case "MENU_TRAINER": return await handleTrainer(supabase, ctx);
    case "MENU_MY_PLANS": return await handleMyPlans(supabase, ctx);
    case "MENU_REQUEST_PLAN": return handleRequestPlanMenu(ctx);
    case "MENU_ATTENDANCE": return await handleAttendance(supabase, ctx);
    case "MENU_HUMAN": return await handleHuman(supabase, ctx, phone);
  }

  // Plan-request sub-menu
  if (n === "workout plan") return await handleRequestPlan(supabase, ctx, "workout");
  if (n === "diet plan") return await handleRequestPlan(supabase, ctx, "diet");
  if (n === "both plans") return await handleRequestPlan(supabase, ctx, "both");

  // Epic 3 — everything else is an operational exception: triage it.
  return await handleTriage(supabase, ctx, raw, phone);
}
