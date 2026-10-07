import { supabase } from '@/integrations/supabase/client';
import { recordPayment as unifiedRecordPayment } from '@/services/billingService';

export interface PaymentGatewayConfig {
  provider: 'razorpay' | 'phonepe' | 'ccavenue' | 'payu';
  isActive: boolean;
  config: Record<string, any>;
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  invoiceId: string;
  gateway: string;
  gatewayOrderId?: string;
  checkoutUrl?: string;
  razorpayKey?: string;
  embedded?: boolean;
}

export interface PaymentOrderError extends Error {
  code?: string;
}

/**
 * Resolve the active payment gateway visible to a branch
 * (branch-scoped first, then global fallback).
 */
export async function fetchActiveGateway(branchId: string): Promise<PaymentGatewayConfig | null> {
  // Only non-secret columns; gateway credentials never reach the browser.
  const { data, error } = await supabase
    .from('integration_settings')
    .select('provider, is_active')
    .eq('integration_type', 'payment_gateway')
    .eq('is_active', true)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .order('branch_id', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    provider: data.provider as PaymentGatewayConfig['provider'],
    isActive: data.is_active ?? false,
    config: {},
  };
}

/**
 * Initialize a payment order. Routes through the create-payment-order edge
 * function which now picks the correct gateway (branch first, then global)
 * and returns enough data for an embedded Razorpay Standard Checkout.
 */
export async function initializePayment(
  invoiceId: string,
  branchId: string,
  gateway?: string,
): Promise<PaymentOrder> {
  const { data, error } = await supabase.functions.invoke('create-payment-order', {
    body: { invoiceId, branchId, gateway },
  });

  // The functions client surfaces non-2xx as `error`. Try to read structured detail
  // from the response body for better UX.
  if (error) {
    let detail: any = null;
    try {
      detail = (data as any) || JSON.parse((error as any)?.context?.body || '{}');
    } catch {
      detail = null;
    }
    const err: PaymentOrderError = new Error(detail?.error || error.message || 'Failed to create payment order');
    err.code = detail?.code;
    throw err;
  }

  const parsed = (data as any) || {};
  if (parsed.error) {
    const err: PaymentOrderError = new Error(parsed.error);
    err.code = parsed.code;
    throw err;
  }
  return parsed as PaymentOrder;
}

/**
 * Verify a Razorpay handler response server-side and settle the invoice
 * via the authoritative settle_payment RPC.
 */
export async function verifyRazorpayPayment(args: {
  invoiceId: string;
  branchId: string;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}): Promise<{ success: boolean; new_status?: string; new_amount_paid?: number }> {
  const { data, error } = await supabase.functions.invoke('verify-payment', {
    body: { gateway: 'razorpay', ...args },
  });
  if (error) {
    const detail: any = data || {};
    throw new Error(detail.error || error.message || 'Payment verification failed');
  }
  const result = (data as any) || {};
  if (!result.success) throw new Error(result.error || 'Payment verification failed');
  return result;
}

/**
 * Record a manual/cash payment.
 * Delegates to the unified record_payment RPC via billingService.
 */
export async function recordManualPayment(
  invoiceId: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'upi' | 'bank_transfer',
  notes?: string
): Promise<{ success: boolean }> {
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('branch_id, member_id')
    .eq('id', invoiceId)
    .single();

  if (invoiceError) throw invoiceError;

  await unifiedRecordPayment({
    branchId: invoice.branch_id,
    invoiceId,
    memberId: invoice.member_id || undefined,
    amount,
    paymentMethod,
    notes,
  });

  return { success: true };
}

// Load Razorpay SDK dynamically. The Standard Checkout opens an in-page modal
// (no full-page redirect).
export function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export interface RazorpayMemberInfo {
  name: string;
  email: string;
  phone: string;
}

/**
 * Open the Razorpay Standard Checkout modal. Calls the success/error callbacks
 * with the gateway response so the caller can verify it server-side.
 */
export async function openRazorpayCheckout(
  order: PaymentOrder,
  memberInfo: RazorpayMemberInfo,
  onSuccess: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void,
  onError: (error: Error) => void
): Promise<void> {
  const loaded = await loadRazorpayScript();
  if (!loaded) {
    onError(new Error('Failed to load Razorpay SDK'));
    return;
  }

  const options: any = {
    key: order.razorpayKey,
    amount: order.amount * 100,
    currency: order.currency || 'INR',
    name: 'Incline Fitness',
    description: `Invoice ${order.invoiceId}`,
    order_id: order.gatewayOrderId,
    prefill: {
      name: memberInfo.name,
      email: memberInfo.email,
      contact: memberInfo.phone,
    },
    handler: (response: any) => onSuccess({
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_order_id: response.razorpay_order_id,
      razorpay_signature: response.razorpay_signature,
    }),
    modal: {
      ondismiss: () => onError(new Error('Payment cancelled')),
      escape: true,
    },
    theme: { color: '#f97316' },
  };

  const rzp = new (window as any).Razorpay(options);
  rzp.on('payment.failed', (response: any) => {
    onError(new Error(response.error?.description || 'Payment failed'));
  });
  rzp.open();
}

/**
 * Atomically reverse a payment (refund or commission reversal).
 * Calls the SECURITY DEFINER `reverse_payment` RPC. Idempotent: if a
 * reversal already exists for the same payment_id the existing reversal
 * row is returned.
 */
export async function reversePayment(
  paymentId: string,
  reason: string,
  actorId?: string,
): Promise<{ status: string; reversal_payment_id: string; original_payment_id?: string; amount?: number }> {
  const { data, error } = await supabase.rpc('reverse_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
    p_actor_id: actorId ?? null,
  });
  if (error) throw error;
  return data as any;
}
