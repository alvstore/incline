/**
 * P4 — Atomic membership lifecycle actions.
 *
 * All cancel / freeze flows go through these RPCs — never multi-step
 * client writes. Mirrors the `purchase_membership` pattern from P3.
 */
import { supabase } from '@/integrations/supabase/client';

export interface CancelMembershipInput {
  membershipId: string;
  reason: string;
  refundAmount?: number;
  refundMethod?: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'wallet';
  idempotencyKey?: string;
}

export interface CancelMembershipResult {
  membership_id: string;
  refund_invoice_id: string | null;
  refund_payment_id: string | null;
  refund_amount: number;
}

export async function cancelMembership(
  input: CancelMembershipInput,
): Promise<CancelMembershipResult> {
  const { data, error } = await supabase.rpc('cancel_membership', {
    p_membership_id: input.membershipId,
    p_reason: input.reason,
    p_refund_amount: input.refundAmount ?? 0,
    p_refund_method: input.refundMethod ?? 'cash',
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw error;
  return data as unknown as CancelMembershipResult;
}

export interface FreezeMembershipInput {
  membershipId: string;
  freezeDays: number;
  reason: string;
}

export async function freezeMembership(input: FreezeMembershipInput) {
  const { data, error } = await supabase.rpc('freeze_membership', {
    p_membership_id: input.membershipId,
    p_freeze_days: input.freezeDays,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data;
}

/**
 * Set the user's active branch on the server. Pass `null` to clear (owners only).
 * Validates membership in branch + writes to `user_active_branch`.
 */
export async function setActiveBranch(branchId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_active_branch', { p_branch_id: branchId });
  if (error) throw error;
}

export interface UpgradeMembershipInput {
  membershipId: string;
  newPlanId: string;
  reason?: string;
  paymentMethod?: string;
  amountPaying?: number;
  includeGst?: boolean;
  gstRate?: number;
  idempotencyKey?: string;
  discountAmount?: number;
  discountReason?: string;
  sendReminders?: boolean;
  assignLockerId?: string | null;
}

export interface UpgradeMembershipResult {
  membership_id: string;
  invoice_id: string;
  invoice_number: string;
  credit_applied: number;
  new_total: number;
  balance_due: number;
  new_end_date: string;
}

/**
 * Mid-term upgrade: credits everything already paid on the running plan,
 * amends the same invoice in place and extends the term from the original
 * joining date. Server-side atomic RPC — never replicate this client-side.
 */
export async function upgradeMembership(
  input: UpgradeMembershipInput,
): Promise<UpgradeMembershipResult> {
  const { data, error } = await supabase.rpc('upgrade_membership' as any, {
    p_membership_id: input.membershipId,
    p_new_plan_id: input.newPlanId,
    p_reason: input.reason ?? null,
    p_payment_method: input.paymentMethod ?? 'cash',
    p_amount_paying: input.amountPaying ?? 0,
    p_include_gst: input.includeGst ?? false,
    p_gst_rate: input.gstRate ?? 0,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_discount_amount: input.discountAmount ?? 0,
    p_discount_reason: input.discountReason ?? null,
    p_send_reminders: input.sendReminders ?? true,
    p_assign_locker_id: input.assignLockerId ?? null,
  });
  if (error) throw error;
  return data as unknown as UpgradeMembershipResult;
}
