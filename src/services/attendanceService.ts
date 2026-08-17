import { supabase } from '@/integrations/supabase/client';
import { getISTToday } from '@/lib/utils/datetime';
import type { Database, Json } from '@/integrations/supabase/types';

type MemberAttendance = Database['public']['Tables']['member_attendance']['Row'];

export interface CheckInResult {
  valid: boolean;
  success?: boolean;
  attendance_id?: string;
  message: string;
  reason?: string;
  plan_name?: string;
  days_remaining?: number;
  check_in_time?: string;
}

export interface CheckOutResult {
  success: boolean;
  attendance_id?: string;
  message: string;
  check_in?: string;
  check_out?: string;
  duration_minutes?: number;
}

export interface MemberAttendanceWithDetails extends MemberAttendance {
  members?: {
    member_code: string;
    user_id: string | null;
    profiles?: {
      full_name: string | null;
      avatar_url: string | null;
      phone: string | null;
    } | null;
  } | null;
}

export const attendanceService = {
  // Validate member can check in
  async validateCheckIn(memberId: string, branchId: string): Promise<CheckInResult> {
    const { data, error } = await supabase.rpc('validate_member_checkin', {
      _member_id: memberId,
      _branch_id: branchId,
    });

    if (error) throw error;
    return data as unknown as CheckInResult;
  },

  // Perform check-in
  async checkIn(memberId: string, branchId: string, method: string = 'manual'): Promise<CheckInResult> {
    const { data, error } = await supabase.rpc('member_check_in', {
      _member_id: memberId,
      _branch_id: branchId,
      _method: method,
    });

    if (error) throw error;
    return data as unknown as CheckInResult;
  },

  // Perform check-out
  async checkOut(memberId: string): Promise<CheckOutResult> {
    const { data, error } = await supabase.rpc('member_check_out', {
      _member_id: memberId,
    });

    if (error) throw error;
    return data as unknown as CheckOutResult;
  },

  // Get today's attendance for a branch
  async getTodayAttendance(branchId: string): Promise<MemberAttendanceWithDetails[]> {
    const today = getISTToday();
    
    const { data, error } = await supabase
      .from('member_attendance')
      .select(`
        *,
        members (
          member_code,
          user_id
        )
      `)
      .eq('branch_id', branchId)
      .gte('check_in', `${today}T00:00:00`)
      .order('check_in', { ascending: false });

    if (error) throw error;
    
    // Enrich with profile data
    return await this.enrichWithProfiles(data || []);
  },

  // Get attendance history for a member
  async getMemberAttendance(memberId: string, limit: number = 30) {
    const { data, error } = await supabase
      .from('member_attendance')
      .select('*')
      .eq('member_id', memberId)
      .order('check_in', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  },

  // Get currently checked-in members
  async getCheckedInMembers(branchId: string) {
    const { data, error } = await supabase
      .from('member_attendance')
      .select(`
        *,
        members (
          member_code,
          user_id
        )
      `)
      .eq('branch_id', branchId)
      .is('check_out', null)
      .order('check_in', { ascending: false });

    if (error) throw error;
    return await this.enrichWithProfiles(data || []);
  },

  // Helper: fetch profiles for attendance records and attach as members.profiles
  async enrichWithProfiles(records: any[]): Promise<MemberAttendanceWithDetails[]> {
    const userIds = [...new Set(records.map(r => r.members?.user_id).filter(Boolean))];
    if (userIds.length === 0) return records;
    
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, phone')
      .in('id', userIds);
    
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    
    return records.map(r => ({
      ...r,
      members: r.members ? {
        ...r.members,
        profiles: r.members.user_id ? profileMap.get(r.members.user_id) || null : null,
      } : null,
    }));
  },

  // Search member by code, name, phone or email for check-in using search_members RPC
  async searchMemberForCheckIn(query: string, branchId: string) {
    // Search across all branches first to improve results, then filter
    const { data, error } = await supabase.rpc('search_members', {
      search_term: query,
      p_branch_id: null, // Search all branches for better matching
      p_limit: 20
    });

    if (error) {
      console.error('Search members error:', error);
      throw error;
    }
    
    // Filter by branch after search and map to expected format
    const filteredData = (data || []).filter((m: any) => m.branch_id === branchId);
    
    return filteredData.map((m: any) => ({
      id: m.id,
      member_code: m.member_code,
      user_id: null,
      profiles: {
        full_name: m.full_name,
        avatar_url: m.avatar_url,
        phone: m.phone,
      },
    }));
  },
};
