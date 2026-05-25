import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type StaffRoleLabel = 'Trainer' | 'Manager' | 'Front Desk' | 'Cleaning' | 'Staff';

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
  role: StaffRoleLabel;
  position: string | null;
  department: string | null;
  shifts: Record<number, ShiftRow | undefined>;
}

// Back-compat alias
export type StaffRosterRow = TrainerRosterRow;

function inferRole(emp: { department?: string | null; position?: string | null }): StaffRoleLabel {
  const dept = String(emp.department || '').toLowerCase();
  const pos = String(emp.position || '').toLowerCase();
  if (pos.includes('manager') || dept.includes('management')) return 'Manager';
  if (pos.includes('front') || pos.includes('desk') || pos.includes('reception')) return 'Front Desk';
  if (pos.includes('clean') || pos.includes('housekeep') || pos.includes('janitor')) return 'Cleaning';
  return 'Staff';
}

export function useStaffSchedules(branchId: string | undefined) {
  return useQuery({
    queryKey: ['staff-schedules', branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<TrainerRosterRow[]> => {
      // Fetch trainers + employees in this branch (parallel, no FK aliases)
      const [{ data: trainers, error: tErr }, { data: employees, error: eErr }] = await Promise.all([
        supabase.from('trainers').select('user_id').eq('branch_id', branchId!).eq('is_active', true),
        supabase.from('employees').select('user_id, department, position').eq('branch_id', branchId!).eq('is_active', true),
      ]);
      if (tErr) throw tErr;
      if (eErr) throw eErr;

      // Build user → role map (trainer wins if both)
      const roleMap = new Map<string, { role: StaffRoleLabel; position: string | null; department: string | null }>();
      (employees || []).forEach((e: any) => {
        if (e.user_id) roleMap.set(e.user_id, {
          role: inferRole(e),
          position: e.position || null,
          department: e.department || null,
        });
      });
      (trainers || []).forEach((t: any) => {
        if (t.user_id) roleMap.set(t.user_id, { role: 'Trainer', position: 'Trainer', department: 'Training' });
      });

      const userIds = Array.from(roleMap.keys());
      if (userIds.length === 0) return [];

      const [{ data: profiles, error: pErr }, { data: shifts, error: sErr }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds),
        supabase.from('staff_shifts').select('*').in('user_id', userIds),
      ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;

      const profileMap = new Map<string, any>((profiles || []).map((p: any) => [p.id, p]));

      return userIds.map((uid) => {
        const p = profileMap.get(uid);
        const rl = roleMap.get(uid)!;
        const map: Record<number, ShiftRow> = {};
        (shifts || [])
          .filter((s: any) => s.user_id === uid)
          .forEach((s: any) => { map[s.weekday] = s as ShiftRow; });
        return {
          user_id: uid,
          full_name: p?.full_name || 'Unnamed Staff',
          avatar_url: p?.avatar_url || null,
          role: rl.role,
          position: rl.position,
          department: rl.department,
          shifts: map,
        };
      }).sort((a, b) => a.full_name.localeCompare(b.full_name));
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

/**
 * Bulk-apply a shift template to multiple weekdays for one user. Skips rows
 * whose existing entry has `is_weekly_off=true` unless overwriteWeeklyOff=true.
 */
export function useBulkUpsertShifts(branchId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      weekdays: number[];
      template: Omit<Partial<ShiftRow>, 'user_id' | 'weekday'>;
      existingShifts: Record<number, ShiftRow | undefined>;
      overwriteWeeklyOff?: boolean;
    }) => {
      const targets = input.weekdays.filter((wd) => {
        if (input.overwriteWeeklyOff) return true;
        const ex = input.existingShifts[wd];
        return !(ex?.is_weekly_off);
      });
      if (targets.length === 0) return { written: 0, skipped: input.weekdays.length };

      const rows = targets.map((wd) => ({
        user_id: input.user_id,
        weekday: wd,
        branch_id: branchId ?? null,
        morning_start: input.template.morning_start || null,
        morning_end: input.template.morning_end || null,
        evening_start: input.template.evening_start || null,
        evening_end: input.template.evening_end || null,
        is_weekly_off: !!input.template.is_weekly_off,
      }));

      const { error } = await supabase
        .from('staff_shifts')
        .upsert(rows, { onConflict: 'user_id,weekday' });
      if (error) throw error;
      return { written: rows.length, skipped: input.weekdays.length - rows.length };
    },
    onSuccess: (res) => {
      toast({
        title: 'Roster updated',
        description: `Applied to ${res.written} day${res.written === 1 ? '' : 's'}${res.skipped ? ` · skipped ${res.skipped} weekly-off` : ''}.`,
      });
      qc.invalidateQueries({ queryKey: ['staff-schedules', branchId] });
    },
    onError: (e: any) => toast({
      title: 'Bulk save failed', description: e.message, variant: 'destructive',
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
// Attendance roll-up
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

// ---------------------------------------------------------------------------
// Per-date shift overrides (e.g. ad-hoc Sunday duty for a specific date)
// ---------------------------------------------------------------------------
export interface ShiftOverrideRow {
  id?: string;
  user_id: string;
  branch_id: string | null;
  date: string; // 'YYYY-MM-DD'
  morning_start: string | null;
  morning_end: string | null;
  evening_start: string | null;
  evening_end: string | null;
  is_weekly_off: boolean;
  note?: string | null;
}

export function useShiftOverridesForDate(branchId: string | undefined, dateISO: string | undefined) {
  return useQuery({
    queryKey: ['staff-shift-overrides', branchId, dateISO],
    enabled: !!branchId && !!dateISO,
    queryFn: async (): Promise<ShiftOverrideRow[]> => {
      const { data, error } = await supabase
        .from('staff_shift_overrides')
        .select('*')
        .eq('branch_id', branchId!)
        .eq('date', dateISO!);
      if (error) throw error;
      return (data || []) as ShiftOverrideRow[];
    },
  });
}

export function useUpsertShiftOverride(branchId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (row: Omit<ShiftOverrideRow, 'id' | 'branch_id'>) => {
      const payload = {
        user_id: row.user_id,
        branch_id: branchId ?? null,
        date: row.date,
        morning_start: row.morning_start || null,
        morning_end: row.morning_end || null,
        evening_start: row.evening_start || null,
        evening_end: row.evening_end || null,
        is_weekly_off: !!row.is_weekly_off,
        note: row.note || null,
      };
      const { data, error } = await supabase
        .from('staff_shift_overrides')
        .upsert(payload, { onConflict: 'user_id,date' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['staff-shift-overrides', branchId, vars.date] });
      qc.invalidateQueries({ queryKey: ['staff-schedules', branchId] });
    },
    onError: (e: any) => toast({
      title: 'Failed to save override', description: e.message, variant: 'destructive',
    }),
  });
}

export function useDeleteShiftOverride(branchId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ userId, date }: { userId: string; date: string }) => {
      const { error } = await supabase
        .from('staff_shift_overrides')
        .delete()
        .eq('user_id', userId)
        .eq('date', date);
      if (error) throw error;
      return { userId, date };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['staff-shift-overrides', branchId, res.date] });
      qc.invalidateQueries({ queryKey: ['staff-schedules', branchId] });
    },
    onError: (e: any) => toast({
      title: 'Failed to remove override', description: e.message, variant: 'destructive',
    }),
  });
}
