import { supabase } from '@/integrations/supabase/client';
import type { InvoiceStatus, PaymentMethod } from '@/types/membership';
import { normalizePaymentMethod } from '@/lib/payments/normalizePaymentMethod';

export async function fetchInvoice(invoiceId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      invoice_items(*)
    `)
    .eq('id', invoiceId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchMemberInvoices(memberId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function fetchBranchInvoices(branchId: string, status?: InvoiceStatus) {
  let query = supabase
    .from('invoices')
    .select(`
      *,
      invoice_items(*)
    `)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Create a manual invoice (with line items) atomically via the
 * `create_manual_invoice` RPC. No client-side multi-step writes.
 */
export async function createManualInvoice(invoice: {
  branchId: string;
  memberId?: string;
  items: { description: string; quantity: number; unitPrice: number; referenceType?: string; referenceId?: string }[];
  notes?: string;
  dueDate?: string;
  discountAmount?: number;
  includeGst?: boolean;
  gstRate?: number;
  customerGstin?: string;
}) {
  const { data, error } = await supabase.rpc('create_manual_invoice', {
    p_branch_id: invoice.branchId,
    p_member_id: invoice.memberId ?? null,
    p_items: invoice.items.map(i => ({
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      reference_type: i.referenceType ?? null,
      reference_id: i.referenceId ?? null,
    })) as never,
    p_due_date: invoice.dueDate ?? null,
    p_notes: invoice.notes ?? null,
    p_discount_amount: invoice.discountAmount ?? 0,
    p_include_gst: invoice.includeGst ?? false,
    p_gst_rate: invoice.gstRate ?? 0,
    p_customer_gstin: invoice.customerGstin ?? null,
  });

  if (error) throw error;
  const result = data as { success: boolean; error?: string; invoice_id?: string };
  if (!result?.success) throw new Error(result?.error || 'Invoice creation failed');

  return fetchInvoice(result.invoice_id!);
}

export async function updateInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
  const { data, error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', invoiceId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Unified payment recording via database RPC.
 * This is the SINGLE source of truth for all payment recording.
 * Atomically: inserts payment, updates invoice balance/status,
 * handles wallet debits, and activates memberships when fully paid.
 */
export async function recordPayment(payment: {
  branchId: string;
  invoiceId: string;
  memberId?: string;
  amount: number;
  paymentMethod: PaymentMethod | string;
  transactionId?: string;
  notes?: string;
  receivedBy?: string;
  incomeCategoryId?: string;
}): Promise<{ success: boolean; payment_id?: string; new_amount_paid?: number; new_status?: string; error?: string }> {
  const { data, error } = await supabase.rpc('record_payment', {
    p_branch_id: payment.branchId,
    p_invoice_id: payment.invoiceId,
    p_member_id: payment.memberId || null,
    p_amount: payment.amount,
    p_payment_method: normalizePaymentMethod(payment.paymentMethod),
    p_transaction_id: payment.transactionId || null,
    p_notes: payment.notes || null,
    p_received_by: payment.receivedBy || null,
    p_income_category_id: payment.incomeCategoryId || null,
  });

  if (error) throw error;

  const result = data as any;
  if (!result?.success) {
    throw new Error(result?.error || 'Payment recording failed');
  }

  // Fire-and-forget: when the payment closes the invoice, auto-send the branded
  // PDF receipt to the member over WhatsApp + Email via the dispatcher. Never
  // blocks the caller and never throws — dispatcher owns retry + preferences.
  if (result?.new_status === 'paid') {
    import('@/lib/invoices/sendInvoicePdf')
      .then((m) => m.sendInvoicePdfToMember(payment.invoiceId, { paidOnly: true }))
      .catch((e) => console.warn('[recordPayment] auto-send receipt failed', e));
  }

  return result;
}

/**
 * Void a payment via database RPC.
 * Atomically: marks payment as voided, reverses invoice balance,
 * recalculates status, and refunds wallet if applicable.
 */
export async function voidPayment(paymentId: string, reason: string = 'Voided by admin'): Promise<{ success: boolean; voided_amount?: number; invoice_new_status?: string; error?: string }> {
  const { data, error } = await supabase.rpc('void_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });

  if (error) throw error;

  const result = data as any;
  if (!result?.success) {
    throw new Error(result?.error || 'Void payment failed');
  }

  return result;
}

export async function fetchPayments(branchId: string, filters?: { memberId?: string; startDate?: string; endDate?: string }) {
  let query = supabase
    .from('payments')
    .select('*')
    .eq('branch_id', branchId)
    .order('payment_date', { ascending: false });

  if (filters?.memberId) {
    query = query.eq('member_id', filters.memberId);
  }

  if (filters?.startDate) {
    query = query.gte('payment_date', filters.startDate);
  }

  if (filters?.endDate) {
    query = query.lte('payment_date', filters.endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
