import { supabase } from '@/integrations/supabase/client';
import type { PaymentMethodEnum } from '@/lib/payments/normalizePaymentMethod';

export type ExpenseKind = 'general' | 'vendor_bill' | 'salary_advance';

export interface ExpenseRow {
  id: string;
  branch_id: string;
  category_id: string | null;
  amount: number;
  description: string;
  vendor: string | null;
  expense_date: string;
  receipt_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submitted_by: string | null;
  approved_by: string | null;
  expense_type: ExpenseKind;
  payment_method: PaymentMethodEnum | null;
  payment_reference: string | null;
  paid_at: string | null;
  paid_by: string | null;
  bill_number: string | null;
  is_paid: boolean;
  employee_user_id: string | null;
  edit_reason: string | null;
  category?: { name: string } | null;
}

export interface SalaryAdvanceRow {
  id: string;
  branch_id: string;
  user_id: string;
  expense_id: string | null;
  amount: number;
  outstanding: number;
  paid_on: string;
  payment_method: PaymentMethodEnum | null;
  payment_reference: string | null;
  reason: string | null;
  auto_recover: boolean;
  status: 'outstanding' | 'recovered' | string;
  created_at: string;
}

export interface RecordExpenseInput {
  branchId: string;
  amount: number;
  description: string;
  expenseType?: ExpenseKind;
  categoryId?: string | null;
  vendor?: string | null;
  expenseDate?: string;
  receiptUrl?: string | null;
  paymentMethod?: PaymentMethodEnum | null;
  paymentReference?: string | null;
  paidAt?: string | null;
  billNumber?: string | null;
  isPaid?: boolean;
  employeeUserId?: string | null;
  autoRecover?: boolean;
}

export async function recordExpense(input: RecordExpenseInput) {
  const { data, error } = await supabase.rpc('record_expense' as never, {
    p_branch_id: input.branchId,
    p_amount: input.amount,
    p_description: input.description,
    p_expense_type: input.expenseType ?? 'general',
    p_category_id: input.categoryId || null,
    p_vendor: input.vendor || null,
    p_expense_date: input.expenseDate || null,
    p_receipt_url: input.receiptUrl || null,
    p_payment_method: input.paymentMethod || null,
    p_payment_reference: input.paymentReference || null,
    p_paid_at: input.paidAt || null,
    p_bill_number: input.billNumber || null,
    p_is_paid: input.isPaid ?? true,
    p_employee_user_id: input.employeeUserId || null,
    p_auto_recover: input.autoRecover ?? true,
  } as never);
  if (error) throw error;
  const res = data as { success: boolean; error?: string; expense_id?: string };
  if (!res?.success) throw new Error(res?.error || 'Failed to record expense');
  return res;
}

export interface EditExpenseInput {
  expenseId: string;
  reason: string;
  amount?: number;
  description?: string;
  categoryId?: string | null;
  vendor?: string | null;
  expenseDate?: string | null;
  paymentMethod?: PaymentMethodEnum | null;
  paymentReference?: string | null;
  paidAt?: string | null;
  billNumber?: string | null;
  isPaid?: boolean;
  receiptUrl?: string | null;
}

export async function editExpense(input: EditExpenseInput) {
  const { data, error } = await supabase.rpc('edit_expense' as never, {
    p_expense_id: input.expenseId,
    p_reason: input.reason,
    p_amount: input.amount ?? null,
    p_description: input.description ?? null,
    p_category_id: input.categoryId ?? null,
    p_vendor: input.vendor ?? null,
    p_expense_date: input.expenseDate ?? null,
    p_payment_method: input.paymentMethod ?? null,
    p_payment_reference: input.paymentReference ?? null,
    p_paid_at: input.paidAt ?? null,
    p_bill_number: input.billNumber ?? null,
    p_is_paid: input.isPaid ?? null,
    p_receipt_url: input.receiptUrl ?? null,
  } as never);
  if (error) throw error;
  const res = data as { success: boolean; error?: string };
  if (!res?.success) throw new Error(res?.error || 'Failed to edit expense');
  return res;
}

export async function pendingAdvanceForUser(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('pending_advance_for_user' as never, {
    _user_id: userId,
  } as never);
  if (error) throw error;
  return Number(data ?? 0);
}

export async function applyAdvanceRecovery(userId: string, amount: number) {
  const { data, error } = await supabase.rpc('apply_advance_recovery' as never, {
    _user_id: userId,
    _amount: amount,
  } as never);
  if (error) throw error;
  return data as { success: boolean; applied?: number; error?: string };
}

export const EXPENSE_METHODS: { value: PaymentMethodEnum; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const EXPENSE_TYPE_LABEL: Record<ExpenseKind, string> = {
  general: 'General',
  vendor_bill: 'Vendor Bill',
  salary_advance: 'Salary Advance',
};
