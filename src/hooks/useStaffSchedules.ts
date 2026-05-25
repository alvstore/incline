import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ShiftRow {
  id?: string;
  user_id: string;
  weekday: number;
  morning_start: string | null;
  morning_end: string | null;
  evening_start: string | null;
  evening_end: string | null;
  is_weekly_off: boolean;
  branch_id: string | null;
}

export interface TrainerRosterRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  shifts: Record<number, ShiftRow | undefined>; // keyed by weekday 0-6
}

export function useStaffSchedules(branchId: string | undefined) {
  return useQuery({
    queryKey: ['staff-schedules', branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<TrainerRosterRow[]> => {
      // Trainers in this branch (no nested FK alias — fetch profiles separately)
      const { data: trainers, error: tErr } = await supabase
        .from('trainers')
        .select('user_id')
        .eq('branch_id', branchId!)
        .eq('is_active', true);
      if (tErr) throw tErr;

      const userIds = (trainers || [])
        .map((t: any) => t.user_id)
        .filter(Boolean);

      if (userIds.length === 0) return [];

      const [{ data: profiles, error: pErr }, { data: shifts, error: sErr }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds),
        supabase.from('staff_shifts').select('*').in('user_id', userIds),
      ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;

      const profileMap = new Map<string, any>(
        (profiles || []).map((p: any) => [p.id, p])
      );

      return userIds.map((uid: string) => {
        const p = profileMap.get(uid);
        const map: Record<number, ShiftRow> = {};
        (shifts || [])
          .filter((s: any) => s.user_id === uid)
          .forEach((s: any) => { map[s.weekday] = s as ShiftRow; });
        return {
          user_id: uid,
          full_name: p?.full_name || 'Unnamed Trainer',
          avatar_url: p?.avatar_url || null,
          shifts: map,
        };
      });
    },
  });
}


export function useUpsertShift(branchId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (row: Partial<ShiftRow> & { user_id: string; weekday: number }) => {
      const payload = {
        user_id: row.user_id,
        weekday: row.weekday,
        branch_id: branchId ?? null,
        morning_start: row.morning_start || null,
        morning_end: row.morning_end || null,
        evening_start: row.evening_start || null,
        evening_end: row.evening_end || null,
        is_weekly_off: !!row.is_weekly_off,
      };
      const { data, error } = await supabase
        .from('staff_shifts')
        .upsert(payload, { onConflict: 'user_id,weekday' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Roster updated' });
      qc.invalidateQueries({ queryKey: ['staff-schedules', branchId] });
    },
    onError: (e: any) => toast({
      title: 'Failed to save', description: e.message, variant: 'destructive',
    }),
  });
}

export function useDeleteShift(branchId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ userId, weekday }: { userId: string; weekday: number }) => {
      const { error } = await supabase
        .from('staff_shifts')
        .delete()
        .eq('user_id', userId)
        .eq('weekday', weekday);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Shift removed' });
      qc.invalidateQueries({ queryKey: ['staff-schedules', branchId] });
    },
    onError: (e: any) => toast({
      title: 'Failed to delete', description: e.message, variant: 'destructive',
    }),
  });
}

// ---------------------------------------------------------------------------
// Attendance roll-up (migrated from HRM "Attendance" tab)
// ---------------------------------------------------------------------------
export interface AttendanceLogRow {
  id: string;
  user_id: string;
  check_in: string | null;
  check_out: string | null;
  shift_type?: string | null;
  total_hours?: number | null;
}

export function useStaffAttendanceMonth(branchId: string | undefined, ym: string) {
  return useQuery({
    queryKey: ['staff-attendance-month', branchId, ym],
    enabled: !!branchId && /^\d{4}-\d{2}$/.test(ym),
    queryFn: async (): Promise<AttendanceLogRow[]> => {
      const [y, m] = ym.split('-').map(Number);
      const startIso = `${ym}-01T00:00:00`;
      const endIso = new Date(y, m, 0, 23, 59, 59).toISOString();
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('id,user_id,check_in,check_out,shift_type,total_hours')
        .gte('check_in', startIso)
        .lte('check_in', endIso)
        .order('check_in', { ascending: false });
      if (error) throw error;
      return (data || []) as AttendanceLogRow[];
    },
  });
}
