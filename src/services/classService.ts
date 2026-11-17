import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Class = Database["public"]["Tables"]["classes"]["Row"];
type ClassInsert = Database["public"]["Tables"]["classes"]["Insert"];
type ClassBooking = Database["public"]["Tables"]["class_bookings"]["Row"];
type ClassWaitlist = Database["public"]["Tables"]["class_waitlist"]["Row"];

export interface ClassWithDetails extends Class {
  bookings_count?: number;
  waitlist_count?: number;
}

export interface BookingWithMember extends ClassBooking {
  member?: {
    id: string;
    member_code: string;
    user_id: string | null;
  } | null;
  member_name?: string;
  member_phone?: string;
}

// Fetch classes with optional filters
export async function fetchClasses(
  branchId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    trainerId?: string;
    activeOnly?: boolean;
  }
): Promise<ClassWithDetails[]> {
  let query = supabase
    .from("classes")
    .select("*")
    .eq("branch_id", branchId)
    .order("scheduled_at", { ascending: true });

  if (options?.activeOnly !== false) {
    query = query.eq("is_active", true);
  }

  if (options?.startDate) {
    query = query.gte("scheduled_at", options.startDate.toISOString());
  }

  if (options?.endDate) {
    query = query.lte("scheduled_at", options.endDate.toISOString());
  }

  if (options?.trainerId) {
    query = query.eq("trainer_id", options.trainerId);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Get booking counts for each class
  const classIds = data?.map((c) => c.id) || [];
  if (classIds.length === 0) return [];

  const { data: bookingsData } = await supabase
    .from("class_bookings")
    .select("class_id")
    .in("class_id", classIds)
    .eq("status", "booked");

  const { data: waitlistData } = await supabase
    .from("class_waitlist")
    .select("class_id")
    .in("class_id", classIds);

  const bookingCounts = (bookingsData || []).reduce((acc, b) => {
    acc[b.class_id] = (acc[b.class_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const waitlistCounts = (waitlistData || []).reduce((acc, w) => {
    acc[w.class_id] = (acc[w.class_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (data || []).map((c) => ({
    ...c,
    bookings_count: bookingCounts[c.id] || 0,
    waitlist_count: waitlistCounts[c.id] || 0,
  }));
}

// Create a new class
export async function createClass(classData: ClassInsert): Promise<Class> {
  const { data, error } = await supabase
    .from("classes")
    .insert(classData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a class
export async function updateClass(
  classId: string,
  updates: Partial<ClassInsert>
): Promise<Class> {
  const { data, error } = await supabase
    .from("classes")
    .update(updates)
    .eq("id", classId)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("This class is no longer available or you do not have permission to edit it. Refresh the class list.");
  return data;
}

// Book a class for a member
export async function bookClass(
  classId: string,
  memberId: string
): Promise<{ success: boolean; booking_id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("book_class", {
    _class_id: classId,
    _member_id: memberId,
  });

  if (error) throw error;
  return data as { success: boolean; booking_id?: string; error?: string };
}

// Validate booking before attempting
export async function validateBooking(
  classId: string,
  memberId: string
): Promise<{ valid: boolean; error?: string; waitlist_available?: boolean }> {
  const { data, error } = await supabase.rpc("validate_class_booking", {
    _class_id: classId,
    _member_id: memberId,
  });

  if (error) throw error;
  return data as { valid: boolean; error?: string; waitlist_available?: boolean };
}

// Add member to waitlist
export async function addToWaitlist(
  classId: string,
  memberId: string
): Promise<{ success: boolean; position?: number; error?: string }> {
  const { data, error } = await supabase.rpc("add_to_waitlist", {
    _class_id: classId,
    _member_id: memberId,
  });

  if (error) throw error;
  return data as { success: boolean; position?: number; error?: string };
}

// Cancel a booking
export async function cancelBooking(
  bookingId: string,
  reason?: string
): Promise<{ success: boolean; promoted_from_waitlist?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("cancel_class_booking", {
    _booking_id: bookingId,
    _reason: reason || null,
  });

  if (error) throw error;
  return data as { success: boolean; promoted_from_waitlist?: boolean; error?: string };
}

// Mark attendance
export async function markAttendance(
  bookingId: string,
  attended: boolean
): Promise<{ success: boolean; status?: string; error?: string }> {
  const { data, error } = await supabase.rpc("mark_class_attendance", {
    _booking_id: bookingId,
    _attended: attended,
  });

  if (error) throw error;
  return data as { success: boolean; status?: string; error?: string };
}

// Fetch bookings for a class with member details
export async function fetchClassBookings(
  classId: string
): Promise<BookingWithMember[]> {
  const { data, error } = await supabase
    .from("class_bookings")
    .select(`
      *,
      member:members(id, member_code, user_id)
    `)
    .eq("class_id", classId)
    .order("booked_at", { ascending: true });

  if (error) throw error;

  // Get member user_ids to fetch profiles
  const bookings = data || [];
  const userIds = bookings
    .map((b) => (b.member as any)?.user_id)
    .filter((id): id is string => !!id);

  let profilesMap: Record<string, { full_name: string | null; phone: string | null; avatar_url: string | null }> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, phone, avatar_url")
      .in("id", userIds);

    profilesMap = (profiles || []).reduce((acc, p) => {
      acc[p.id] = { full_name: p.full_name, phone: p.phone, avatar_url: p.avatar_url };
      return acc;
    }, {} as Record<string, { full_name: string | null; phone: string | null; avatar_url: string | null }>);
  }

  return bookings.map((b) => {
    const member = b.member as { id: string; member_code: string; user_id: string | null } | null;
    const profile = member?.user_id ? profilesMap[member.user_id] : null;
    return {
      ...b,
      member,
      member_name: profile?.full_name || member?.member_code || "Unknown",
      member_phone: profile?.phone || null,
      member_avatar: profile?.avatar_url || null,
    };
  });
}

// Fetch waitlist for a class
export async function fetchClassWaitlist(classId: string): Promise<
  (ClassWaitlist & { member_code?: string; member_name?: string })[]
> {
  const { data, error } = await supabase
    .from("class_waitlist")
    .select(`
      *,
      member:members(member_code, user_id)
    `)
    .eq("class_id", classId)
    .order("position", { ascending: true });

  if (error) throw error;

  const waitlist = data || [];
  const userIds = waitlist
    .map((w) => (w.member as any)?.user_id)
    .filter((id): id is string => !!id);

  let profilesMap: Record<string, string | null> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    profilesMap = (profiles || []).reduce((acc, p) => {
      acc[p.id] = p.full_name;
      return acc;
    }, {} as Record<string, string | null>);
  }

  return waitlist.map((w) => {
    const member = w.member as { member_code: string; user_id: string | null } | null;
    return {
      ...w,
      member_code: member?.member_code,
      member_name: member?.user_id ? profilesMap[member.user_id] || member.member_code : member?.member_code,
    };
  });
}

// Fetch no-shows for reporting
export async function fetchNoShows(
  branchId: string,
  startDate: Date,
  endDate: Date
): Promise<BookingWithMember[]> {
  const { data: classesData, error: classesError } = await supabase
    .from("classes")
    .select("id")
    .eq("branch_id", branchId)
    .gte("scheduled_at", startDate.toISOString())
    .lte("scheduled_at", endDate.toISOString());

  if (classesError) throw classesError;
  const classIds = (classesData || []).map((c) => c.id);

  if (classIds.length === 0) return [];

  const { data, error } = await supabase
    .from("class_bookings")
    .select(`
      *,
      member:members(id, member_code, user_id)
    `)
    .eq("status", "no_show")
    .in("class_id", classIds);

  if (error) throw error;

  const bookings = data || [];
  const userIds = bookings
    .map((b) => (b.member as any)?.user_id)
    .filter((id): id is string => !!id);

  let profilesMap: Record<string, { full_name: string | null; phone: string | null }> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", userIds);

    profilesMap = (profiles || []).reduce((acc, p) => {
      acc[p.id] = { full_name: p.full_name, phone: p.phone };
      return acc;
    }, {} as Record<string, { full_name: string | null; phone: string | null }>);
  }

  return bookings.map((b) => {
    const member = b.member as { id: string; member_code: string; user_id: string | null } | null;
    const profile = member?.user_id ? profilesMap[member.user_id] : null;
    return {
      ...b,
      member,
      member_name: profile?.full_name || member?.member_code || "Unknown",
      member_phone: profile?.phone || null,
    };
  });
}
