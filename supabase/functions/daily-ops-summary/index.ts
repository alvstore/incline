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

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { startUtc, endUtc, dateLabel, isoDate } = istDayBounds();

  try {
    const [
      { data: memberships },
      { data: invoices },
      { data: payments },
      { data: openInvoices },
      { data: branches },
      { data: attendanceCount },
      { data: activePtCredits },
    ] = await Promise.all([
      supabase
        .from("memberships")
        .select("id, branch_id, price_paid, status")
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
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .gte("check_in", startUtc.toISOString())
        .lt("check_in", endUtc.toISOString()),
      supabase
        .from("member_benefit_credits")
        .select("id", { count: "exact", head: true })
        .eq("benefit_type", "pt_session")
        .gt("remaining_count", 0),
    ]);

    const totalCheckins = attendanceCount ?? 0;
    const activePtSessions = activePtCredits ?? 0;
    const branchName = new Map((branches ?? []).map((b: any) => [b.id, b.name]));

    const newMemberships = (memberships ?? []).length;
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
      `The Incline — Daily Report (${dateLabel})\n\n` +
      `Total Check-ins: ${totalCheckins}\n` +
      `New memberships enrolled: ${newMemberships}\n` +
      `Total sales invoiced: ₹${inr(invoicedTotal)}\n` +
      `Amount received: ₹${inr(receivedTotal)}\n${modeLines}\n\n` +
      `Active PT Sessions: ${activePtSessions}\n` +
      `Dues collected today: ₹${inr(duesCollected)}\n` +
      `Dues still outstanding: ₹${inr(duesPending)}` +
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
      const variables = {
        recipient_name: r.name ?? "there",
        member_name: r.name ?? "there",
        full_name: r.name ?? "there",
        report_date: dateLabel,
        new_memberships: String(newMemberships),
        total_checkins: String(totalCheckins),
        checkins: String(totalCheckins),
        active_pt_sessions: String(activePtSessions),
        pt_sessions: String(activePtSessions),
        total_revenue: inr(receivedTotal),
        total_sales: inr(invoicedTotal),
        amount: inr(receivedTotal),
        amount_received: inr(receivedTotal),
        cash_received: inr(byMode.get("cash") ?? 0),
        upi_received: inr(byMode.get("upi") ?? 0),
        card_received: inr(byMode.get("card") ?? 0),
        dues_collected: inr(duesCollected),
        dues_pending: inr(duesPending),
        event_key: "daily_ops_summary_report",
      };

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

    const incomplete = deliveries.filter(
      (delivery) => !["sent", "delivered", "queued", "sent_via_sms_fallback"].includes(delivery.status),
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
        { status: 424, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
