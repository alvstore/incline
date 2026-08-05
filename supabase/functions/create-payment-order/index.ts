// v2.1.0 — Convenience fee quoted at gateway only (invoice never mutated). Hardened payment order creation with branch-then-global gateway lookup.
// Returns enough data for embedded checkout (Razorpay Standard Checkout modal /
// PhonePe IFRAME PayPage). Records the canonical payment_transactions row with
// source='order' so payment-webhook can match and settle it idempotently.

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({} as any));
    const invoiceId: string | undefined = body.invoiceId;
    let gateway: string | undefined = body.gateway;
    const branchId: string | undefined = body.branchId;

    if (!invoiceId || !branchId) {
      return jsonResponse(
        { error: "invoiceId and branchId are required", code: "MISSING_PARAMS" },
        400,
      );
    }

    // Quote the online convenience fee. It is NEVER written to the invoice —
    // it is only added on top of the amount charged at the gateway.
    let feeInfo: Record<string, unknown> | null = null;
    const { data: feeResult, error: feeError } = await supabase.rpc("quote_convenience_fee", {
      p_invoice_id: invoiceId,
      p_method: "online",
    });
    if (feeError) {
      console.warn("create-payment-order: convenience fee quote skipped:", feeError.message);
    } else if ((feeResult as any)?.applied) {
      feeInfo = feeResult as Record<string, unknown>;
    }
    const surcharge = Number((feeInfo as any)?.fee_total ?? 0);

    // Invoice lookup
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount, amount_paid, branch_id, member_id, status")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return jsonResponse({ error: "Invoice not found", code: "INVOICE_NOT_FOUND" }, 404);
    }

    const amountDue = Number(invoice.total_amount) - Number(invoice.amount_paid || 0);
    if (amountDue <= 0) {
      return jsonResponse({ error: "Invoice already paid", code: "INVOICE_PAID" }, 400);
    }

    // Resolve active gateway: branch-specific first, then global (branch_id IS NULL).
    // If caller didn't specify a gateway, pick whichever active one we find.
    const baseSelect = "provider, credentials, config, is_active, branch_id";
    let gatewayRow: any = null;

    if (gateway) {
      const { data } = await supabase
        .from("integration_settings")
        .select(baseSelect)
        .eq("integration_type", "payment_gateway")
        .eq("provider", gateway)
        .eq("is_active", true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order("branch_id", { ascending: true, nullsFirst: false })
        .limit(1);
      gatewayRow = (data || [])[0] || null;
    } else {
      const { data } = await supabase
        .from("integration_settings")
        .select(baseSelect)
        .eq("integration_type", "payment_gateway")
        .eq("is_active", true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order("branch_id", { ascending: true, nullsFirst: false })
        .limit(1);
      gatewayRow = (data || [])[0] || null;
      gateway = gatewayRow?.provider;
    }

    if (!gatewayRow || !gateway) {
      return jsonResponse(
        {
          error:
            "Online payments are not configured for this branch yet. Please contact the front desk to pay.",
          code: "NO_GATEWAY",
        },
        400,
      );
    }

    const credentials = (gatewayRow.credentials || {}) as Record<string, string>;

    const chargeAmount = Math.round((amountDue + surcharge) * 100) / 100;

    const orderResponse: any = {
      orderId: `ORD-${Date.now()}`,
      amount: chargeAmount,
      currency: "INR",
      invoiceId,
      gateway,
    };

    if (gateway === "razorpay") {
      const keyId = credentials.key_id || Deno.env.get("RAZORPAY_KEY_ID");
      const keySecret = credentials.key_secret || Deno.env.get("RAZORPAY_KEY_SECRET");
      if (!keyId || !keySecret) {
        return jsonResponse(
          { error: "Razorpay credentials missing", code: "GATEWAY_CREDENTIALS_MISSING" },
          400,
        );
      }

      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        },
        body: JSON.stringify({
          amount: Math.round(chargeAmount * 100),
          currency: "INR",
          receipt: invoice.invoice_number || invoiceId.slice(0, 30),
          notes: {
            invoice_id: invoiceId,
            branch_id: branchId,
            base_amount: String(amountDue),
            convenience_fee: String(surcharge),
          },
        }),
      });

      if (!rzpRes.ok) {
        const txt = await rzpRes.text();
        console.error("Razorpay order error:", txt);
        return jsonResponse(
          { error: "Failed to create Razorpay order", code: "GATEWAY_ERROR", detail: txt.slice(0, 500) },
          502,
        );
      }

      const rzpData = await rzpRes.json();
      orderResponse.gatewayOrderId = rzpData.id;
      orderResponse.razorpayKey = keyId;
      orderResponse.embedded = true; // Razorpay Standard Checkout opens as same-page modal
    } else if (gateway === "phonepe") {
      // PhonePe Standard Checkout (v2 API). The frontend uses
      // PhonePeCheckout.transact({ tokenUrl, type: 'IFRAME' }) with redirectUrl.
      orderResponse.checkoutHint =
        "Use PhonePe IFRAME PayPage. Server-side token URL generation requires PhonePe v2 OAuth flow which is not configured in this environment.";
      orderResponse.embedded = false;
      orderResponse.notImplemented = true;
      return jsonResponse(
        {
          error:
            "PhonePe embedded checkout is not yet enabled in this environment. Switch the active gateway to Razorpay or contact support.",
          code: "GATEWAY_NOT_IMPLEMENTED",
        },
        400,
      );
    } else {
      return jsonResponse(
        { error: `Embedded checkout for ${gateway} is not yet supported.`, code: "GATEWAY_NOT_IMPLEMENTED" },
        400,
      );
    }

    // Record canonical "order" transaction so payment-webhook can match it.
    await supabase.from("payment_transactions").insert({
      invoice_id: invoiceId,
      branch_id: branchId,
      member_id: invoice.member_id,
      gateway,
      gateway_order_id: orderResponse.gatewayOrderId,
      amount: chargeAmount,
      currency: "INR",
      status: "created",
      source: "order",
    });

    return jsonResponse(
      { ...orderResponse, convenienceFee: feeInfo, amountDue, chargeAmount },
      200,
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("create-payment-order error:", errorMessage);
    return jsonResponse({ error: errorMessage, code: "INTERNAL_ERROR" }, 500);
  }
});
