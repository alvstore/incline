// daily-ops-summary v2.0.0 — richer report: unique members, renewals, PT sales/sessions/clients,
//   payment split, facility bookings/no-shows, expiring members, leads. WhatsApp uses
//   UTILITY template `daily_ops_summary_v2` (20 slots); falls back to SMS until approved.
// daily-ops-summary v1.1.0
// Sends the end-of-day owner report at 23:00 IST (17:30 UTC), driven by the
// master cron. Reports, for the IST calendar day:
//   • new memberships enrolled
//   • total sales invoiced
//   • amount received, broken down by payment mode
//   • dues collected today vs total dues still outstanding
//
// Recipients come from settings(branch_id IS NULL, key='daily_ops_summary_recipients'),
// falling back to every owner/admin profile that has a phone number.
// All sends go through `dispatch-communication` — never a send-* function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireCaller } from "../_shared/requireCaller.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Start/end of "today" in IST, expressed as UTC instants. */
function istDayBounds(now = new Date()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const startUtc = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const dateLabel = new Date(Date.UTC(y, m, d)).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const isoDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { startUtc, endUtc, dateLabel, isoDate };
}

const inr = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const MODE_LABEL: Record<string, string> = {
  cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer",
  wallet: "Wallet", cheque: "Cheque", other: "Other",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  { const __caller = await requireCaller(req, corsHeaders, { roles: [] }); if (!__caller.ok) return __caller.response; }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { startUtc, endUtc, dateLabel, isoDate } = istDayBounds();

  try {
    const [
      { data: memberships },
      { data: invoices },
      { data: payments },
      { data: openInvoices },
      { data: branches },
      { count: attendanceCount },
      { data: attendanceRows },
      { data: ptPackagesToday },
      { count: ptSessionsDone },
      { data: activePtRows },
      { data: slotBookings },
      { data: expiringRows },
      { count: leadsToday },
    ] = await Promise.all([
      supabase
        .from("memberships")
        .select("id, branch_id, member_id, price_paid, status")
        .gte("created_at", startUtc.toISOString())
        .lt("created_at", endUtc.toISOString())
        .neq("status", "cancelled"),
      supabase
        .from("invoices")
        .select("id, branch_id, total_amount, status")
        .gte("created_at", startUtc.toISOString())
        .lt("created_at", endUtc.toISOString())
        .not("status", "in", "(cancelled,draft)"),
      supabase
        .from("payments")
        .select("id, branch_id, amount, payment_method, status, invoice_id")
        .gte("payment_date", startUtc.toISOString())
        .lt("payment_date", endUtc.toISOString())
        .eq("status", "completed"),
      supabase
        .from("invoices")
        .select("total_amount, amount_paid, refund_amount")
        .in("status", ["pending", "partial", "overdue"]),
      supabase.from("branches").select("id, name"),
      supabase
        .from("member_attendance")
        .select("id", { count: "exact", head: true })
        .gte("check_in", startUtc.toISOString())
        .lt("check_in", endUtc.toISOString()),
      supabase
        .from("member_attendance")
        .select("member_id")
        .gte("check_in", startUtc.toISOString())
        .lt("check_in", endUtc.toISOString())
        .limit(5000),
      supabase
        .from("member_pt_packages")
        .select("id")
        .gte("created_at", startUtc.toISOString())
        .lt("created_at", endUtc.toISOString())
        .not("status", "in", "(cancelled,reversed)"),
      supabase
        .from("pt_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("scheduled_at", startUtc.toISOString())
        .lt("scheduled_at", endUtc.toISOString()),
      supabase
        .from("member_pt_packages")
        .select("member_id")
        .eq("status", "active")
        .limit(5000),
      supabase
        .from("benefit_bookings")
        .select("status, benefit_slots!inner(slot_date)")
        .eq("benefit_slots.slot_date", isoDate)
        .neq("status", "cancelled")
        .limit(5000),
      supabase
        .from("memberships")
        .select("member_id")
        .eq("status", "active")
        .gte("end_date", isoDate)
        .lte("end_date", new Date(Date.parse(isoDate) + 7 * 86400000).toISOString().slice(0, 10))
        .limit(5000),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startUtc.toISOString())
        .lt("created_at", endUtc.toISOString()),
    ]);

    // Renewals = memberships created today for members who already had one.
    const todayMemberIds = [...new Set((memberships ?? []).map((m: any) => m.member_id).filter(Boolean))];
    let renewalMemberIds = new Set<string>();
    if (todayMemberIds.length) {
      const { data: prior } = await supabase
        .from("memberships")
        .select("member_id")
        .in("member_id", todayMemberIds)
        .lt("created_at", startUtc.toISOString());
      renewalMemberIds = new Set((prior ?? []).map((r: any) => r.member_id));
    }
    const renewals = (memberships ?? []).filter((m: any) => renewalMemberIds.has(m.member_id)).length;
    const uniqueMembers = new Set((attendanceRows ?? []).map((a: any) => a.member_id)).size;
    const ptPackagesSold = (ptPackagesToday ?? []).length;
    const ptDone = ptSessionsDone ?? 0;
    const activePtClients = new Set((activePtRows ?? []).map((r: any) => r.member_id)).size;
    const facilityBookings = (slotBookings ?? []).length;
    const facilityNoShows = (slotBookings ?? []).filter((b: any) => b.status === "no_show").length;
    const expiringSoon = new Set((expiringRows ?? []).map((r: any) => r.member_id)).size;
    const newLeads = leadsToday ?? 0;

    const totalCheckins = attendanceCount ?? 0;
    const branchName = new Map((branches ?? []).map((b: any) => [b.id, b.name]));

    const allMemberships = (memberships ?? []).length;
    const invoicedTotal = (invoices ?? []).reduce(
      (s: number, i: any) => s + Number(i.total_amount || 0), 0,
    );

    const byMode = new Map<string, number>();
    let receivedTotal = 0;
    for (const p of payments ?? []) {
      const amt = Number(p.amount || 0);
      receivedTotal += amt;
      const key = String(p.payment_method || "other");
      byMode.set(key, (byMode.get(key) ?? 0) + amt);
    }

    // Dues collected today = payments booked today against an invoice.
    const duesCollected = (payments ?? [])
      .filter((p: any) => p.invoice_id)
      .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

    const duesPending = (openInvoices ?? []).reduce(
      (s: number, i: any) =>
        s + Math.max(0, Number(i.total_amount || 0) - Number(i.amount_paid || 0) - Number(i.refund_amount || 0)),
      0,
    );

    const modeLines = [...byMode.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  • ${MODE_LABEL[k] ?? k}: ₹${inr(v)}`)
      .join("\n") || "  • No payments recorded";

    const newMemberships = allMemberships - renewals;
    const cashAmt = byMode.get("cash") ?? 0;
    const upiAmt = byMode.get("upi") ?? 0;
    const cardAmt = byMode.get("card") ?? 0;
    const otherAmt = receivedTotal - cashAmt - upiAmt - cardAmt;

    const perBranch = (branches ?? [])
      .map((b: any) => {
        const mCount = (memberships ?? []).filter((m: any) => m.branch_id === b.id).length;
        const rec = (payments ?? [])
          .filter((p: any) => p.branch_id === b.id)
          .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
        return mCount || rec ? `  • ${b.name}: ${mCount} new, ₹${inr(rec)} received` : null;
      })
      .filter(Boolean)
      .join("\n");

    const body =
      `The Incline — Daily Operations Summary (${dateLabel})\n\n` +
      `Footfall: ${totalCheckins} check-ins (${uniqueMembers} unique members)\n` +
      `Sales: ${newMemberships} new memberships, ${renewals} renewals, ${ptPackagesSold} PT packages\n` +
      `Total sales invoiced: ₹${inr(invoicedTotal)}\n` +
      `Revenue received: ₹${inr(receivedTotal)}\n${modeLines}\n\n` +
      `Dues collected today: ₹${inr(duesCollected)}\n` +
      `Dues still outstanding: ₹${inr(duesPending)}\n\n` +
      `PT: ${ptDone} sessions done, ${activePtClients} active clients\n` +
      `Facilities: ${facilityBookings} recovery bookings (${facilityNoShows} no-shows)\n` +
      `Expiring in 7 days: ${expiringSoon} members\n` +
      `New leads today: ${newLeads}` +
      (perBranch ? `\n\nBy branch:\n${perBranch}` : "");

    // ── recipients ──
    let recipients: Array<{ name?: string; phone?: string; email?: string }> = [];
    const { data: cfg } = await supabase
      .from("settings")
      .select("value")
      .is("branch_id", null)
      .eq("key", "daily_ops_summary_recipients")
      .maybeSingle();
    const cfgVal = (cfg as any)?.value;
    if (Array.isArray(cfgVal)) recipients = cfgVal;

    if (recipients.length === 0) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["owner", "admin"]);
      const ids = [...new Set((roleRows ?? []).map((r: any) => r.user_id))];
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("full_name, phone, email")
          .in("id", ids);
        recipients = (profs ?? []).map((p: any) => ({
          name: p.full_name, phone: p.phone, email: p.email,
        }));
      }
    }

    // `?preview=1` computes the numbers without sending anything — used to
    // verify the report without burning the once-per-day dedupe key.
    const preview = new URL(req.url).searchParams.get("preview") === "1";
    if (preview) {
      return new Response(
        JSON.stringify({ ok: true, preview: true, date: isoDate, body }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const defaultBranch = (branches ?? []).find(b => b.name.toLowerCase().includes('main'))?.id ?? (branches ?? [])[0]?.id ?? null;
    const deliveries: Array<{
      recipient_index: number;
      channel: "whatsapp" | "email";
      status: string;
      reason?: string;
    }> = [];

    for (const [recipientIndex, r] of recipients.entries()) {
      const name = r.name ?? "Team";
      // Order MUST match the `variables` list on the UTILITY template
      // `daily_ops_summary_v2` ({{1}}…{{20}}).
      const slots: Array<[string, string]> = [
        ["recipient_name", name],
        ["report_date", dateLabel],
        ["total_checkins", String(totalCheckins)],
        ["unique_members", String(uniqueMembers)],
        ["new_memberships", String(newMemberships)],
        ["renewals", String(renewals)],
        ["pt_packages_sold", String(ptPackagesSold)],
        ["amount_received", inr(receivedTotal)],
        ["cash_received", inr(cashAmt)],
        ["upi_received", inr(upiAmt)],
        ["card_received", inr(cardAmt)],
        ["other_received", inr(otherAmt)],
        ["dues_collected", inr(duesCollected)],
        ["dues_pending", inr(duesPending)],
        ["pt_sessions_done", String(ptDone)],
        ["active_pt_clients", String(activePtClients)],
        ["facility_bookings", String(facilityBookings)],
        ["facility_no_shows", String(facilityNoShows)],
        ["expiring_7d", String(expiringSoon)],
        ["new_leads", String(newLeads)],
      ];
      const variables: Record<string, string> = {
        member_name: name, full_name: name, event_key: "daily_ops_summary_report",
        total_sales: inr(invoicedTotal),
      };
      slots.forEach(([k, v], idx) => {
        variables[k] = v;
        variables[String(idx + 1)] = v;
        variables[`variable_${idx + 1}`] = v;
      });

      const send = async (
        channel: "whatsapp" | "email" | "sms",
        recipient: string,
      ): Promise<{ status: string; reason?: string }> => {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-communication`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              branch_id: defaultBranch,
              channel,
              category: "transactional",
              recipient,
              payload: {
                subject: `Daily report — ${dateLabel}`,
                body: channel === "email" ? body.replace(/\n/g, "<br/>") : body,
                variables,
                use_branded_template: channel === "email",
              },
              // One report per recipient per IST day, whatever the retries.
              dedupe_key: `daily_ops_summary:${isoDate}:${recipient}:${channel}`,
              force: true,
              source_caller: "daily-ops-summary",
            }),
          });
          const j = await res.json().catch(() => ({}));
          const status = String(j?.status ?? (res.ok ? "sent" : "failed"));
          const reason = typeof j?.reason === "string" ? j.reason : undefined;
          return { status, reason };
        } catch (e) {
          return { status: "failed", reason: e instanceof Error ? e.message : "unknown" };
        }
      };

      const OK = ["sent", "delivered", "queued"];

      for (const channel of ["whatsapp", "email"] as const) {
        const recipient = channel === "email" ? r.email : r.phone;
        if (!recipient) continue;
        const { status, reason } = await send(channel, recipient);
        const normalized =
          status === "suppressed" && reason === "no_template_for_closed_session"
            ? "pending_template_approval"
            : status;

        // WhatsApp needs an approved Meta template for this event. Until
        // `daily_ops_summary_report` is approved, fall back to SMS so the owner
        // still gets the report on their phone.
        if (channel === "whatsapp" && !OK.includes(normalized) && r.phone) {
          const sms = await send("sms", r.phone);
          deliveries.push({
            recipient_index: recipientIndex + 1,
            channel: "whatsapp",
            status: OK.includes(sms.status) ? "sent_via_sms_fallback" : normalized,
            ...(reason ? { reason } : {}),
          });
          continue;
        }

        deliveries.push({
          recipient_index: recipientIndex + 1,
          channel,
          status: normalized,
          ...(reason ? { reason } : {}),
        });
      }
    }

    // Outcomes that mean "nothing went wrong": delivered, in-flight, already
    // sent today (deduped), recipient opted out (suppressed), or deferred by
    // quiet hours. Only genuine errors should fail the run.
    const ACCEPTABLE_STATUSES = [
      "sent",
      "sending",
      "delivered",
      "queued",
      "pending",
      "scheduled",
      "sent_via_sms_fallback",
      "deduped",
      "suppressed",
      "skipped_quiet_hours",
      "skipped",
      "read",
    ];
    const incomplete = deliveries.filter(
      (delivery) => !ACCEPTABLE_STATUSES.includes(delivery.status),
    );


    if (incomplete.length > 0) {
      // Surface silent suppressions (e.g. missing WhatsApp template, email
      // provider errors) in System Health instead of failing quietly.
      await supabase.rpc("log_error_event", {
        p_source: "daily-ops-summary",
        p_severity: "warning",
        p_message: `Daily owner report: ${incomplete.length}/${deliveries.length} deliveries incomplete — ${
          incomplete.map((d) => `${d.channel}:${d.status}${d.reason ? `(${d.reason})` : ""}`).join(", ")
        }`,
      }).then(() => {}, () => {});

      return new Response(
        JSON.stringify({
          ok: false,
          partial: true,
          date: isoDate,
          summary: {
            newMemberships,
            invoicedTotal,
            receivedTotal,
            duesCollected,
            duesPending,
          },
          deliveries,
          error: `${incomplete.length} of ${deliveries.length} channel deliveries incomplete`,
        }),
        // Some delivered → partial success (warning already logged); none → hard failure.
        { status: incomplete.length < deliveries.length ? 200 : 424, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true, date: isoDate, newMemberships, invoicedTotal,
        receivedTotal, duesCollected, duesPending, deliveries,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[daily-ops-summary]", msg);
    await supabase.rpc("log_error_event", {
      p_source: "daily-ops-summary",
      p_severity: "error",
      p_message: msg,
    }).then(() => {}, () => {});
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
