import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PTPackage = Database["public"]["Tables"]["pt_packages"]["Row"];
type MemberPTPackage = Database["public"]["Tables"]["member_pt_packages"]["Row"];
type PTSession = Database["public"]["Tables"]["pt_sessions"]["Row"];

export interface PTPackageWithDetails extends PTPackage {
  trainer_name?: string;
}

export interface MemberPTPackageWithDetails extends MemberPTPackage {
  package_name?: string;
  trainer_name?: string;
  member_code?: string;
  member_name?: string;
}

export interface PTSessionWithDetails extends PTSession {
  member_name?: string;
  trainer_name?: string;
}

// Fetch PT packages for a branch (optional branchId = all branches)
export async function fetchPTPackages(branchId?: string): Promise<PTPackage[]> {
  let query = supabase
    .from("pt_packages")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Create PT package
export async function createPTPackage(
  packageData: Database["public"]["Tables"]["pt_packages"]["Insert"]
): Promise<PTPackage> {
  const { data, error } = await supabase
    .from("pt_packages")
    .insert(packageData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update PT package
export async function updatePTPackage(
  packageId: string,
  packageData: Database["public"]["Tables"]["pt_packages"]["Update"]
): Promise<PTPackage> {
  const { data, error } = await supabase
    .from("pt_packages")
    .update(packageData)
    .eq("id", packageId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Purchase PT package — uses unified settlement (8-arg variant routes through record_payment)
export async function purchasePTPackage(
  memberId: string,
  packageId: string,
  trainerId: string,
  branchId: string,
  pricePaid: number,
  paymentMethod: string = 'cash',
  idempotencyKey?: string,
): Promise<{ success: boolean; member_package_id?: string; invoice_id?: string; error?: string }> {
  const idem = idempotencyKey ?? `pt-${memberId}-${packageId}-${Date.now()}`;
  const { data, error } = await supabase.rpc("purchase_pt_package", {
    _member_id: memberId,
    _package_id: packageId,
    _trainer_id: trainerId,
    _branch_id: branchId,
    _price_paid: pricePaid,
    _payment_method: paymentMethod,
    _idempotency_key: idem,
  });
  if (error) throw error;
  return data as { success: boolean; member_package_id?: string; invoice_id?: string; error?: string };
}

// Fetch member's PT packages
export async function fetchMemberPTPackages(
  memberId: string
): Promise<MemberPTPackageWithDetails[]> {
  const { data, error } = await supabase
    .from("member_pt_packages")
    .select(`
      *,
      package:pt_packages(name),
      trainer:trainers(user_id)
    `)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const packages = data || [];
  const trainerUserIds = packages
    .map((p) => (p.trainer as any)?.user_id)
    .filter((id): id is string => !!id);

  let trainerNames: Record<string, string> = {};
  if (trainerUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", trainerUserIds);
    trainerNames = (profiles || []).reduce((acc, p) => {
      acc[p.id] = p.full_name || "Unknown";
      return acc;
    }, {} as Record<string, string>);
  }

  return packages.map((p) => ({
    ...p,
    package_name: (p.package as any)?.name,
    trainer_name: (p.trainer as any)?.user_id ? trainerNames[(p.trainer as any).user_id] : undefined,
  }));
}

// Fetch active PT packages for a branch (optional branchId = all branches)
export async function fetchActiveMemberPackages(
  branchId?: string
): Promise<MemberPTPackageWithDetails[]> {
  let query = supabase
    .from("member_pt_packages")
    .select(`
      *,
      package:pt_packages(name),
      trainer:trainers(user_id),
      member:members(member_code, user_id)
    `)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const packages = data || [];
  const userIds = [
    ...packages.map((p) => (p.trainer as any)?.user_id),
    ...packages.map((p) => (p.member as any)?.user_id),
  ].filter((id): id is string => !!id);

  let names: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set(userIds)]);
    names = (profiles || []).reduce((acc, p) => {
      acc[p.id] = p.full_name || "Unknown";
      return acc;
    }, {} as Record<string, string>);
  }

  return packages.map((p) => ({
    ...p,
    package_name: (p.package as any)?.name,
    trainer_name: (p.trainer as any)?.user_id ? names[(p.trainer as any).user_id] : undefined,
    member_code: (p.member as any)?.member_code,
    member_name: (p.member as any)?.user_id ? names[(p.member as any).user_id] : (p.member as any)?.member_code,
  }));
}

// Schedule PT session
export async function schedulePTSession(
  memberPackageId: string,
  trainerId: string,
  branchId: string,
  scheduledAt: Date,
  durationMinutes = 60
): Promise<PTSession> {
  // First check availability
  const { data: isAvailable } = await supabase.rpc("check_trainer_slot_available", {
    _trainer_id: trainerId,
    _scheduled_at: scheduledAt.toISOString(),
    _duration_minutes: durationMinutes,
  });

  if (!isAvailable) {
    throw new Error("Trainer is not available at this time");
  }

  const { data, error } = await supabase
    .from("pt_sessions")
    .insert({
      member_pt_package_id: memberPackageId,
      trainer_id: trainerId,
      branch_id: branchId,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: durationMinutes,
      status: "scheduled",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Fetch PT sessions for a trainer
export async function fetchTrainerSessions(
  trainerId: string,
  options?: { startDate?: Date; endDate?: Date }
): Promise<PTSessionWithDetails[]> {
  let query = supabase
    .from("pt_sessions")
    .select(`
      *,
      member_package:member_pt_packages(member:members(member_code, user_id))
    `)
    .eq("trainer_id", trainerId)
    .order("scheduled_at", { ascending: true });

  if (options?.startDate) {
    query = query.gte("scheduled_at", options.startDate.toISOString());
  }
  if (options?.endDate) {
    query = query.lte("scheduled_at", options.endDate.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;

  const sessions = data || [];
  const userIds = sessions
    .map((s) => (s.member_package as any)?.member?.user_id)
    .filter((id): id is string => !!id);

  let names: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set(userIds)]);
    names = (profiles || []).reduce((acc, p) => {
      acc[p.id] = p.full_name || "Unknown";
      return acc;
    }, {} as Record<string, string>);
  }

  return sessions.map((s) => {
    const member = (s.member_package as any)?.member;
    return {
      ...s,
      member_name: member?.user_id ? names[member.user_id] : member?.member_code || "Unknown",
    };
  });
}

// Complete PT session
export async function completePTSession(
  sessionId: string,
  notes?: string
): Promise<{ success: boolean; sessions_remaining?: number; error?: string }> {
  const { data, error } = await supabase.rpc("complete_pt_session", {
    _session_id: sessionId,
    _notes: notes || null,
  });

  if (error) throw error;
  return data as { success: boolean; sessions_remaining?: number; error?: string };
}

// Cancel PT session
export async function cancelPTSession(
  sessionId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from("pt_sessions")
    .update({ status: "cancelled", cancelled_reason: reason })
    .eq("id", sessionId);

  if (error) throw error;
}

// Generate AI fitness plan
export async function generateFitnessPlan(
  type: "workout" | "diet",
  memberInfo: {
    name?: string;
    age?: number;
    gender?: string;
    height?: number;
    weight?: number;
    fitnessGoals?: string;
    healthConditions?: string;
    experience?: string;
    preferences?: string;
  },
  options?: {
    durationWeeks?: number;
    /** Workout sessions per week (1-7). Drives session count + structure. */
    daysPerWeek?: number;
    /** If > 0, AI returns multiple variant blocks that rotate every N days
     * so members don't repeat the exact same session. 0 = no rotation. */
    rotationIntervalDays?: number;
    caloriesTarget?: number;
    /** Subset of meal_catalog rows the AI is allowed/encouraged to use.
     * Mapped back to catalog ids in the response so the diet page can show
     * which AI meals correspond to gym-stocked items vs custom suggestions. */
    availableMeals?: Array<{
      id: string;
      name: string;
      meal_type?: string | null;
      calories?: number;
      protein?: number;
      carbs?: number;
      fats?: number;
      default_quantity?: string | null;
    }>;
    /** Operational equipment from the active branch — bias workout AI
     * toward machines the gym actually owns. */
    availableEquipment?: Array<{
      name: string;
      category?: string | null;
      brand?: string | null;
      model?: string | null;
    }>;
    /** Brief textual summary of the member's previous plan + adherence. */
    previousPlanContext?: string;
  }
): Promise<any> {
  const { data, error } = await supabase.functions.invoke("generate-fitness-plan", {
    body: {
      type,
      memberInfo,
      durationWeeks: options?.durationWeeks || 4,
      daysPerWeek: options?.daysPerWeek,
      rotationIntervalDays: options?.rotationIntervalDays,
      caloriesTarget: options?.caloriesTarget,
      availableMeals: options?.availableMeals,
      availableEquipment: options?.availableEquipment,
      previousPlanContext: options?.previousPlanContext,
    },
  });

  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data.plan;
}
