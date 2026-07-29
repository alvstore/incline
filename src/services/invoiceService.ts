import { supabase } from '@/integrations/supabase/client';

export interface CancelInvoiceResult {
  success: boolean;
  invoice_id: string;
  voided_payments?: number;
  cancelled_packages?: number;
  reversed_commissions?: number;
  already?: string;
  idempotent?: boolean;
  error?: string;
}

/**
 * Atomic invoice cancellation. Voids linked payments, cancels linked PT packages,
 * reverses trainer commissions, and marks the invoice as `cancelled`.
 */
export async function cancelInvoice(
  invoiceId: string,
  reason: string,
): Promise<CancelInvoiceResult> {
  const { data, error } = await supabase.rpc('cancel_invoice' as any, {
    _invoice_id: invoiceId,
    _reason: reason,
  });
  if (error) throw error;
  return data as unknown as CancelInvoiceResult;
}
