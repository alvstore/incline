import { supabase } from "@/integrations/supabase/client";
import { getISTNow } from "@/lib/utils/datetime";
import { Database } from "@/integrations/supabase/types";
import { safeBenefitEnum } from "@/lib/benefitEnums";

type BenefitType = Database["public"]["Enums"]["benefit_type"];
type BenefitBookingStatus = Database["public"]["Enums"]["benefit_booking_status"];
type NoShowPolicy = Database["public"]["Enums"]["no_show_policy"];

export interface BenefitSettings {
  id: string;
  branch_id: string;
  benefit_type: BenefitType;
  benefit_type_id?: string | null;
  is_slot_booking_enabled: boolean;
  slot_duration_minutes: number;
  booking_opens_hours_before: number;
  cancellation_deadline_minutes: number;
  no_show_policy: NoShowPolicy;
  no_show_penalty_amount: number;
  max_bookings_per_day: number;
  buffer_between_sessions_minutes: number;
  operating_hours_start: string;
  operating_hours_end: string;
  capacity_per_slot: number;
}

export interface BenefitSlot {
  id: string;
  branch_id: string;
  benefit_type: BenefitType;
  slot_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked_count: number;
  is_active: boolean;
}

export interface BenefitBooking {
  id: string;
  slot_id: string;
  member_id: string;
  membership_id: string;
  status: BenefitBookingStatus;
  booked_at: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  check_in_at?: string;
  no_show_marked_at?: string;
  notes?: string;
  slot?: BenefitSlot;
}

export interface BenefitPackage {
  id: string;
  branch_id: string;
  name: string;
  description?: string;
  benefit_type: BenefitType;
  quantity: number;
  price: number;
  validity_days: number;
  is_active: boolean;
  display_order: number;
}

export interface MemberBenefitCredits {
  id: string;
  member_id: string;
  membership_id?: string;
  benefit_type: BenefitType;
  package_id?: string;
  credits_total: number;
  credits_remaining: number;
  purchased_at: string;
  expires_at: string;
}

// ========== SETTINGS ==========

export async function getBenefitSettings(branchId: string): Promise<BenefitSettings[]> {
  const { data, error } = await supabase
    .from("benefit_settings")
    .select("*")
    .eq("branch_id", branchId);
  
  if (error) throw error;
  return data || [];
}

