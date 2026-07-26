// v1.0.0 — Razorpay Payment Link reconciler (cron + on-demand)
//
// Fetches the current status of pending Razorpay Payment Links via the
// Razorpay REST API and, if paid, records the payment locally so invoices
// don't stay open when the webhook was not delivered / not configured.
//
// Usage:
//   Cron:   POST {} — walks all pending plinks < 7d old.
//   Manual: POST { invoiceId } — reconciles just that invoice.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lovable-system",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CredCache { [branchKey: string]: { keyId: string; keySecret: string } | null }

async function loadCreds(supabase: any, branchId: string | null, cache: CredCache) {
  const key = branchId ?? "__global__";
  if (key in cache) return cache[key];

  // Branch-specific first
  if (branchId) {
    const { data } = await supabase
      .from("integration_settings")
      .select("credentials")
      .eq("branch_id", branchId)
      .eq("integration_type", "payment_gateway")
      .eq("provider", "razorpay")
      .eq("is_active", true)
      .maybeSingle();
    if (data?.credentials?.key_id && data?.credentials?.key_secret) {
      cache[key] = { keyId: data.credentials.key_id, keySecret: data.credentials.key_secret };
      return cache[key];
    }
  }

  // Global fallback
  const { data: g } = await supabase
    .from("integration_settings")
    .select("credentials")
    .is("branch_id", null)
    .eq("integration_type", "payment_gateway")
    .eq("provider", "razorpay")
    .eq("is_active", true)
    .maybeSingle();
  cache[key] = g?.credentials?.key_id && g?.credentials?.key_secret
    ? { keyId: g.credentials.key_id, keySecret: g.credentials.key_secret }
    : null;
  return cache[key];
}

async function settlePaidPlink(supabase: any, tx: any, plink: any) {
  // plink.payments is an array of { payment_id, amount, status, method, ... }
  const paidPayment = Array.isArray(plink.payments)
    ? plink.payments.find((p: any) => p.status === "captured") ?? plink.payments[0]
    : null;
  const gatewayPaymentId = paidPayment?.payment_id ?? null;
  const paidAmount = Number(plink.amount_paid ?? tx.amount ?? 0) / 100 || Number(tx.amount ?? 0);
  const method = (paidPayment?.method || "razorpay").toLowerCase();

  // 1. Invoice snapshot (for member_id / branch_id / totals)
  const { data: inv } = await supabase
    .from("invoices")
    .select("id, branch_id, member_id, total_amount, amount_paid, status, invoice_number")
    .eq("id", tx.invoice_id)
    .maybeSingle();
  if (!inv) return { ok: false, reason: "invoice_missing" };

  // 2. Idempotency — did we already record a payment for this plink?
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("invoice_id", tx.invoice_id)
    .or(`transaction_id.eq.${plink.id},transaction_id.eq.${gatewayPaymentId ?? "___none___"}`)
    .maybeSingle();

  if (!existing) {
    await supabase.from("payments").insert({
      branch_id: inv.branch_id,
      invoice_id: inv.id,
      member_id: inv.member_id,
      amount: paidAmount,
      payment_method: (["cash","card","upi","bank_transfer","wallet","razorpay","gateway"].includes(method) ? method : "razorpay"),
      status: "completed",
      transaction_id: gatewayPaymentId ?? plink.id,
      payment_date: new Date().toISOString(),
      notes: `Razorpay Payment Link ${plink.id} auto-reconciled`,
      lifecycle_status: "settled",
      payment_source: "gateway",
    });

    // 3. Recompute invoice amount_paid + status
    const newPaid = Number(inv.amount_paid || 0) + paidAmount;
    const newStatus = newPaid >= Number(inv.total_amount || 0) ? "paid"
                    : newPaid > 0 ? "partial" : inv.status;
    await supabase.from("invoices")
      .update({ amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
  }

  // 4. Mark payment_transactions row
  await supabase.from("payment_transactions")
    .update({
      status: "captured",
      gateway_payment_id: gatewayPaymentId,
      webhook_data: { ...(tx.webhook_data || {}), reconciled_at: new Date().toISOString(), plink_status: plink.status },
    })
    .eq("id", tx.id);

  return { ok: true, invoice_id: inv.id, amount: paidAmount, payment_id: gatewayPaymentId };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const invoiceId: string | null = body?.invoiceId ?? null;

    let q = supabase
      .from("payment_transactions")
      .select("id, invoice_id, gateway_order_id, status, amount, branch_id, webhook_data")
      .eq("gateway", "razorpay")
      .in("status", ["created", "pending", "authorized"])
      .like("gateway_order_id", "plink_%")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (invoiceId) q = q.eq("invoice_id", invoiceId);

    const { data: txs, error } = await q;
    if (error) throw error;

    const cache: CredCache = {};
    const results: any[] = [];

    for (const tx of txs ?? []) {
      const creds = await loadCreds(supabase, tx.branch_id, cache);
      if (!creds) {
        results.push({ tx: tx.id, skipped: "no_credentials" });
        continue;
      }
      const auth = btoa(`${creds.keyId}:${creds.keySecret}`);
      const r = await fetch(`https://api.razorpay.com/v1/payment_links/${tx.gateway_order_id}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      const plink = await r.json();
      if (!r.ok) {
        results.push({ tx: tx.id, error: plink?.error?.description ?? "razorpay_error" });
        continue;
      }

      if (plink.status === "paid") {
        const settled = await settlePaidPlink(supabase, tx, plink);
        results.push({ tx: tx.id, ...settled, plink_status: plink.status });
      } else if (plink.status === "cancelled" || plink.status === "expired") {
        await supabase.from("payment_transactions")
          .update({ status: "failed", webhook_data: { ...(tx.webhook_data || {}), plink_status: plink.status } })
          .eq("id", tx.id);
        results.push({ tx: tx.id, plink_status: plink.status, updated: "failed" });
      } else {
        results.push({ tx: tx.id, plink_status: plink.status, updated: "no_change" });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, checked: txs?.length ?? 0, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("reconcile-razorpay-links error:", err?.message ?? err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
