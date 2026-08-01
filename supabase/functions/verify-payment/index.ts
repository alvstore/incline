// v1.0.0 — Verify Razorpay Standard Checkout handler response and settle the
// invoice authoritatively via settle_payment with idempotency. Designed to be
// called from the embedded checkout success handler in MemberCheckout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const serve = Deno.serve;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({} as any));
    const gateway: string = body.gateway || "razorpay";
    const invoiceId: string | undefined = body.invoiceId;
    const branchId: string | undefined = body.branchId;

    if (!invoiceId || !branchId) {
      return jsonResponse({ error: "invoiceId and branchId are required", code: "MISSING_PARAMS" }, 400);
    }

    if (gateway !== "razorpay") {
      return jsonResponse(
        { error: `Verification for ${gateway} is not implemented`, code: "GATEWAY_NOT_IMPLEMENTED" },
        400,
      );
    }

    const razorpay_payment_id: string | undefined = body.razorpay_payment_id;
    const razorpay_order_id: string | undefined = body.razorpay_order_id;
    const razorpay_signature: string | undefined = body.razorpay_signature;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return jsonResponse({ error: "Missing Razorpay handler fields", code: "MISSING_PARAMS" }, 400);
    }

    // Resolve the gateway secret (branch first, then global).
    const { data: integrations } = await supabase
      .from("integration_settings")
      .select("credentials, branch_id")
      .eq("integration_type", "payment_gateway")
      .eq("provider", "razorpay")
      .eq("is_active", true)
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .order("branch_id", { ascending: true, nullsFirst: false });

    const integration = (integrations || [])[0] as any;
    const keySecret: string | undefined = integration?.credentials?.key_secret;
    if (!keySecret) {
      return jsonResponse({ error: "Razorpay not configured", code: "NO_GATEWAY" }, 400);
    }

    const expected = await hmacSha256Hex(`${razorpay_order_id}|${razorpay_payment_id}`, keySecret);
    if (expected !== razorpay_signature) {
      return jsonResponse({ error: "Invalid Razorpay signature", code: "BAD_SIGNATURE" }, 401);
    }

    // Match canonical 'order' transaction
    const { data: txn } = await supabase
      .from("payment_transactions")
      .select("id, amount, invoice_id")
      .eq("gateway_order_id", razorpay_order_id)
      .eq("gateway", "razorpay")
      .eq("source", "order")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, member_id, branch_id, total_amount, amount_paid, status")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice) return jsonResponse({ error: "Invoice not found", code: "INVOICE_NOT_FOUND" }, 404);

    const amountDue = Number(invoice.total_amount) - Number(invoice.amount_paid || 0);
    const amount = Number(txn?.amount ?? amountDue);

    const idemKey = `verify:razorpay:${razorpay_payment_id}`;

    const { data: settled, error: settleError } = await supabase.rpc("settle_payment", {
      p_branch_id: invoice.branch_id,
      p_invoice_id: invoice.id,
      p_member_id: invoice.member_id,
      p_amount: amount,
      // "online" is NOT a member of the payment_method enum — use "other".
      p_payment_method: "other",
      p_transaction_id: razorpay_payment_id,
      p_notes: "Online payment via Razorpay Standard Checkout",
      p_received_by: null,
      p_income_category_id: null,
      p_payment_source: "razorpay",
      p_idempotency_key: idemKey,
      p_gateway_payment_id: razorpay_payment_id,
      p_payment_transaction_id: txn?.id ?? null,
      p_metadata: { gateway: "razorpay", source: "verify-payment", razorpay_order_id },
    });

    if (settleError) {
      console.error("verify-payment settle_payment error:", settleError);
      return jsonResponse({ error: settleError.message, code: "SETTLE_FAILED" }, 500);
    }
    const result = settled as any;
    if (result && result.success === false) {
      return jsonResponse({ error: result.error || "Settle failed", code: "SETTLE_FAILED" }, 500);
    }

    return jsonResponse({
      success: true,
      invoice_id: invoice.id,
      new_status: result?.new_status ?? null,
      new_amount_paid: result?.new_amount_paid ?? null,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-payment error:", msg);
    return jsonResponse({ error: msg, code: "INTERNAL_ERROR" }, 500);
  }
});