export async function upsertBenefitSetting(setting: Partial<BenefitSettings> & { branch_id: string; benefit_type: BenefitType; benefit_type_id?: string }): Promise<BenefitSettings> {
  // If benefit_type_id is provided, try to upsert using it (for custom types)
  if (setting.benefit_type_id) {
    // Check if a record already exists for this branch + benefit_type_id
    const { data: existing } = await supabase
      .from("benefit_settings")
      .select("id")
      .eq("branch_id", setting.branch_id)
      .eq("benefit_type_id", setting.benefit_type_id)
      .maybeSingle();

    if (existing) {
      // Update existing record
      const { id: _id, ...updateData } = setting;
      const { data, error } = await supabase
        .from("benefit_settings")
        .update(updateData)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      // Insert new record with 'other' as fallback enum value for custom types
      const insertData = { ...setting, benefit_type: safeBenefitEnum(setting.benefit_type) as BenefitType };
      const { data, error } = await supabase
        .from("benefit_settings")
        .insert(insertData)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  // Fallback for standard enum types: check-then-update/insert
  const { data: existing } = await supabase
    .from("benefit_settings")
    .select("id")
    .eq("branch_id", setting.branch_id)
    .eq("benefit_type", setting.benefit_type)
    .is("benefit_type_id", null)
    .maybeSingle();

  if (existing) {
    const { id: _id, ...updateData } = setting;
    const { data, error } = await supabase
      .from("benefit_settings")
      .update(updateData)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from("benefit_settings")
      .insert(setting)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

// ========== SLOTS ==========

export async function getAvailableSlots(
  branchId: string,
  benefitType: BenefitType,
  date: string,
  benefitTypeId?: string
): Promise<BenefitSlot[]> {
  let query = supabase
    .from("benefit_slots")
    .select("*")
    .eq("branch_id", branchId)
    .eq("slot_date", date)
    .eq("is_active", true)
    .order("start_time", { ascending: true });
  
  // Filter by benefit_type_id if provided (for custom types), otherwise by enum
  if (benefitTypeId) {
    query = query.eq("benefit_type_id", benefitTypeId);
  } else {
    query = query.eq("benefit_type", benefitType);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function generateDailySlots(
  branchId: string,
  benefitType: BenefitType,
  date: string,
  settings: BenefitSettings,
  benefitTypeId?: string,
  facilityId?: string
): Promise<BenefitSlot[]> {
  const slots: any[] = [];
  const safeBt = safeBenefitEnum(benefitType) as BenefitType;
  
  const startTime = new Date(`2000-01-01T${settings.operating_hours_start}`);
  const endTime = new Date(`2000-01-01T${settings.operating_hours_end}`);
  const durationMs = settings.slot_duration_minutes * 60 * 1000;
  const bufferMs = settings.buffer_between_sessions_minutes * 60 * 1000;
  
  let currentTime = startTime;
  while (currentTime.getTime() + durationMs <= endTime.getTime()) {
    const slotEnd = new Date(currentTime.getTime() + durationMs);
    
    const slot: any = {
      branch_id: branchId,
      benefit_type: safeBt,
      slot_date: date,
      start_time: currentTime.toTimeString().slice(0, 8),
      end_time: slotEnd.toTimeString().slice(0, 8),
      capacity: settings.capacity_per_slot,
    };
    if (benefitTypeId) {
      slot.benefit_type_id = benefitTypeId;
    }
    if (facilityId) {
      slot.facility_id = facilityId;
    }
    slots.push(slot);
    
    currentTime = new Date(slotEnd.getTime() + bufferMs);
  }
  
  if (slots.length === 0) return [];

  const { data, error } = await supabase
    .from("benefit_slots")
    .insert(slots)
    .select();
  
  if (error) throw error;
  return data || [];
}

// ========== AUTO-GENERATION ==========

export async function ensureSlotsForDateRange(
  branchId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  // Use server-side SECURITY DEFINER function to generate slots
  // This bypasses RLS so members can trigger slot creation
  const { error } = await supabase.rpc('ensure_facility_slots', {
    p_branch_id: branchId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    console.error('Failed to ensure facility slots via RPC:', error);
    // Don't throw - slot generation is best-effort
  }
}

export async function createSlot(slot: Omit<BenefitSlot, "id" | "booked_count" | "is_active"> & { benefit_type_id?: string }): Promise<BenefitSlot> {
  const safeSlot = {
    ...slot,
    benefit_type: safeBenefitEnum(slot.benefit_type) as BenefitType,
  };
  const { data, error } = await supabase
    .from("benefit_slots")
    .insert(safeSlot)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateSlot(id: string, updates: Partial<BenefitSlot>): Promise<BenefitSlot> {
  const { data, error } = await supabase
    .from("benefit_slots")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ========== BOOKINGS ==========

export async function getSlotBookings(slotId: string): Promise<BenefitBooking[]> {
  const { data, error } = await supabase
    .from("benefit_bookings")
    .select("*, slot:benefit_slots(*)")
    .eq("slot_id", slotId)
    .in("status", ["booked", "confirmed"]);
  
  if (error) throw error;
  return data || [];
}

export async function getMemberBookings(
  memberId: string,
  status?: BenefitBookingStatus[]
): Promise<BenefitBooking[]> {
  let query = supabase
    .from("benefit_bookings")
    .select("*, slot:benefit_slots(*)")
    .eq("member_id", memberId)
    .order("booked_at", { ascending: false });
  
  if (status && status.length > 0) {
    query = query.in("status", status);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function bookSlot(
  slotId: string,
  memberId: string,
  membershipId: string,
  notes?: string
): Promise<BenefitBooking> {
  // Check slot availability
  const { data: slot, error: slotError } = await supabase
    .from("benefit_slots")
    .select("*")
    .eq("id", slotId)
    .single();
  
  if (slotError) throw slotError;
  if (!slot) throw new Error("Slot not found");
  if (slot.booked_count >= slot.capacity) throw new Error("Slot is fully booked");
  
  const { data, error } = await supabase
    .from("benefit_bookings")
    .insert({
      slot_id: slotId,
      member_id: memberId,
      membership_id: membershipId,
      status: "booked" as BenefitBookingStatus,
      notes,
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function cancelBooking(
  bookingId: string,
  reason?: string
): Promise<BenefitBooking> {
  const { data, error } = await supabase
    .from("benefit_bookings")
    .update({
      status: "cancelled" as BenefitBookingStatus,
      cancelled_at: getISTNow().toISOString(),
      cancellation_reason: reason,
    })
    .eq("id", bookingId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function markAttendance(
  bookingId: string,
  attended: boolean
): Promise<BenefitBooking> {
  const updates = attended
    ? {
        status: "attended" as BenefitBookingStatus,
        check_in_at: getISTNow().toISOString(),
      }
    : {
        status: "no_show" as BenefitBookingStatus,
        no_show_marked_at: getISTNow().toISOString(),
      };
  
  const { data, error } = await supabase
    .from("benefit_bookings")
    .update(updates)
    .eq("id", bookingId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ========== PACKAGES (UPSELL) ==========

export async function getBenefitPackages(
  branchId: string,
  benefitType?: BenefitType
): Promise<BenefitPackage[]> {
  let query = supabase
    .from("benefit_packages")
    .select("*")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  
  if (benefitType) {
    query = query.eq("benefit_type", benefitType);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createBenefitPackage(
  pkg: Omit<BenefitPackage, "id" | "is_active" | "display_order">
): Promise<BenefitPackage> {
  const { data, error } = await supabase
    .from("benefit_packages")
    .insert(pkg)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateBenefitPackage(
  id: string,
  updates: Partial<BenefitPackage>
): Promise<BenefitPackage> {
  const { data, error } = await supabase
    .from("benefit_packages")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ========== MEMBER CREDITS ==========

export async function getMemberCredits(
  memberId: string,
  benefitType?: BenefitType
): Promise<MemberBenefitCredits[]> {
  let query = supabase
    .from("member_benefit_credits")
    .select("*")
    .eq("member_id", memberId)
    .gt("expires_at", getISTNow().toISOString())
    .gt("credits_remaining", 0);
  
  if (benefitType) {
    query = query.eq("benefit_type", benefitType);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function purchaseBenefitCredits(
  memberId: string,
  membershipId: string | null,
  packageId: string,
  invoiceId?: string,
  branchId?: string,
  options?: { paymentMethod?: string; idempotencyKey?: string }
): Promise<MemberBenefitCredits> {
  // Routed through the unified payment authority via purchase_benefit_credits RPC
  // (creates invoice + settles payment + inserts credits atomically).
  // Idempotency key MUST be stable across retries — callers should pass one
  // derived from a durable purchase intent (member + package + draftId).
  const idempotencyKey =
    options?.idempotencyKey ?? `benefit-addon:${memberId}:${packageId}`;
  const { data, error } = await supabase.rpc('purchase_benefit_credits', {
    p_member_id: memberId,
    p_membership_id: membershipId,
    p_package_id: packageId,
    p_branch_id: branchId ?? null,
    p_payment_method: options?.paymentMethod ?? 'cash',
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const result = data as { success: boolean; error?: string; credit_id?: string };
  if (!result?.success || !result.credit_id) {
    throw new Error(result?.error || 'Failed to purchase benefit credits');
  }

  // Hydrate the freshly created credit row for the caller.
  const { data: credit, error: fetchError } = await supabase
    .from('member_benefit_credits')
    .select('*')
    .eq('id', result.credit_id)
    .single();
  if (fetchError) throw fetchError;
  return credit as MemberBenefitCredits;
}

export async function deductMemberCredits(
  creditsId: string,
  amount: number = 1
): Promise<MemberBenefitCredits> {
  const { data: current, error: fetchError } = await supabase
    .from("member_benefit_credits")
    .select("credits_remaining")
    .eq("id", creditsId)
    .single();
  
  if (fetchError) throw fetchError;
  if (!current) throw new Error("Credits not found");
  
  const newRemaining = Math.max(0, current.credits_remaining - amount);
  
  const { data, error } = await supabase
    .from("member_benefit_credits")
    .update({ credits_remaining: newRemaining })
    .eq("id", creditsId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// ========== COMBINED BALANCE CALCULATION ==========

export interface TotalBenefitBalance {
  benefitType: BenefitType;
  planBalance: number;
  purchasedCredits: number;
  totalAvailable: number;
  isUnlimited: boolean;
}

export async function getTotalBenefitBalance(
  memberId: string,
  membershipId: string,
  benefitType: BenefitType,
  planBalance: number,
  isUnlimited: boolean
): Promise<TotalBenefitBalance> {
  const credits = await getMemberCredits(memberId, benefitType);
  const purchasedCredits = credits.reduce((sum, c) => sum + c.credits_remaining, 0);
  
  return {
    benefitType,
    planBalance,
    purchasedCredits,
    totalAvailable: isUnlimited ? -1 : planBalance + purchasedCredits,
    isUnlimited,
  };
}
