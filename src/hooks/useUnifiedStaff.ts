import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type StaffRole = 'manager' | 'trainer' | 'staff';

export interface UnifiedStaffPerson {
  key: string;
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  profile: any;
  roles: StaffRole[];
  employee?: any;
  trainer?: any;
  code: string | null;
  department: string | null;
  position: string | null;
  specialization: string | null;
  salary: number;
  branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  exit_date: string | null;
  exit_type: string | null;
  hire_date: string;
}

function detectEmployeeRole(emp: any): StaffRole {
  const dept = String(emp?.department || '').toLowerCase();
  const pos = String(emp?.position || '').toLowerCase();
  if (dept.includes('management') || pos.includes('manager')) return 'manager';
  return 'staff';
}

export const UNIFIED_STAFF_KEY = ['unified-staff-people'];

export function useUnifiedStaff() {
  return useQuery<UnifiedStaffPerson[]>({
    queryKey: UNIFIED_STAFF_KEY,
    queryFn: async () => {
      const [{ data: employees, error: empError }, { data: trainers, error: trainerError }] = await Promise.all([
        supabase.from('employees').select(`*, branches:branch_id(name)`).order('created_at', { ascending: false }),
        supabase.from('trainers').select(`*, branches:branch_id(name)`).order('created_at', { ascending: false }),
      ]);
      if (empError) throw empError;
      if (trainerError) throw trainerError;

      const allUserIds = [
        ...(employees || []).map((e: any) => e.user_id),
        ...(trainers || []).map((t: any) => t.user_id),
      ].filter(Boolean) as string[];

      let profileMap = new Map<string, any>();
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, avatar_url, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number')
          .in('id', allUserIds);
        profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      }

      const map = new Map<string, UnifiedStaffPerson>();
      const upsert = (key: string, base: Partial<UnifiedStaffPerson>) => {
        const existing = map.get(key);
        if (!existing) {
          map.set(key, base as UnifiedStaffPerson);
        } else {
          map.set(key, {
            ...existing,
            ...base,
            roles: Array.from(new Set([...existing.roles, ...(base.roles || [])])) as StaffRole[],
            employee: base.employee || existing.employee,
            trainer: base.trainer || existing.trainer,
            code: existing.code || base.code || null,
            department: existing.department || base.department || null,
            position: existing.position || base.position || null,
            specialization: existing.specialization || base.specialization || null,
            salary: Math.max(existing.salary || 0, base.salary || 0),
            branch_id: existing.branch_id || base.branch_id || null,
            branch_name: existing.branch_name || base.branch_name || null,
            is_active: existing.is_active || !!base.is_active,
            exit_date: existing.exit_date ?? base.exit_date ?? null,
            exit_type: existing.exit_type ?? base.exit_type ?? null,
            hire_date: existing.hire_date || base.hire_date || new Date().toISOString(),
            profile: existing.profile || base.profile,
            name: existing.name || base.name || 'Unknown',
            email: existing.email || base.email || null,
            phone: existing.phone || base.phone || null,
            avatar_url: existing.avatar_url || base.avatar_url || null,
          });
        }
      };

      (employees || []).forEach((emp: any) => {
        const key = emp.user_id || `emp-${emp.id}`;
        const p = emp.user_id ? profileMap.get(emp.user_id) : null;
        upsert(key, {
          key,
          user_id: emp.user_id,
          name: p?.full_name || 'Unknown',
          email: p?.email || null,
          phone: p?.phone || null,
          avatar_url: p?.avatar_url || null,
          profile: p || null,
          roles: [detectEmployeeRole(emp)],
          employee: emp,
          code: emp.employee_code,
          department: emp.department,
          position: emp.position,
          specialization: null,
          salary: Number(emp.salary || 0),
          branch_id: emp.branch_id,
          branch_name: (emp.branches as any)?.name || null,
          is_active: !!emp.is_active,
          exit_date: emp.exit_date || null,
          exit_type: emp.exit_type || null,
          hire_date: emp.hire_date,
        });
      });

      (trainers || []).forEach((t: any) => {
        const key = t.user_id || `tr-${t.id}`;
        const p = t.user_id ? profileMap.get(t.user_id) : null;
        upsert(key, {
          key,
          user_id: t.user_id,
          name: p?.full_name || 'Unknown',
          email: p?.email || null,
          phone: p?.phone || null,
          avatar_url: p?.avatar_url || null,
          profile: p || null,
          roles: ['trainer'],
          trainer: t,
          code: t.trainer_code || null,
          department: 'Training',
          position: 'Trainer',
          specialization: Array.isArray(t.specializations) ? t.specializations.join(', ') : null,
          salary: Number(t.fixed_salary || 0),
          branch_id: t.branch_id,
          branch_name: (t.branches as any)?.name || null,
          is_active: !!t.is_active,
          exit_date: t.exit_date || null,
          exit_type: t.exit_type || null,
          hire_date: t.created_at,
        });
      });

      return Array.from(map.values());
    },
  });
}
