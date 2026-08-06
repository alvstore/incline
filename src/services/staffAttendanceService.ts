import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type StaffAttendance = Database['public']['Tables']['staff_attendance']['Row'];

export interface StaffAttendanceWithDetails extends StaffAttendance {
  employee?: {
    id: string;
    employee_code: string;
    position: string | null;
    department: string | null;
  } | null;
  profile?: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

export const staffAttendanceService = {
  // Check-in-only model: one row per roster shift block per day.
  // The RPC resolves the block from the staff roster and ignores repeat punches.
  async checkIn(userId: string, branchId: string, _method: string = 'manual') {
    const { data, error } = await supabase.rpc('staff_record_punch', {
      p_user_id: userId,
      p_branch_id: branchId,
      p_check_in: new Date().toISOString(),
      p_source: 'manual',
      p_notes: null,
    });
    if (error) throw error;
    return { success: true, attendance_id: data as unknown as string };
  },

  // Legacy check-out (kept for existing open rows; check-out is not part of the flow).
  async checkOut(userId: string) {
    const { data, error } = await supabase.rpc('staff_check_out', { p_user_id: userId });
    if (error) throw error;
    return { success: true, attendance_id: data as unknown as string };
  },

  // Correct a wrong punch (owner / admin / manager only).
  async correctPunch(id: string, checkIn?: string, notes?: string) {
    const { error } = await supabase.rpc('staff_correct_attendance', {
      p_id: id,
      p_check_in: checkIn ?? null,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    return { success: true };
  },

  async deletePunch(id: string) {
    const { error } = await supabase.rpc('staff_delete_attendance', { p_id: id });
    if (error) throw error;
    return { success: true };
  },


  // Get today's staff attendance
  async getTodayAttendance(branchId: string) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('staff_attendance')
      .select('*')
      .eq('branch_id', branchId)
      .gte('check_in', `${today}T00:00:00`)
      .order('check_in', { ascending: false });

    if (error) throw error;
    return data;
  },

  // Get currently checked-in staff
  async getCheckedInStaff(branchId: string) {
    const { data, error } = await supabase
      .from('staff_attendance')
      .select('*')
      .eq('branch_id', branchId)
      .is('check_out', null)
      .order('check_in', { ascending: false });

    if (error) throw error;
    return data;
  },

  // Get user attendance history
  async getUserAttendance(userId: string, startDate?: string, endDate?: string) {
    let query = supabase
      .from('staff_attendance')
      .select('*')
      .eq('user_id', userId)
      .order('check_in', { ascending: false });

    if (startDate) {
      query = query.gte('check_in', `${startDate}T00:00:00`);
    }
    if (endDate) {
      query = query.lte('check_in', `${endDate}T23:59:59`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Get all employees for a branch
  async getBranchEmployees(branchId: string) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('employee_code');

    if (error) throw error;
    return data;
  },
};
