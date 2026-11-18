import { freezeMembership, resumeMembershipFreeze } from './membershipActionsService';
import { supabase } from '@/integrations/supabase/client';
import { getISTToday, getISTNow } from '@/lib/utils/datetime';
import type { 
  Membership, 
  MembershipWithPlan, 
  DaysRemaining, 
  PurchaseRequest,
  FreezeRequest 
} from '@/types/membership';
import { differenceInDays, addDays, parseISO, format, isAfter, isBefore } from 'date-fns';

// ── Hardware Access Revocation / Restoration ──
export async function revokeHardwareAccess(memberId: string, reason: string, branchId?: string) {
  try {
    const { data, error } = await supabase.functions.invoke('mips-access', {
      body: { action: 'revoke', member_id: memberId, reason, branch_id: branchId },
    });
    if (error) console.error('Hardware revoke error:', error);
    return data;
  } catch (e) {
    console.error('Hardware revoke failed:', e);
  }
}

export async function restoreHardwareAccess(memberId: string, reason: string, branchId?: string) {
  try {
    const { data, error } = await supabase.functions.invoke('mips-access', {
      body: { action: 'restore', member_id: memberId, reason, branch_id: branchId },
    });
    if (error) console.error('Hardware restore error:', error);
    return data;
  } catch (e) {
    console.error('Hardware restore failed:', e);
  }
}

export async function fetchMembership(membershipId: string) {
  const { data, error } = await supabase
    .from('memberships')
    .select('*, membership_plans(*)')
    .eq('id', membershipId)
    .single();

  if (error) throw error;
  return data as MembershipWithPlan;
}

export async function fetchMemberMemberships(memberId: string) {
  const { data, error } = await supabase
    .from('memberships')
    .select('*, membership_plans(*)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as MembershipWithPlan[];
}

export async function fetchActiveMembership(memberId: string) {
  const { data, error } = await supabase
    .from('memberships')
    .select('*, membership_plans(*)')
    .eq('member_id', memberId)
    .eq('status', 'active')
    .gte('end_date', getISTToday())
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as MembershipWithPlan | null;
}

export function calculateDaysRemaining(membership: Membership): DaysRemaining {
  const today = getISTNow();
  const endDate = parseISO(membership.end_date);
  const startDate = parseISO(membership.start_date);
  
  const totalDays = differenceInDays(endDate, startDate);
  const daysUsed = differenceInDays(today, startDate);
  const frozenDays = membership.total_freeze_days_used || 0;
  const activeDaysRemaining = Math.max(0, differenceInDays(endDate, today));
  
  const isExpired = isAfter(today, endDate);
  const isFrozen = membership.status === 'frozen';

  return {
    total: totalDays,
    frozen: frozenDays,
    active: activeDaysRemaining,
    isExpired,
    isFrozen,
  };
}

/**
 * Purchase a membership atomically via the `purchase_member_membership` RPC.
 * This is the single source of truth — no client-side multi-step writes.
 * Membership + invoice + items + (optional) initial payment + reminders + locker
 * are all committed in one transaction with idempotency-key dedup.
 */
export async function purchaseMembership(request: PurchaseRequest) {
  const { memberId, planId, branchId, startDate, discountAmount, discountReason } = request;

  const idempotencyKey = `purchase:${memberId}:${planId}:${startDate}:${discountAmount ?? 0}`;

  const { data, error } = await supabase.rpc('purchase_member_membership', {
    p_member_id: memberId,
    p_plan_id: planId,
    p_branch_id: branchId,
    p_start_date: startDate,
    p_discount_amount: discountAmount ?? 0,
    p_discount_reason: discountReason ?? null,
    p_include_gst: false,
    p_gst_rate: 0,
    p_payment_method: 'cash',
    p_amount_paying: 0,
    p_payment_due_date: null,
    p_send_reminders: true,
    p_payment_source: 'manual',
    p_idempotency_key: idempotencyKey,
    p_assign_locker_id: null,
    p_notes: null,
  });

  if (error) throw error;
  const result = data as { success: boolean; error?: string; membership_id?: string; invoice_id?: string };
  if (result?.success === false) throw new Error(result.error || 'Purchase failed');

  return {
    membership: { id: result.membership_id },
    invoice: { id: result.invoice_id },
  };
}

export async function activateMembership(membershipId: string) {
  const { data, error } = await supabase
    .from('memberships')
    .update({ status: 'active' })
    .eq('id', membershipId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function requestFreeze(request: FreezeRequest) {
  const { membershipId, startDate, endDate, reason, isPaid } = request;
  const days = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
  return freezeMembership({ membershipId, startDate, freezeDays: days, reason: reason || '', mode: isPaid ? 'paid' : 'plan' });
}

export async function approveFreeze(freezeId: string, _approvedBy: string) {
  const { data: request, error } = await supabase.from('approval_requests').select('id').eq('reference_id', freezeId).eq('status', 'pending').single();
  if (error) throw error;
  const { data, error: approvalError } = await supabase.rpc('process_approval_request', { p_request_id: request.id, p_decision: 'approve', p_review_notes: null });
  if (approvalError) throw approvalError;
  const result = data as { success?: boolean; error?: string };
  if (!result?.success) throw new Error(result?.error || 'Freeze approval failed');
  return result;
}

export async function resumeFromFreeze(membershipId: string) {
  return resumeMembershipFreeze(membershipId);
}

export async function addFreeDays(membershipId: string, days: number, reason: string, addedBy: string) {
  // Add free days record (no longer blocked by discounts — hospitality comp engine)
  const { data: freeDay, error: freeDayError } = await supabase
    .from('membership_free_days')
    .insert({
      membership_id: membershipId,
      days_added: days,
      reason,
      added_by: addedBy,
    })
    .select()
    .single();

  if (freeDayError) throw freeDayError;

  // Update membership end date
  const { data: currentMembership } = await supabase
    .from('memberships')
    .select('end_date')
    .eq('id', membershipId)
    .single();

  if (currentMembership) {
    const currentEnd = parseISO(currentMembership.end_date);
    const newEnd = format(addDays(currentEnd, days), 'yyyy-MM-dd');
    
    await supabase
      .from('memberships')
      .update({ end_date: newEnd })
      .eq('id', membershipId);
  }

  return freeDay;
}