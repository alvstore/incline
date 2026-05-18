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

// Purchase PT package — atomic pipeline.
// Price is GST-inclusive; the RPC derives subtotal/tax from `gstRate` (5% mandatory).
// Trainer commission is always computed off the pre-GST subtotal.
export interface PurchasePTPackageResult {
  success: boolean;
  member_package_id?: string;
  invoice_id?: string;
  subtotal?: number;
  tax_amount?: number;
  gst_rate?: number;
  commission_base?: number;
  commission_amount?: number;
  status?: string;
  payment_source?: string;
  idempotent?: boolean;
  error?: string;
}

export async function purchasePTPackage(args: {
  memberId: string;
  packageId: string;
  trainerId: string;
  branchId: string;
  pricePaid: number;
  gstRate?: 0 | 5;
  paymentMethod?: 'cash' | 'card' | 'upi' | 'bank_transfer';
  paymentSource?: 'in_person' | 'payment_link';
  idempotencyKey: string;
}): Promise<PurchasePTPackageResult> {
  const { data, error } = await supabase.rpc("purchase_pt_package", {
    _member_id: args.memberId,
    _package_id: args.packageId,
    _trainer_id: args.trainerId,
    _branch_id: args.branchId,
    _price_paid: args.pricePaid,
    _gst_rate: args.gstRate ?? 5,
    _payment_method: args.paymentMethod ?? 'cash',
    _payment_source: args.paymentSource ?? 'in_person',
    _idempotency_key: args.idempotencyKey,
  } as any);
  if (error) throw error;
  return data as PurchasePTPackageResult;
}

export async function cancelPendingPTPackage(
  memberPackageId: string,
  reason: string = 'manual_cancel',
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('cancel_pending_pt_package', {
    _member_package_id: memberPackageId,
    _reason: reason,
  } as any);
  if (error) throw error;
  return data as { success: boolean; error?: string };
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

// ─── Dual-mode session logging (atomic RPC) ────────────────────────────
import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';
import { format as _fmtDate } from 'date-fns';

export type PtSessionStatusInput = 'present' | 'completed' | 'late' | 'absent' | 'holiday';

export interface LogPtSessionInput {
  memberPackageId: string;
  trainerId: string;
  notes?: string | null;
  status?: PtSessionStatusInput;
}

export interface LogPtSessionResult {
  session_id: string;
  member_id: string;
  branch_id: string;
  package_type: 'session_based' | 'monthly';
  status: 'completed' | 'late' | 'absent' | 'holiday';
  sessions_remaining: number | null;
  expiry_date: string | null;
  gym_check_in_created: boolean;
}

const PT_LOG_ERROR_MAP: Record<string, string> = {
  not_authorized: "You don't have permission to log PT sessions.",
  package_not_found: 'PT package could not be found.',
  package_not_active: 'This PT package is not active.',
  no_sessions_left: 'No sessions left on this pack — please renew first.',
  package_expired: 'This monthly plan has expired — please renew first.',
};

export async function logPtSession(
  input: LogPtSessionInput,
): Promise<LogPtSessionResult> {
  const { data, error } = await supabase.rpc('log_pt_session' as any, {
    p_member_pt_package_id: input.memberPackageId,
    p_trainer_id: input.trainerId,
    p_status: input.status ?? 'completed',
    p_notes: input.notes ?? null,
  });
  if (error) {
    const friendly = PT_LOG_ERROR_MAP[error.message] ?? error.message;
    throw new Error(friendly);
  }
  const result = data as unknown as LogPtSessionResult;
  // Only fire member receipts for actual attended sessions
  if (result.status === 'completed' || result.status === 'late') {
    firePtReceipt(result).catch(() => undefined);
  }
  return result;
}

async function firePtReceipt(r: LogPtSessionResult) {
  const { data: member } = await supabase
    .from('members')
    .select('id, user_id')
    .eq('id', r.member_id)
    .maybeSingle();
  const userId = (member as any)?.user_id;
  if (!userId) return;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', userId)
    .maybeSingle();
  const phone: string | null = (profile as any)?.phone || null;
  const name: string = (profile as any)?.full_name || 'Member';
  if (!phone) return;

  const detail =
    r.package_type === 'session_based'
      ? `You have ${r.sessions_remaining ?? 0} session(s) left.`
      : r.expiry_date
        ? `Your monthly plan is valid until ${_fmtDate(new Date(r.expiry_date), 'd MMM yyyy')}.`
        : 'Your monthly plan is active.';

  const body =
    `Hi ${name}, your PT session has been logged on ` +
    `${_fmtDate(new Date(), 'd MMM yyyy, h:mm a')}. ${detail} — Incline Fitness`;

  await dispatchCommunication({
    branch_id: r.branch_id,
    channel: 'whatsapp',
    category: 'transactional',
    recipient: phone,
    member_id: r.member_id,
    payload: { body, variables: { event: 'pt_session_logged' } },
    dedupe_key: buildDedupeKey(['pt_session_logged', r.session_id, 'wa']),
    force: true,
  });
}
