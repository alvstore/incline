import { supabase } from '@/integrations/supabase/client';
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
    .gte('end_date', format(new Date(), 'yyyy-MM-dd'))
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as MembershipWithPlan | null;
}

export function calculateDaysRemaining(membership: Membership): DaysRemaining {
  const today = new Date();
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

  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const daysFrozen = differenceInDays(end, start) + 1;

  // Get branch settings for freeze fee
  const { data: membership } = await supabase
    .from('memberships')
    .select('branch_id')
    .eq('id', membershipId)
    .single();

  let feeCharged = 0;
  if (isPaid && membership) {
    const { data: settings } = await supabase
      .from('branch_settings')
      .select('freeze_fee')
      .eq('branch_id', membership.branch_id)
      .single();
    
    feeCharged = settings?.freeze_fee || 0;
  }

  const { data, error } = await supabase
    .from('membership_freeze_history')
    .insert({
      membership_id: membershipId,
      start_date: startDate,
      end_date: endDate,
      days_frozen: daysFrozen,
      reason,
      fee_charged: feeCharged,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;

  // Create approval request
  if (membership?.branch_id) {
    const { error: approvalError } = await supabase
      .from('approval_requests')
      .insert({
        branch_id: membership.branch_id,
        approval_type: 'membership_freeze' as const,
        reference_type: 'membership_freeze',
        reference_id: data.id,
        request_data: { membershipId, startDate, endDate, daysFrozen, reason, feeCharged },
      });

    if (approvalError) throw approvalError;
  }

  return data;
}

export async function approveFreeze(freezeId: string, approvedBy: string) {
  // Get freeze details
  const { data: freeze, error: freezeError } = await supabase
    .from('membership_freeze_history')
    .select('*, memberships(*)')
    .eq('id', freezeId)
    .single();

  if (freezeError) throw freezeError;

  // Update freeze status
  const { error: updateError } = await supabase
    .from('membership_freeze_history')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', freezeId);

  if (updateError) throw updateError;

  // Update membership status to frozen if freeze starts today or earlier
  const today = new Date();
  const freezeStart = parseISO(freeze.start_date);
  
  if (!isAfter(freezeStart, today)) {
    await supabase
      .from('memberships')
      .update({ status: 'frozen' })
      .eq('id', freeze.membership_id);

    // Revoke hardware access when freeze activates
    if (freeze.memberships?.member_id) {
      revokeHardwareAccess(freeze.memberships.member_id, `Membership frozen: ${freeze.reason || 'Freeze approved'}`, freeze.memberships?.branch_id);
    }
  }

  return freeze;
}

export async function resumeFromFreeze(membershipId: string) {
  // Get the membership and its freeze history
  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('*, membership_freeze_history(*)')
    .eq('id', membershipId)
    .single();

  if (membershipError) throw membershipError;

  // Calculate new end date based on frozen days
  const approvedFreezes = membership.membership_freeze_history?.filter(
    (f: any) => f.status === 'approved'
  ) || [];
  
  const totalFrozenDays = approvedFreezes.reduce(
    (sum: number, f: any) => sum + f.days_frozen,
    0
  );

  const originalEnd = parseISO(membership.original_end_date);
  const newEndDate = format(addDays(originalEnd, totalFrozenDays), 'yyyy-MM-dd');

  // Update membership
  const { data, error } = await supabase
    .from('memberships')
    .update({
      status: 'active',
      end_date: newEndDate,
      total_freeze_days_used: totalFrozenDays,
    })
    .eq('id', membershipId)
    .select('*, members:member_id(id, branch_id)')
    .single();

  if (error) throw error;

  // Restore hardware access
  if ((data as any)?.members?.id) {
    restoreHardwareAccess((data as any).members.id, 'Membership unfrozen', (data as any).members.branch_id);
  }

  return data;
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