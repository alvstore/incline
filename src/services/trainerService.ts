import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Trainer = Database["public"]["Tables"]["trainers"]["Row"];
type TrainerInsert = Database["public"]["Tables"]["trainers"]["Insert"];

export interface TrainerWithProfile extends Trainer {
  profile_name?: string | null;
  profile_email?: string | null;
  profile_phone?: string | null;
  profile_avatar?: string | null;
}

// Fetch trainers for a branch
export async function fetchTrainers(
  branchId: string,
  activeOnly = true
): Promise<TrainerWithProfile[]> {
  const runQuery = async (source: "trainers" | "trainers_directory") => {
    let query = (supabase as any)
      .from(source)
      .select("*")
      .order("created_at", { ascending: false });

    if (branchId) query = query.eq("branch_id", branchId);
    if (activeOnly) query = query.eq("is_active", true);

    return query;
  };

  let { data, error } = await runQuery("trainers");
  if (error) throw error;

  // Front-desk staff cannot read the trainers table directly (it holds
  // government ID / biometric / salary columns). Fall back to the safe
  // directory view so their listings still work.
  if (!data || data.length === 0) {
    const fallback = await runQuery("trainers_directory");
    if (!fallback.error && fallback.data) data = fallback.data;
  }


  const trainers = data || [];
  const userIds = trainers.map((t) => t.user_id);

  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone")
    .in("id", userIds);

  const profilesMap = (profiles || []).reduce((acc, p: any) => {
    acc[p.id] = p;
    return acc;
  }, {} as Record<string, any>);

  return trainers.map((t) => {
    const p = profilesMap[t.user_id];
    return {
      ...t,
      profile_name: p?.full_name,
      profile_email: p?.email,
      profile_phone: p?.phone,
      profile_avatar: p?.avatar_url,
      profile: p || null,
    };
  });
}

// Get trainer by ID
export async function getTrainer(trainerId: string): Promise<TrainerWithProfile | null> {
  const { data, error } = await supabase
    .from("trainers")
    .select("*")
    .eq("id", trainerId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone")
    .eq("id", data.user_id)
    .single();

  return {
    ...data,
    profile_name: profile?.full_name,
    profile_email: profile?.email,
    profile_phone: profile?.phone,
    profile_avatar: profile?.avatar_url,
    profile: profile || null,
  } as any;
}

// Create a trainer profile (link existing user as trainer)
export async function createTrainer(trainerData: TrainerInsert): Promise<Trainer> {
  const { data, error } = await supabase
    .from("trainers")
    .insert(trainerData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update trainer
export async function updateTrainer(
  trainerId: string,
  updates: Partial<TrainerInsert>
): Promise<Trainer> {
  const { data, error } = await supabase
    .from("trainers")
    .update(updates)
    .eq("id", trainerId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Deactivate trainer
export async function deactivateTrainer(trainerId: string): Promise<void> {
  const { error } = await supabase
    .from("trainers")
    .update({ is_active: false })
    .eq("id", trainerId);

  if (error) throw error;
}

// Fetch trainer's upcoming classes
export async function fetchTrainerClasses(
  trainerId: string,
  options?: { startDate?: Date; endDate?: Date }
): Promise<Database["public"]["Tables"]["classes"]["Row"][]> {
  let query = supabase
    .from("classes")
    .select("*")
    .eq("trainer_id", trainerId)
    .eq("is_active", true)
    .order("scheduled_at", { ascending: true });

  if (options?.startDate) {
    query = query.gte("scheduled_at", options.startDate.toISOString());
  }

  if (options?.endDate) {
    query = query.lte("scheduled_at", options.endDate.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Check trainer availability for a time slot
export async function checkTrainerAvailability(
  trainerId: string,
  scheduledAt: Date,
  durationMinutes: number,
  excludeClassId?: string
): Promise<boolean> {
  const startTime = scheduledAt;
  const endTime = new Date(scheduledAt.getTime() + durationMinutes * 60000);

  let query = supabase
    .from("classes")
    .select("id, scheduled_at, duration_minutes")
    .eq("trainer_id", trainerId)
    .eq("is_active", true)
    .gte("scheduled_at", new Date(startTime.getTime() - 24 * 60 * 60000).toISOString())
    .lte("scheduled_at", new Date(endTime.getTime() + 24 * 60 * 60000).toISOString());

  if (excludeClassId) {
    query = query.neq("id", excludeClassId);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Check for time overlap
  for (const cls of data || []) {
    const classStart = new Date(cls.scheduled_at);
    const classDuration = cls.duration_minutes || 60;
    const classEnd = new Date(classStart.getTime() + classDuration * 60000);

    // Check overlap
    if (startTime < classEnd && endTime > classStart) {
      return false;
    }
  }

  return true;
}
