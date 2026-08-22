import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PtPaymentState =
  | 'paid'
  | 'partial'
  | 'overdue'
  | 'pending'
  | 'cancelled'
  | 'refunded'
  | 'unknown'
  | string;

export interface TrainerPtBillingRow {
  package_row_id: string;
  member_id: string;
  member_code: string | null;
  member_name: string | null;
  package_name: string | null;
  package_type: string | null;
  sold_on: string | null;
  price_paid: number;
  amount_paid: number;
  balance_due: number;
  payment_due_date: string | null;
  invoice_number: string | null;
  payment_state: PtPaymentState;
}

/**
 * Billing summary for the PT packages sold by the signed-in trainer.
 * Backed by the security-definer RPC `get_trainer_pt_billing` — trainers have
 * no direct read access to invoices/payments, and the RPC returns money
 * figures only (no customer PII beyond the client they already coach).
 */
export function useTrainerBilling(trainerId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['trainer-pt-billing', trainerId ?? 'self'],
    enabled,
    queryFn: async (): Promise<TrainerPtBillingRow[]> => {
      const { data, error } = await supabase.rpc('get_trainer_pt_billing' as never, {
        _trainer_id: trainerId ?? null,
      } as never);
      if (error) throw error;
      return ((data ?? []) as unknown as TrainerPtBillingRow[]).map((r) => ({
        ...r,
        price_paid: Number(r.price_paid || 0),
        amount_paid: Number(r.amount_paid || 0),
        balance_due: Number(r.balance_due || 0),
      }));
    },
  });
}

export function paymentStateMeta(state: PtPaymentState) {
  switch (state) {
    case 'paid':
      return { label: 'Paid', className: 'bg-emerald-100 text-emerald-700' };
    case 'partial':
      return { label: 'Partial', className: 'bg-amber-100 text-amber-700' };
    case 'overdue':
      return { label: 'Overdue', className: 'bg-red-100 text-red-700' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-slate-200 text-slate-600' };
    case 'refunded':
      return { label: 'Refunded', className: 'bg-slate-200 text-slate-600' };
    case 'pending':
      return { label: 'Payment pending', className: 'bg-slate-100 text-slate-600' };
    default:
      return { label: 'No invoice', className: 'bg-slate-100 text-slate-600' };
  }
}

export const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
