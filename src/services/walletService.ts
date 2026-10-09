import { supabase } from '@/integrations/supabase/client';
import type { Wallet, WalletTransaction, WalletTxnType } from '@/types/membership';
import { recordPayment } from '@/services/billingService';

export async function fetchWallet(memberId: string) {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle();

  if (error) throw error;
  return data as Wallet | null;
}

export async function createWallet(memberId: string) {
  const { data, error } = await supabase
    .from('wallets')
    .insert({
      member_id: memberId,
      balance: 0,
      total_credited: 0,
      total_debited: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Wallet;
}

export async function getOrCreateWallet(memberId: string) {
  const wallet = await fetchWallet(memberId);
  if (wallet) return wallet;
  return createWallet(memberId);
}

export async function fetchWalletTransactions(walletId: string, limit = 50) {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data as WalletTransaction[];
}

export async function creditWallet(
  memberId: string,
  amount: number,
  description: string,
  referenceType?: string,
  referenceId?: string,
  _createdBy?: string
) {
  // Server-checked: only owners/admins or a manager of the member's branch may add funds.
  const { data, error } = await supabase.rpc('wallet_adjust', {
    p_member_id: memberId,
    p_amount: Number(amount) || 0,
    p_direction: 'credit',
    p_description: description,
    p_reference_type: referenceType ?? null,
    p_reference_id: referenceId ?? null,
  });
  if (error) throw error;
  return data as unknown as Wallet;
}

/**
 * Direct wallet debit (for non-invoice use cases like reward redemption).
 * For invoice payments, use payWithWallet() instead which goes through the unified RPC.
 */
export async function debitWallet(
  memberId: string,
  amount: number,
  description: string,
  referenceType?: string,
  referenceId?: string,
  _createdBy?: string
) {
  const { data, error } = await supabase.rpc('wallet_adjust', {
    p_member_id: memberId,
    p_amount: Number(amount) || 0,
    p_direction: 'debit',
    p_description: description,
    p_reference_type: referenceType ?? null,
    p_reference_id: referenceId ?? null,
  });
  if (error) throw error;
  return data as unknown as Wallet;
}

/**
 * Pay an invoice using wallet balance.
 * Delegates to the unified record_payment RPC which handles
 * wallet validation, debit, payment recording, and invoice update atomically.
 */
export async function payWithWallet(
  memberId: string,
  invoiceId: string,
  amount: number,
  branchId: string,
  createdBy?: string
) {
  // Get invoice branch_id if not provided
  let effectiveBranchId = branchId;
  if (!effectiveBranchId) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('branch_id')
      .eq('id', invoiceId)
      .single();
    if (!invoice) throw new Error('Invoice not found');
    effectiveBranchId = invoice.branch_id;
  }

  return recordPayment({
    branchId: effectiveBranchId,
    invoiceId,
    memberId,
    amount,
    paymentMethod: 'wallet',
    receivedBy: createdBy,
  });
}
