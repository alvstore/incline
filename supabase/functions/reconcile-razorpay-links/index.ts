// v2.1.0 — preserves capture time and Razorpay settlement deductions.
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

async function settleCaptured(supabase: any, tx: any, paidPayment: any) {
  const gatewayPaymentId = paidPayment?.id ?? paidPayment?.payment_id ?? null;
  const paidAmount = Number(paidPayment?.amount ?? 0) / 100;
  if (!gatewayPaymentId || !Number.isFinite(paidAmount) || paidAmount <= 0) {
    return { ok: false, reason: "invalid_captured_payment" };
  }
  if (paidPayment?.order_id && paidPayment.order_id !== tx.gateway_order_id) {
    return { ok: false, reason: "order_mismatch" };
  }
  if (Math.abs(paidAmount - Number(tx.amount)) > 0.01) {
    return { ok: false, reason: "amount_mismatch", expected: Number(tx.amount), captured: paidAmount };
  }
  const paymentMethod = paidPayment?.method === "upi"
    ? "upi"
    : paidPayment?.method === "netbanking"
      ? "bank_transfer"
      : "card";
  const capturedAt = Number.isFinite(Number(paidPayment?.created_at))
    ? new Date(Number(paidPayment.created_at) * 1000).toISOString()
    : new Date().toISOString();
  const gatewayFee = Number(paidPayment?.fee ?? 0) / 100;
  const gatewayTax = Number(paidPayment?.tax ?? 0) / 100;
  const netSettlement = Math.max(0, paidAmount - gatewayFee - gatewayTax);

  // 1. Invoice snapshot (for member_id / branch_id / totals)
  const { data: inv } = await supabase
    .from("invoices")
    .select("id, branch_id, member_id, total_amount, amount_paid, status, invoice_number")
    .eq("id", tx.invoice_id)
    .maybeSingle();
  if (!inv) return { ok: false, reason: "invoice_missing" };

  const { data: settled, error: settleError } = await supabase.rpc("settle_payment", {
    p_branch_id: inv.branch_id,
    p_invoice_id: inv.id,
    p_member_id: inv.member_id,
    p_amount: paidAmount,
    p_payment_method: paymentMethod,
    p_transaction_id: gatewayPaymentId,
    p_notes: `Razorpay payment ${gatewayPaymentId} auto-reconciled`,
    p_received_by: null,
    p_income_category_id: null,
    p_payment_source: "razorpay",
    p_idempotency_key: `reconcile:razorpay:${gatewayPaymentId}`,
    p_gateway_payment_id: gatewayPaymentId,
    p_payment_transaction_id: tx.id,
    p_metadata: {
      gateway: "razorpay",
      source: "reconcile-razorpay-links",
      gateway_order_id: tx.gateway_order_id,
      gateway_captured_at: capturedAt,
      gateway_fee: gatewayFee,
      gateway_tax: gatewayTax,
      net_settlement_amount: netSettlement,
    },
  });
  if (settleError) throw settleError;
  if (settled?.success === false) throw new Error(settled.error || "settle_payment failed");

  // Idempotent settlement can return an already-recorded payment. Enrich that
  // ledger row as well so historical reconciliations gain the true capture
  // date and the provider deduction breakdown.
  await supabase
    .from("payments")
    .update({
      payment_date: capturedAt,
      settled_at: capturedAt,
      payment_method: paymentMethod,
      payment_source: "razorpay",
      gateway_order_id: tx.gateway_order_id,
      gateway_fee: gatewayFee,
      gateway_tax: gatewayTax,
      net_settlement_amount: netSettlement,
      lifecycle_metadata: {
        gateway: "razorpay",
        source: "reconcile-razorpay-links",
        gateway_payment_id: gatewayPaymentId,
        gateway_order_id: tx.gateway_order_id,
        gateway_captured_at: capturedAt,
        gateway_fee: gatewayFee,
        gateway_tax: gatewayTax,
        net_settlement_amount: netSettlement,
      },
    })
    .eq("transaction_id", gatewayPaymentId)
    .eq("invoice_id", inv.id);

  // 4. Mark payment_transactions row
  await supabase.from("payment_transactions")
    .update({
      status: "captured",
      gateway_payment_id: gatewayPaymentId,
      event_type: "reconciled.captured",
      received_at: capturedAt,
      source: "reconciler",
      webhook_data: { ...(tx.webhook_data || {}), reconciled_at: new Date().toISOString(), reconciler_version: "2.1.0", gateway_fee: gatewayFee, gateway_tax: gatewayTax },
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
      .eq("source", "order")
      .gte("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (invoiceId) q = q.eq("invoice_id", invoiceId);
    else q = q.in("status", ["created", "pending", "authorized"]);

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
      const isPaymentLink = tx.gateway_order_id.startsWith("plink_");
      const resourcePath = isPaymentLink
        ? `/payment_links/${tx.gateway_order_id}`
        : `/orders/${tx.gateway_order_id}/payments`;
      const r = await fetch(`https://api.razorpay.com/v1${resourcePath}`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      const gatewayData = await r.json();
      if (!r.ok) {
        results.push({ tx: tx.id, error: gatewayData?.error?.description ?? "razorpay_error" });
        continue;
      }

      const paidPayment = isPaymentLink
        ? (Array.isArray(gatewayData.payments)
          ? gatewayData.payments.find((p: any) => p.status === "captured") ?? gatewayData.payments[0]
          : null)
        : (Array.isArray(gatewayData.items)
          ? gatewayData.items.find((p: any) => p.status === "captured")
          : null);
      if (paidPayment && (gatewayData.status === "paid" || paidPayment.status === "captured")) {
        const settled = await settleCaptured(supabase, tx, paidPayment);
        results.push({ tx: tx.id, ...settled, gateway_status: paidPayment.status });
      } else if (isPaymentLink && (gatewayData.status === "cancelled" || gatewayData.status === "expired")) {
        await supabase.from("payment_transactions")
          .update({ status: "failed", webhook_data: { ...(tx.webhook_data || {}), plink_status: gatewayData.status } })
          .eq("id", tx.id);
        results.push({ tx: tx.id, gateway_status: gatewayData.status, updated: "failed" });
      } else {
        results.push({ tx: tx.id, gateway_status: gatewayData.status ?? "not_captured", updated: "no_change" });
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
