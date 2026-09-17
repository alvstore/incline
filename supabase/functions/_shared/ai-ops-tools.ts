// Internal-team (staff) operations tools — live business data over chat.
// v1.0.0
//
// SECURITY: these tools are ONLY wired into runStaffAgent, which is reached
// exclusively when resolveMemberContext confirms the sender is internal team
// (trainer / employee / privileged user_role). Financial tools are further
// gated to owner / admin / manager. Members and leads can never reach them.

export type StaffRole = string;

const FINANCIAL_ROLES = ["owner", "admin", "manager"];

export function isFinancialRole(role: StaffRole | undefined | null): boolean {
  return FINANCIAL_ROLES.includes(String(role || "").toLowerCase());
}

function tool(
  name: string,
  description: string,
  paramsSpec: Record<string, [string, string]> = {},
  required: string[] = [],
) {
  const properties: Record<string, any> = {};
  for (const [k, [type, desc]] of Object.entries(paramsSpec)) {
    properties[k] = { type, description: desc };
  }
  return {
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

/** Tool definitions available to an internal team member. */
export function getOpsToolDefinitions(role: StaffRole | undefined): any[] {
  const base = [
    tool(
      "get_daily_ops_summary",
      "Live business summary for a given day (defaults to today, IST): check-ins, new memberships, renewals, invoiced sales, payments received by mode, dues collected and dues still outstanding.",
      { date: ["string", "YYYY-MM-DD in IST. Defaults to today."] },
    ),
    tool(
      "list_expiring_memberships",
      "Members whose membership expires within the next N days — name, member code, phone, plan, expiry date and days left.",
      { days: ["number", "Look-ahead window in days. Default 15."], limit: ["number", "Max rows, default 20."] },
    ),
    tool(
      "list_expired_memberships",
      "Members whose membership has already expired in the last N days and has not been renewed — name, code, phone, plan, expiry date.",
      { days: ["number", "Look-back window in days. Default 30."], limit: ["number", "Max rows, default 20."] },
    ),
    tool(
      "list_recent_renewals",
      "Memberships purchased or renewed in the last N days — member name, plan, purchase date, start and end date, amount.",
      { days: ["number", "Look-back window, default 7."], limit: ["number", "Max rows, default 20."] },
    ),
    tool(
      "find_member",
      "Look up a person by name, member code or phone. Returns who they are (member / team member / lead), their membership plan, status, expiry, and pending dues. Use this whenever a colleague asks 'who is X' or asks about a specific person by name.",
      { query: ["string", "Name, member code or phone number."] },
      ["query"],
    ),
    tool(
      "list_day_transactions",
      "Every payment received on a given day (defaults to today, IST) with the payer's name, amount, mode and what it was for.",
      { date: ["string", "YYYY-MM-DD in IST. Defaults to today."] },
    ),
  ];

  // Trainer / personal tools — available to every internal role. A trainer may
  // only look at members linked to them; owner / admin / manager bypass that.
  const personal = [
    tool(
      "list_my_assigned_members",
      "The members assigned to the trainer asking — assigned clients plus their personal-training clients. Returns name, member code, phone, plan, membership expiry and PT sessions left.",
      { limit: ["number", "Max rows, default 25."] },
    ),
    tool(
      "get_my_attendance",
      "The caller's own staff attendance — shift date, check-in time, check-out time, hours worked and late minutes (IST).",
      { days: ["number", "How many days back to include. Default 7 (use 1 for today)."] },
    ),
    tool(
      "get_member_attendance",
      "Gym visit history (check-in and check-out times) for one member the caller is allowed to see. Use find_member or list_my_assigned_members first to get the name or code.",
      { member: ["string", "Member name, member code or phone."], limit: ["number", "Max visits, default 10."] },
      ["member"],
    ),
    tool(
      "get_member_fitness_plan",
      "The active workout and diet plans assigned to one member the caller is allowed to see — plan name, type, validity dates and whether a PDF exists.",
      { member: ["string", "Member name, member code or phone."] },
      ["member"],
    ),
    tool(
      "list_my_sessions_today",
      "The caller's personal-training sessions on a given day (defaults to today, IST) — member name, time, duration and status.",
      { date: ["string", "YYYY-MM-DD in IST. Defaults to today."] },
    ),
  ];

  if (!isFinancialRole(role)) return [...base.slice(1), ...personal]; // no revenue summary for non-financial roles

  return [
    ...base,
    ...personal,
    tool(
      "list_outstanding_dues",
      "Open invoices with money still to collect — member name, invoice number, total, paid, pending amount, invoice date and due date.",
      { limit: ["number", "Max invoices, default 20."] },
    ),
  ];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function istDayBounds(dateStr?: string) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const base = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date(Date.now() + IST_OFFSET_MS);
  const iso = base.toISOString().slice(0, 10);
  const startUtc = new Date(new Date(`${iso}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc, isoDate: iso };
}

const inr = (n: number) => Math.round(Number(n || 0)).toLocaleString("en-IN");
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function memberDirectory(supabase: any, memberIds: string[]) {
  const ids = [...new Set(memberIds.filter(Boolean))];
  const out = new Map<string, { name: string; code: string; phone: string | null }>();
  if (ids.length === 0) return out;
  // NOTE: `members` carries no FK to `profiles`, so a PostgREST embed fails.
  // Resolve names in two explicit steps via members.user_id → profiles.id.
  const { data } = await supabase
    .from("members")
    .select("id, member_code, user_id")
    .in("id", ids);
  const rows = data ?? [];
  const userIds = rows.map((m: any) => m.user_id).filter(Boolean);
  const profileMap = new Map<string, { full_name?: string; phone?: string }>();
  if (userIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", userIds);
    for (const p of profs ?? []) profileMap.set((p as any).id, p as any);
  }
  for (const m of rows) {
    const p = profileMap.get((m as any).user_id) || {};
    out.set((m as any).id, {
      name: p.full_name || "Member",
      code: (m as any).member_code || "",
      phone: p.phone || null,
    });
  }
  return out;
}

const istTime = (iso: string | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16) : null;

/** Member ids linked to a trainer: direct assignment + PT packages + PT sessions. */
async function trainerMemberIds(supabase: any, trainerId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const [{ data: assigned }, { data: pkgs }] = await Promise.all([
    supabase.from("members").select("id").eq("assigned_trainer_id", trainerId),
    supabase.from("member_pt_packages").select("member_id").eq("trainer_id", trainerId),
  ]);
  for (const m of assigned ?? []) ids.add((m as any).id);
  for (const p of pkgs ?? []) ids.add((p as any).member_id);
  return ids;
}

/** Resolve a free-text member reference to a single member row. */
async function resolveMemberRef(supabase: any, query: string) {
  const q = String(query || "").trim();
  if (!q) return null;
  const digits = q.replace(/\D/g, "");
  const { data: byCode } = await supabase
    .from("members")
    .select("id, member_code, user_id, branch_id, status")
    .ilike("member_code", `%${q}%`)
    .limit(1)
    .maybeSingle();
  if (byCode) return byCode as any;

  let profileIds: string[] = [];
  const profQ = supabase.from("profiles").select("id, full_name, phone").limit(10);
  const { data: profs } = digits.length >= 8
    ? await supabase.from("profiles").select("id, full_name, phone").ilike("phone", `%${digits.slice(-10)}%`).limit(10)
    : await profQ.ilike("full_name", `%${q}%`);
  profileIds = (profs ?? []).map((p: any) => p.id);
  if (!profileIds.length) return null;
  const { data: m } = await supabase
    .from("members")
    .select("id, member_code, user_id, branch_id, status")
    .in("user_id", profileIds)
    .limit(1)
    .maybeSingle();
  return (m as any) ?? null;
}

// ── executor ──────────────────────────────────────────────────────────────────

export async function executeOpsToolCall(
  supabase: any,
  toolName: string,
  args: Record<string, any>,
  opts: { role: StaffRole | undefined; branchId?: string | null; trainerId?: string | null; staffUserId?: string | null },
): Promise<Record<string, any>> {
  const financial = isFinancialRole(opts.role);
  const unrestricted = financial; // owner / admin / manager see every member

  try {
    switch (toolName) {
      case "get_daily_ops_summary": {
        if (!financial) return { error: "Financial summaries are limited to owner, admin and manager." };
        const { startUtc, endUtc, isoDate } = istDayBounds(args.date);
        const [{ count: checkins }, { data: memberships }, { data: invoices }, { data: payments }, { data: openInvoices }] =
          await Promise.all([
            supabase.from("member_attendance").select("id", { count: "exact", head: true })
              .gte("check_in", startUtc.toISOString()).lt("check_in", endUtc.toISOString()),
            supabase.from("memberships").select("id, price_paid, status, member_id, created_at")
              .gte("created_at", startUtc.toISOString()).lt("created_at", endUtc.toISOString())
              .neq("status", "cancelled"),
            supabase.from("invoices").select("total_amount, status")
              .gte("created_at", startUtc.toISOString()).lt("created_at", endUtc.toISOString())
              .not("status", "in", "(cancelled,draft)"),
            supabase.from("payments").select("amount, payment_method, invoice_id")
              .gte("payment_date", startUtc.toISOString()).lt("payment_date", endUtc.toISOString())
              .eq("status", "completed"),
            supabase.from("invoices").select("total_amount, amount_paid, refund_amount")
              .in("status", ["pending", "partial", "overdue"]),
          ]);

        const newIds = (memberships ?? []).map((m: any) => m.member_id);
        // A renewal = this member already had an earlier membership.
        let renewals = 0;
        if (newIds.length) {
          const { data: prior } = await supabase
            .from("memberships")
            .select("member_id, created_at")
            .in("member_id", newIds)
            .lt("created_at", startUtc.toISOString());
          const priorSet = new Set((prior ?? []).map((p: any) => p.member_id));
          renewals = newIds.filter((id: string) => priorSet.has(id)).length;
        }

        const byMode: Record<string, number> = {};
        let received = 0;
        let duesCollected = 0;
        for (const p of payments ?? []) {
          const amt = Number((p as any).amount || 0);
          received += amt;
          const k = String((p as any).payment_method || "other");
          byMode[k] = (byMode[k] ?? 0) + amt;
          if ((p as any).invoice_id) duesCollected += amt;
        }
        const invoiced = (invoices ?? []).reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0);
        const duesPending = (openInvoices ?? []).reduce(
          (s: number, i: any) =>
            s + Math.max(0, Number(i.total_amount || 0) - Number(i.amount_paid || 0) - Number(i.refund_amount || 0)),
          0,
        );

        return {
          date: isoDate,
          check_ins: checkins ?? 0,
          new_memberships: (memberships ?? []).length - renewals,
          renewals,
          total_sales_invoiced: `₹${inr(invoiced)}`,
          amount_received: `₹${inr(received)}`,
          received_by_mode: Object.fromEntries(Object.entries(byMode).map(([k, v]) => [k, `₹${inr(v)}`])),
          dues_collected_today: `₹${inr(duesCollected)}`,
          dues_outstanding_total: `₹${inr(duesPending)}`,
        };
      }

      case "list_expiring_memberships": {
        const days = Math.min(Math.max(Number(args.days ?? 15), 1), 90);
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
        const today = new Date();
        const until = new Date(today.getTime() + days * 86400000);
        const { data, error } = await supabase
          .from("memberships")
          .select("id, member_id, end_date, start_date, price_paid, status, membership_plans(name)")
          .eq("status", "active")
          .gte("end_date", ymd(today))
          .lte("end_date", ymd(until))
          .order("end_date", { ascending: true })
          .limit(limit);
        if (error) return { error: error.message };
        const dir = await memberDirectory(supabase, (data ?? []).map((m: any) => m.member_id));
        return {
          window_days: days,
          count: (data ?? []).length,
          members: (data ?? []).map((m: any) => {
            const d = dir.get(m.member_id);
            return {
              name: d?.name ?? "Member",
              member_code: d?.code ?? "",
              phone: d?.phone ?? null,
              plan: m.membership_plans?.name ?? null,
              started_on: m.start_date,
              expires_on: m.end_date,
              days_left: Math.ceil((new Date(m.end_date).getTime() - today.getTime()) / 86400000),
            };
          }),
        };
      }

      case "list_expired_memberships": {
        const days = Math.min(Math.max(Number(args.days ?? 30), 1), 180);
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
        const today = new Date();
        const since = new Date(today.getTime() - days * 86400000);
        const { data, error } = await supabase
          .from("memberships")
          .select("id, member_id, end_date, start_date, status, membership_plans(name)")
          .in("status", ["expired", "active"])
          .gte("end_date", ymd(since))
          .lt("end_date", ymd(today))
          .order("end_date", { ascending: false })
          .limit(limit * 2);
        if (error) return { error: error.message };
        const rows = data ?? [];
        // Drop anyone who already has a current membership.
        const ids = rows.map((r: any) => r.member_id);
        const stillActive = new Set<string>();
        if (ids.length) {
          const { data: current } = await supabase
            .from("memberships")
            .select("member_id")
            .in("member_id", ids)
            .eq("status", "active")
            .gte("end_date", ymd(today));
          for (const c of current ?? []) stillActive.add((c as any).member_id);
        }
        const lapsed = rows.filter((r: any) => !stillActive.has(r.member_id)).slice(0, limit);
        const dir = await memberDirectory(supabase, lapsed.map((m: any) => m.member_id));
        return {
          window_days: days,
          count: lapsed.length,
          members: lapsed.map((m: any) => {
            const d = dir.get(m.member_id);
            return {
              name: d?.name ?? "Member",
              member_code: d?.code ?? "",
              phone: d?.phone ?? null,
              plan: m.membership_plans?.name ?? null,
              expired_on: m.end_date,
              days_since_expiry: Math.floor((today.getTime() - new Date(m.end_date).getTime()) / 86400000),
            };
          }),
        };
      }

      case "list_recent_renewals": {
        const days = Math.min(Math.max(Number(args.days ?? 7), 1), 90);
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
        const since = new Date(Date.now() - days * 86400000);
        const { data, error } = await supabase
          .from("memberships")
          .select("id, member_id, created_at, start_date, end_date, price_paid, status, membership_plans(name)")
          .gte("created_at", since.toISOString())
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return { error: error.message };
        const dir = await memberDirectory(supabase, (data ?? []).map((m: any) => m.member_id));
        return {
          window_days: days,
          count: (data ?? []).length,
          purchases: (data ?? []).map((m: any) => {
            const d = dir.get(m.member_id);
            return {
              name: d?.name ?? "Member",
              member_code: d?.code ?? "",
              plan: m.membership_plans?.name ?? null,
              purchased_on: String(m.created_at).slice(0, 10),
              valid_from: m.start_date,
              valid_till: m.end_date,
              ...(financial ? { amount: `₹${inr(Number(m.price_paid || 0))}` } : {}),
              status: m.status,
            };
          }),
        };
      }

      case "list_outstanding_dues": {
        if (!financial) return { error: "Dues are limited to owner, admin and manager." };
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
        const { data, error } = await supabase
          .from("invoices")
          .select("invoice_number, member_id, customer_name, total_amount, amount_paid, refund_amount, status, created_at, due_date")
          .in("status", ["pending", "partial", "overdue"])
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return { error: error.message };
        const dir = await memberDirectory(supabase, (data ?? []).map((i: any) => i.member_id));
        const rows = (data ?? []).map((i: any) => {
          const d = dir.get(i.member_id);
          const pending = Math.max(
            0,
            Number(i.total_amount || 0) - Number(i.amount_paid || 0) - Number(i.refund_amount || 0),
          );
          return {
            name: d?.name ?? i.customer_name ?? "Customer",
            member_code: d?.code ?? "",
            phone: d?.phone ?? null,
            invoice_number: i.invoice_number,
            invoice_date: String(i.created_at).slice(0, 10),
            due_date: i.due_date ?? null,
            total: `₹${inr(Number(i.total_amount || 0))}`,
            paid: `₹${inr(Number(i.amount_paid || 0))}`,
            pending_amount: `₹${inr(pending)}`,
            _pending_raw: pending,
            status: i.status,
          };
        }).filter((r: any) => r._pending_raw > 0);
        const total = rows.reduce((s: number, r: any) => s + r._pending_raw, 0);
        for (const r of rows) delete r._pending_raw;
        return { count: rows.length, total_pending: `₹${inr(total)}`, invoices: rows };
      }

      case "find_member": {
        const q = String(args.query || "").trim();
        if (!q) return { error: "Provide a name, member code or phone." };
        const digits = q.replace(/\D/g, "");

        // Profiles matching by name / phone / email.
        let profQuery = supabase.from("profiles").select("id, full_name, phone, email").limit(10);
        profQuery = digits.length >= 6
          ? profQuery.ilike("phone", `%${digits.slice(-10)}%`)
          : profQuery.ilike("full_name", `%${q}%`);
        const [{ data: profs }, { data: byCode }] = await Promise.all([
          profQuery,
          supabase.from("members").select("id, member_code, user_id, status, branch_id").ilike("member_code", `%${q}%`).limit(5),
        ]);

        const userIds = (profs ?? []).map((p: any) => p.id);
        const { data: memberRows } = userIds.length
          ? await supabase.from("members").select("id, member_code, user_id, status, branch_id").in("user_id", userIds)
          : { data: [] as any[] };
        const allMembers = [...(memberRows ?? []), ...(byCode ?? [])]
          .filter((m: any, i: number, a: any[]) => a.findIndex((x) => x.id === m.id) === i)
          .slice(0, 5);

        const results: any[] = [];
        for (const m of allMembers) {
          const p = (profs ?? []).find((x: any) => x.id === m.user_id);
          let name = p?.full_name as string | undefined;
          if (!name && m.user_id) {
            const { data: p2 } = await supabase.from("profiles").select("full_name, phone").eq("id", m.user_id).maybeSingle();
            name = (p2 as any)?.full_name;
          }
          const [{ data: ms }, { data: invs }] = await Promise.all([
            supabase.from("memberships").select("status, start_date, end_date, plan_id")
              .eq("member_id", m.id).order("end_date", { ascending: false }).limit(1),
            supabase.from("invoices").select("total_amount, amount_paid, refund_amount")
              .eq("member_id", m.id).in("status", ["pending", "partial", "overdue"]),
          ]);
          const cur: any = (ms ?? [])[0];
          let planName: string | null = null;
          if (cur?.plan_id) {
            const { data: pl } = await supabase.from("membership_plans").select("name").eq("id", cur.plan_id).maybeSingle();
            planName = (pl as any)?.name ?? null;
          }
          const due = (invs ?? []).reduce(
            (s: number, i: any) =>
              s + Math.max(0, Number(i.total_amount || 0) - Number(i.amount_paid || 0) - Number(i.refund_amount || 0)),
            0,
          );
          results.push({
            type: "member",
            name: name || "Member",
            member_code: m.member_code,
            phone: p?.phone ?? null,
            member_status: m.status,
            plan: planName,
            membership_status: cur?.status ?? null,
            valid_from: cur?.start_date ?? null,
            valid_till: cur?.end_date ?? null,
            ...(financial ? { pending_dues: `₹${inr(due)}` } : {}),
          });
        }

        // Internal team match (owner / admin / manager / trainer / employee).
        for (const p of profs ?? []) {
          if (results.some((r) => r.phone && p.phone && r.phone === p.phone)) continue;
          const [{ data: roles }, { data: emp }] = await Promise.all([
            supabase.from("user_roles").select("role").eq("user_id", p.id),
            supabase.from("employees").select("position").eq("user_id", p.id).limit(1).maybeSingle(),
          ]);
          const privileged = (roles ?? []).map((r: any) => String(r.role)).filter((r: string) => r !== "member");
          if (privileged.length || emp) {
            results.push({
              type: "team",
              name: p.full_name,
              phone: p.phone ?? null,
              role: privileged[0] ?? (emp as any)?.position ?? "staff",
            });
          }
        }

        if (results.length === 0) {
          const { data: leads } = await supabase
            .from("leads").select("full_name, phone, status, source")
            .ilike("full_name", `%${q}%`).limit(5);
          for (const l of leads ?? []) {
            results.push({ type: "lead", name: (l as any).full_name, phone: (l as any).phone, status: (l as any).status });
          }
        }

        return { query: q, count: results.length, matches: results };
      }

      case "list_day_transactions": {
        if (!financial) return { error: "Payment details are limited to owner, admin and manager." };
        const { startUtc, endUtc, isoDate } = istDayBounds(args.date);
        const { data: payments, error } = await supabase
          .from("payments")
          .select("amount, payment_method, member_id, invoice_id, notes, payment_date")
          .gte("payment_date", startUtc.toISOString())
          .lt("payment_date", endUtc.toISOString())
          .eq("status", "completed")
          .order("payment_date", { ascending: true });
        if (error) return { error: error.message };
        const dir = await memberDirectory(supabase, (payments ?? []).map((p: any) => p.member_id));
        const invoiceIds = (payments ?? []).map((p: any) => p.invoice_id).filter(Boolean);
        const invMap = new Map<string, string>();
        if (invoiceIds.length) {
          const { data: invs } = await supabase.from("invoices").select("id, invoice_number").in("id", invoiceIds);
          for (const i of invs ?? []) invMap.set((i as any).id, (i as any).invoice_number);
        }
        const rows = (payments ?? []).map((p: any) => ({
          name: dir.get(p.member_id)?.name ?? "Walk-in / POS",
          member_code: dir.get(p.member_id)?.code ?? "",
          amount: `₹${inr(Number(p.amount || 0))}`,
          mode: p.payment_method,
          invoice_number: p.invoice_id ? invMap.get(p.invoice_id) ?? null : null,
          note: p.notes ?? null,
          time: String(p.payment_date).slice(11, 16),
        }));
        const total = (payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
        return { date: isoDate, count: rows.length, total_received: `₹${inr(total)}`, payments: rows };
      }

      // ── trainer / personal ────────────────────────────────────────────────
      case "list_my_assigned_members": {
        if (!opts.trainerId && !unrestricted) return { error: "No trainer profile is linked to this number." };
        if (!opts.trainerId) return { error: "This tool is for trainers. Use find_member or list_expiring_memberships instead." };
        const limit = Math.min(Number(args.limit) || 25, 50);
        const ids = [...(await trainerMemberIds(supabase, opts.trainerId))].slice(0, limit);
        if (!ids.length) return { count: 0, members: [], note: "No members are currently assigned to you." };
        const dir = await memberDirectory(supabase, ids);
        const [{ data: memberships }, { data: pkgs }] = await Promise.all([
          supabase.from("memberships").select("member_id, status, end_date, plan_id").in("member_id", ids)
            .order("end_date", { ascending: false }),
          supabase.from("member_pt_packages").select("member_id, sessions_remaining, expiry_date, status")
            .in("member_id", ids).eq("trainer_id", opts.trainerId).eq("status", "active"),
        ]);
        const planIds = [...new Set((memberships ?? []).map((m: any) => m.plan_id).filter(Boolean))];
        const planMap = new Map<string, string>();
        if (planIds.length) {
          const { data: plans } = await supabase.from("membership_plans").select("id, name").in("id", planIds);
          for (const p of plans ?? []) planMap.set((p as any).id, (p as any).name);
        }
        const latest = new Map<string, any>();
        for (const ms of memberships ?? []) if (!latest.has((ms as any).member_id)) latest.set((ms as any).member_id, ms);
        const ptMap = new Map<string, any>();
        for (const p of pkgs ?? []) ptMap.set((p as any).member_id, p);
        const rows = ids.map((id) => {
          const ms = latest.get(id);
          const pt = ptMap.get(id);
          return {
            name: dir.get(id)?.name ?? "Member",
            member_code: dir.get(id)?.code ?? "",
            phone: dir.get(id)?.phone ?? null,
            plan: ms?.plan_id ? planMap.get(ms.plan_id) ?? null : null,
            membership_status: ms?.status ?? null,
            expires_on: ms?.end_date ?? null,
            pt_sessions_left: pt ? Number(pt.sessions_remaining || 0) : null,
          };
        });
        return { count: rows.length, members: rows };
      }

      case "get_my_attendance": {
        if (!opts.staffUserId) return { error: "Could not identify your staff record from this number." };
        const days = Math.min(Math.max(Number(args.days) || 7, 1), 31);
        const from = ymd(new Date(Date.now() + 5.5 * 3600 * 1000 - (days - 1) * 86400000));
        const { data, error } = await supabase
          .from("staff_attendance")
          .select("shift_date, shift_type, check_in, check_out, total_hours, late_minutes, is_late")
          .eq("user_id", opts.staffUserId)
          .gte("shift_date", from)
          .order("shift_date", { ascending: false })
          .limit(40);
        if (error) return { error: error.message };
        const rows = (data ?? []).map((r: any) => ({
          date: r.shift_date,
          shift: r.shift_type ?? null,
          check_in: istTime(r.check_in),
          check_out: istTime(r.check_out),
          hours: r.total_hours != null ? Number(r.total_hours) : null,
          late_minutes: r.is_late ? Number(r.late_minutes || 0) : 0,
        }));
        return { from, days, count: rows.length, attendance: rows };
      }

      case "get_member_attendance": {
        const m = await resolveMemberRef(supabase, args.member);
        if (!m) return { error: `No member found matching "${args.member}".` };
        if (!unrestricted) {
          if (!opts.trainerId) return { error: "Member visit history is limited to their trainer and management." };
          const ids = await trainerMemberIds(supabase, opts.trainerId);
          if (!ids.has(m.id)) return { error: "That member is not assigned to you." };
        }
        const limit = Math.min(Number(args.limit) || 10, 30);
        const dir = await memberDirectory(supabase, [m.id]);
        const { data, error } = await supabase
          .from("member_attendance")
          .select("check_in, check_out, check_in_method")
          .eq("member_id", m.id)
          .order("check_in", { ascending: false })
          .limit(limit);
        if (error) return { error: error.message };
        const visits = (data ?? []).map((v: any) => {
          const inIso = new Date(new Date(v.check_in).getTime() + 5.5 * 3600 * 1000).toISOString();
          const mins = v.check_out
            ? Math.round((new Date(v.check_out).getTime() - new Date(v.check_in).getTime()) / 60000)
            : null;
          return {
            date: inIso.slice(0, 10),
            check_in: inIso.slice(11, 16),
            check_out: istTime(v.check_out),
            minutes: mins,
            via: v.check_in_method ?? null,
          };
        });
        return {
          member: dir.get(m.id)?.name ?? "Member",
          member_code: m.member_code,
          count: visits.length,
          visits,
        };
      }

      case "get_member_fitness_plan": {
        const m = await resolveMemberRef(supabase, args.member);
        if (!m) return { error: `No member found matching "${args.member}".` };
        if (!unrestricted) {
          if (!opts.trainerId) return { error: "Member plans are limited to their trainer and management." };
          const ids = await trainerMemberIds(supabase, opts.trainerId);
          if (!ids.has(m.id)) return { error: "That member is not assigned to you." };
        }
        const dir = await memberDirectory(supabase, [m.id]);
        const today = ymd(new Date(Date.now() + 5.5 * 3600 * 1000));
        const { data, error } = await supabase
          .from("member_fitness_plans")
          .select("plan_type, plan_name, valid_from, valid_until, pdf_url, updated_at")
          .eq("member_id", m.id)
          .order("valid_from", { ascending: false })
          .limit(10);
        if (error) return { error: error.message };
        const plans = (data ?? []).map((p: any) => ({
          type: p.plan_type,
          name: p.plan_name,
          valid_from: p.valid_from,
          valid_until: p.valid_until,
          active: (!p.valid_from || p.valid_from <= today) && (!p.valid_until || p.valid_until >= today),
          has_pdf: !!p.pdf_url,
        }));
        return {
          member: dir.get(m.id)?.name ?? "Member",
          member_code: m.member_code,
          workout: plans.filter((p) => String(p.type).includes("workout")),
          diet: plans.filter((p) => String(p.type).includes("diet")),
          count: plans.length,
        };
      }

      case "list_my_sessions_today": {
        if (!opts.trainerId) return { error: "This tool is for trainers — no trainer profile is linked to this number." };
        const { startUtc, endUtc, isoDate } = istDayBounds(args.date);
        const { data, error } = await supabase
          .from("pt_sessions")
          .select("scheduled_at, duration_minutes, status, member_pt_package_id")
          .eq("trainer_id", opts.trainerId)
          .gte("scheduled_at", startUtc.toISOString())
          .lt("scheduled_at", endUtc.toISOString())
          .order("scheduled_at", { ascending: true });
        if (error) return { error: error.message };
        const pkgIds = [...new Set((data ?? []).map((s: any) => s.member_pt_package_id).filter(Boolean))];
        const pkgMember = new Map<string, string>();
        if (pkgIds.length) {
          const { data: pkgs } = await supabase.from("member_pt_packages").select("id, member_id").in("id", pkgIds);
          for (const p of pkgs ?? []) pkgMember.set((p as any).id, (p as any).member_id);
        }
        const dir = await memberDirectory(supabase, [...pkgMember.values()]);
        const sessions = (data ?? []).map((s: any) => {
          const memberId = pkgMember.get(s.member_pt_package_id);
          return {
            time: istTime(s.scheduled_at),
            member: memberId ? dir.get(memberId)?.name ?? "Member" : "Member",
            member_code: memberId ? dir.get(memberId)?.code ?? "" : "",
            duration_minutes: s.duration_minutes,
            status: s.status,
          };
        });
        return { date: isoDate, count: sessions.length, sessions };
      }


      default:
        return { error: `Unknown operations tool: ${toolName}` };
    }
  } catch (e) {
    return { error: (e as Error)?.message || "ops_tool_failed" };
  }
}
