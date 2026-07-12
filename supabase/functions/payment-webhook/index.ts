import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-phonepe-signature, x-verify",
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_SIZE = 102400;
const ALLOWED_GATEWAYS = ['razorpay', 'phonepe', 'payu'];

interface RazorpayPaymentEntity {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  invoice_id: string | null;
  method: string;
  captured: boolean;
  notes: Record<string, string>;
}

interface PhonePeWebhookPayload {
  merchantId: string;
  merchantTransactionId: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
  paymentInstrument: { type: string; utr?: string };
}

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

function isValidGateway(gateway: string): boolean {
  return ALLOWED_GATEWAYS.includes(gateway.toLowerCase());
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Outcome {
  branchId: string | null;
  gateway: string | null;
  signatureVerified: boolean | null;
  eventType: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  amount: number | null;
  status: string | null; // 'created' | 'authorized' | 'captured' | 'failed' | 'received' | 'rejected'
  errorMessage: string | null;
  payload: unknown;
  invoiceId: string | null;
}

async function persistOutcome(supabase: any, o: Outcome, httpStatus: number, responseBody?: unknown) {
  // POLICY: webhook deliveries with a missing/invalid branch_id are NOT persisted in
  // payment_transactions because that table's branch_id is NOT NULL with a FK to
  // branches(id). Such deliveries are inherently malformed (the branch_id query
  // param is part of the webhook URL we hand to the gateway, so a missing value
  // means someone hit the endpoint manually or the URL was misconfigured).
  // We log them to the function's console and return a 4xx so the gateway will
  // retry, but they don't pollute the activity feed. Future enhancement: a separate
  // branch-agnostic webhook_errors sink — tracked as a follow-up.
  if (!o.branchId || !isValidUUID(o.branchId)) {
    console.warn(`[payment-webhook] Skipping persistence — invalid branch_id (status=${httpStatus}, error=${o.errorMessage})`);
    return;
  }
  try {
    const nowIso = new Date().toISOString();

    // Append-only delivery log — every webhook results in its own row so that
    // retries, signature failures, and status transitions are all preserved.
    await supabase.from('payment_transactions').insert({
      branch_id: o.branchId,
      gateway: o.gateway || 'unknown',
      gateway_order_id: o.gatewayOrderId,
      gateway_payment_id: o.gatewayPaymentId,
      invoice_id: o.invoiceId,
      amount: o.amount ?? 0,
      status: o.status || 'received',
      webhook_data: o.payload || {},
      response_body: responseBody ?? null,
      signature_verified: o.signatureVerified,
      http_status: httpStatus,
      error_message: o.errorMessage,
      event_type: o.eventType,
      received_at: nowIso,
      updated_at: nowIso,
      source: 'webhook',
    });

    // Separately update the canonical 'order' transaction row (if any) so the
    // current lifecycle status of that order is reflected on the original record.
    // Strictly scoped by branch to prevent cross-tenant collisions on reused IDs.
    if (o.gatewayOrderId && o.status && ['captured', 'authorized', 'failed'].includes(o.status)) {
      await supabase
        .from('payment_transactions')
        .update({
          gateway_payment_id: o.gatewayPaymentId,
          status: o.status,
          webhook_data: o.payload || {},
          event_type: o.eventType,
          signature_verified: o.signatureVerified,
          received_at: nowIso,
          updated_at: nowIso,
        })
        .eq('gateway_order_id', o.gatewayOrderId)
        .eq('gateway', o.gateway || 'unknown')
        .eq('branch_id', o.branchId)
        .eq('source', 'order');
    }
  } catch (e) {
    console.error('persistOutcome failed:', e);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const outcome: Outcome = {
    branchId: null, gateway: null, signatureVerified: null, eventType: null,
    gatewayOrderId: null, gatewayPaymentId: null, amount: null, status: null,
    errorMessage: null, payload: null, invoiceId: null,
  };
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const reply = async (body: unknown, status: number, errorMsg?: string) => {
    if (errorMsg) outcome.errorMessage = errorMsg;
    if (status >= 400 && !outcome.status) outcome.status = 'rejected';
    // Best-effort enrich with linked invoice from canonical order row
    if (!outcome.invoiceId && outcome.gatewayOrderId && outcome.branchId && isValidUUID(outcome.branchId)) {
      try {
        const { data: order } = await supabase
          .from('payment_transactions')
          .select('invoice_id')
          .eq('gateway_order_id', outcome.gatewayOrderId)
          .eq('gateway', outcome.gateway || 'unknown')
          .eq('branch_id', outcome.branchId)
          .eq('source', 'order')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (order?.invoice_id) outcome.invoiceId = order.invoice_id;
      } catch (_) { /* swallow */ }
    }
    await persistOutcome(supabase, outcome, status, body);
    return jsonResponse(body, status);
  };

  try {
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > MAX_PAYLOAD_SIZE) {
      return reply({ error: "Request too large" }, 413, "Payload too large");
    }

    const url = new URL(req.url);
    const gateway = url.searchParams.get("gateway") || "razorpay";
    const branchId = url.searchParams.get("branch_id");
    outcome.gateway = gateway;
    outcome.branchId = branchId;

    if (!isValidGateway(gateway)) {
      return reply({ error: "Invalid payment gateway" }, 400, `Invalid gateway: ${gateway}`);
    }
    if (!branchId) return reply({ error: "branch_id is required" }, 400, "Missing branch_id query param");
    if (!isValidUUID(branchId)) return reply({ error: "Invalid branch_id format" }, 400, `Invalid branch_id format: ${branchId}`);

    const { data: branchExists } = await supabase
      .from("branches").select("id").eq("id", branchId).maybeSingle();
    if (!branchExists) return reply({ error: "Branch not found" }, 404, `Branch not found: ${branchId}`);

    const body = await req.text();
    let payload: any;
    try { payload = JSON.parse(body); }
    catch { return reply({ error: "Invalid JSON payload" }, 400, "Invalid JSON payload"); }
    outcome.payload = payload;

    const { data: integration } = await supabase
      .from("integration_settings")
      .select("credentials")
      .eq("branch_id", branchId)
      .eq("integration_type", "payment_gateway")
      .eq("provider", gateway)
      .eq("is_active", true)
      .maybeSingle();

    if (!integration) {
      return reply({ error: "Integration not configured" }, 400, "Integration not configured for branch");
    }

    let transactionData: {
      gateway_order_id: string;
      gateway_payment_id: string;
      amount: number;
      status: string;
      webhook_data: unknown;
    };

    if (gateway === "razorpay") {
      const razorpaySignature = req.headers.get("x-razorpay-signature");
      const webhookSecret = integration.credentials?.webhook_secret;

      // Fail-closed: reject if webhook secret is not configured or signature is missing/invalid.
      if (!webhookSecret) {
        outcome.signatureVerified = false;
        outcome.eventType = payload?.event || null;
        return reply({ error: "Webhook secret not configured" }, 401, "Razorpay webhook secret not configured for branch — refusing to process unsigned webhook");
      }
      if (!razorpaySignature) {
        outcome.signatureVerified = false;
        outcome.eventType = payload?.event || null;
        return reply({ error: "Missing signature" }, 401, "Missing Razorpay signature");
      }
      const expectedSignature = await generateHmacSha256(body, webhookSecret);
      if (razorpaySignature !== expectedSignature) {
        outcome.signatureVerified = false;
        outcome.eventType = payload?.event || null;
        return reply({ error: "Invalid signature" }, 401, "Invalid Razorpay signature");
      }
      outcome.signatureVerified = true;

      const event = payload.event;
      outcome.eventType = event;

      if (event === "payment_link.paid") {
        const plinkEntity = payload.payload?.payment_link?.entity;
        const paymentEntity = payload.payload?.payment?.entity;
        const referenceId = plinkEntity?.reference_id;
        const rzpAmount = (paymentEntity?.amount || plinkEntity?.amount || 0) / 100;
        const paymentId = paymentEntity?.id || plinkEntity?.id;

        outcome.gatewayOrderId = plinkEntity?.id || null;
        outcome.gatewayPaymentId = paymentId || null;
        outcome.amount = rzpAmount;
        outcome.status = 'captured';

        if (referenceId && isValidUUID(referenceId)) {
          const { data: invoice } = await supabase
            .from("invoices").select("id, member_id, branch_id").eq("id", referenceId).maybeSingle();
          if (invoice) {
            const { data: payResult } = await supabase.rpc("record_payment", {
              p_branch_id: invoice.branch_id,
              p_invoice_id: invoice.id,
              p_member_id: invoice.member_id,
              p_amount: rzpAmount,
              p_payment_method: "online",
              p_transaction_id: paymentId,
              p_notes: "Auto-recorded via Razorpay Payment Link",
            });
            console.log("record_payment result:", JSON.stringify(payResult));

            const { data: membershipItems } = await supabase
              .from("invoice_items").select("reference_id")
              .eq("invoice_id", referenceId)
              .in("reference_type", ["membership", "membership_renewal"]);

            if (membershipItems && membershipItems.length > 0 && invoice.member_id) {
              try {
                await fetch(`${supabaseUrl}/functions/v1/sync-to-mips`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${supabaseServiceKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "sync_member", member_id: invoice.member_id, branch_id: invoice.branch_id }),
                });
              } catch (syncErr) { console.error("MIPS sync failed:", syncErr); }
            }
          }
        }
        return reply({ status: "success" }, 200);
      }

      const paymentEntity = payload.payload?.payment?.entity as RazorpayPaymentEntity;
      if (!paymentEntity) {
        outcome.status = 'received';
        return reply({ status: "ignored" }, 200);
      }

      let status = "created";
      if (event === "payment.captured") status = "captured";
      else if (event === "payment.authorized") status = "authorized";
      else if (event === "payment.failed") status = "failed";

      transactionData = {
        gateway_order_id: paymentEntity.order_id,
        gateway_payment_id: paymentEntity.id,
        amount: paymentEntity.amount / 100,
        status,
        webhook_data: payload,
      };
    } else if (gateway === "phonepe") {
      const phonePeSignature = req.headers.get("x-verify");
      const saltKey = integration.credentials?.salt_key;
      const saltIndex = integration.credentials?.salt_index || "1";

      // Fail-closed: reject if salt key not configured or signature missing/invalid.
      if (!saltKey) {
        outcome.signatureVerified = false;
        return reply({ error: "Webhook secret not configured" }, 401, "PhonePe salt key not configured for branch — refusing to process unsigned webhook");
      }
      if (!phonePeSignature) {
        outcome.signatureVerified = false;
        return reply({ error: "Missing signature" }, 401, "Missing PhonePe signature");
      }
      const base64Body = btoa(body);
      const stringToSign = base64Body + "/pg/v1/status/" + saltKey;
      const expectedChecksum = await sha256(stringToSign) + "###" + saltIndex;
      if (phonePeSignature !== expectedChecksum) {
        outcome.signatureVerified = false;
        return reply({ error: "Invalid signature" }, 401, "Invalid PhonePe signature");
      }
      outcome.signatureVerified = true;

      const data = payload.data as PhonePeWebhookPayload;
      let status = "created";
      if (data.state === "COMPLETED") status = "captured";
      else if (data.state === "FAILED") status = "failed";
      else if (data.state === "PENDING") status = "authorized";
      outcome.eventType = data.state || null;

      transactionData = {
        gateway_order_id: data.merchantTransactionId,
        gateway_payment_id: data.transactionId,
        amount: data.amount / 100,
        status,
        webhook_data: payload,
      };
    } else if (gateway === "payu") {
      const payuStatus = payload.status;
      const txnId = payload.txnid;
      const payuAmount = parseFloat(payload.amount || "0");
      const productInfo = payload.productinfo || "";
      const referenceId = payload.udf1;
      const payuTxnId = payload.mihpayid;

      const merchantKey = integration.credentials?.merchant_key;
      const merchantSalt = integration.credentials?.merchant_salt;

      // Fail-closed: reject if merchant key/salt not configured or hash missing/invalid.
      if (!merchantKey || !merchantSalt) {
        outcome.signatureVerified = false;
        return reply({ error: "Webhook secret not configured" }, 401, "PayU merchant key/salt not configured for branch — refusing to process unsigned webhook");
      }
      if (!payload.hash) {
        outcome.signatureVerified = false;
        return reply({ error: "Missing signature" }, 401, "Missing PayU hash");
      }
      const reverseHashString = `${merchantSalt}|${payuStatus}||||||${payload.udf5 || ""}|${payload.udf4 || ""}|${payload.udf3 || ""}|${payload.udf2 || ""}|${payload.udf1 || ""}|${payload.email || ""}|${payload.firstname || ""}|${productInfo}|${payuAmount}|${txnId}|${merchantKey}`;
      const expectedHash = await sha512(reverseHashString);
      if (payload.hash !== expectedHash) {
        outcome.signatureVerified = false;
        return reply({ error: "Invalid signature" }, 401, "Invalid PayU signature");
      }
      outcome.signatureVerified = true;

      outcome.eventType = payuStatus || null;

      if (payuStatus === "success" && referenceId && isValidUUID(referenceId)) {
        const { data: invoice } = await supabase
          .from("invoices").select("id, member_id, branch_id").eq("id", referenceId).maybeSingle();
        if (invoice) {
          const { data: payResult } = await supabase.rpc("record_payment", {
            p_branch_id: invoice.branch_id,
            p_invoice_id: invoice.id,
            p_member_id: invoice.member_id,
            p_amount: payuAmount,
            p_payment_method: "online",
            p_transaction_id: payuTxnId,
            p_notes: "Auto-recorded via PayU",
          });
          console.log("PayU record_payment:", JSON.stringify(payResult));

          const { data: membershipItems } = await supabase
            .from("invoice_items").select("reference_id")
            .eq("invoice_id", referenceId)
            .in("reference_type", ["membership", "membership_renewal"]);

          if (membershipItems && membershipItems.length > 0 && invoice.member_id) {
            try {
              await fetch(`${supabaseUrl}/functions/v1/sync-to-mips`, {
                method: "POST",
                headers: { Authorization: `Bearer ${supabaseServiceKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ action: "sync_member", member_id: invoice.member_id, branch_id: invoice.branch_id }),
              });
            } catch (syncErr) { console.error("MIPS sync failed:", syncErr); }
          }
        }
      }

      let status = "created";
      if (payuStatus === "success") status = "captured";
      else if (payuStatus === "failure") status = "failed";
      else if (payuStatus === "pending") status = "authorized";

      transactionData = {
        gateway_order_id: txnId,
        gateway_payment_id: payuTxnId || txnId,
        amount: payuAmount,
        status,
        webhook_data: payload,
      };

      if (payuStatus === "success" && referenceId) {
        outcome.gatewayOrderId = transactionData.gateway_order_id;
        outcome.gatewayPaymentId = transactionData.gateway_payment_id;
        outcome.amount = transactionData.amount;
        outcome.status = transactionData.status;
        return reply({ status: "success" }, 200);
      }
    } else {
      return reply({ error: "Unsupported gateway" }, 400, `Unsupported gateway: ${gateway}`);
    }

    outcome.gatewayOrderId = transactionData.gateway_order_id;
    outcome.gatewayPaymentId = transactionData.gateway_payment_id;
    outcome.amount = transactionData.amount;
    outcome.status = transactionData.status;

    // Look up the canonical order row for invoice/payments side-effects.
    // Strictly scoped by branch + gateway + source='order' to avoid cross-tenant
    // collisions and to never match webhook log rows.
    const { data: existingTxn } = await supabase
      .from("payment_transactions")
      .select("id, invoice_id")
      .eq("gateway_order_id", transactionData.gateway_order_id)
      .eq("branch_id", branchId)
      .eq("gateway", gateway)
      .eq("source", "order")
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingTxn) {
      outcome.invoiceId = existingTxn.invoice_id;
      // Route the captured payment through the authoritative settle_payment RPC
      // so that membership activation, hardware-access evaluation, referral
      // conversion/reward logic, lifecycle events and audit trail all fire.
      if (transactionData.status === "captured" && existingTxn.invoice_id) {
        const { data: invoice } = await supabase
          .from("invoices")
          .select("member_id, branch_id, total_amount, amount_paid, status")
          .eq("id", existingTxn.invoice_id)
          .maybeSingle();

        if (invoice) {
          // Idempotency key so retried webhook deliveries don't double-settle.
          const idemKey = `webhook:${gateway}:${transactionData.gateway_payment_id ?? transactionData.gateway_order_id}`;

          const { data: settleResult, error: settleError } = await supabase.rpc("settle_payment", {
            p_branch_id: invoice.branch_id,
            p_invoice_id: existingTxn.invoice_id,
            p_member_id: invoice.member_id,
            p_amount: transactionData.amount,
            p_payment_method: "online",
            p_transaction_id: transactionData.gateway_payment_id,
            p_notes: `Online payment via ${gateway}`,
            p_received_by: null,
            p_income_category_id: null,
            p_payment_source: gateway,
            p_idempotency_key: idemKey,
            p_gateway_payment_id: transactionData.gateway_payment_id,
            p_payment_transaction_id: existingTxn.id,
            p_metadata: { gateway, source: "payment-webhook" },
          });

          if (settleError) {
            console.error("[payment-webhook] settle_payment RPC failed:", settleError);
            outcome.errorMessage = `settle_payment failed: ${settleError.message}`;
          } else if (settleResult && (settleResult as any).success === false) {
            console.error("[payment-webhook] settle_payment returned error:", settleResult);
            outcome.errorMessage = `settle_payment error: ${(settleResult as any).error}`;
          }
        }
      }
    }

    return reply({ status: "success" }, 200);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Webhook error:", errorMessage);
    await captureEdgeError('payment-webhook', error, { severity: 'critical' });
    return reply({ error: "Internal server error" }, 500, errorMessage);
  }
});

async function generateHmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha512(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
