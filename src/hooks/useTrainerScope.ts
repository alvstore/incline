import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';

/**
 * Trainer-only scope for class screens. A trainer without schedule-management
 * capability sees and edits only their own classes.
 * Branch setting `trainer_class_self_manage` (default ON): off = view-only.
 */
export function useTrainerScope(branchId?: string | null) {
  const { user, roles } = useAuth();
  const isTrainer = (roles || []).some((r: any) => (r?.role ?? r) === 'trainer');
  const isTrainerOnly = isTrainer && !can.manageClassSchedule(roles);

  const { data: trainerId = null } = useQuery({
    queryKey: ['my-trainer-id', user?.id],
    enabled: isTrainerOnly && !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('trainers').select('id').eq('user_id', user!.id).limit(1).maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
  });

  const { data: selfManage = true } = useQuery({
    queryKey: ['settings', 'trainer_class_self_manage', branchId],
    enabled: isTrainerOnly && !!branchId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value, branch_id')
        .eq('key', 'trainer_class_self_manage')
        .or(`branch_id.eq.${branchId},branch_id.is.null`);
      if (error || !data?.length) return true;
      const row = data.find((r) => r.branch_id === branchId) ?? data[0];
      const v = row?.value as unknown;
      return !(v === false || v === 'false' || (typeof v === 'object' && v !== null && (v as { enabled?: boolean }).enabled === false));
    },
  });

  return { isTrainerOnly, trainerId, canSelfManage: isTrainerOnly && selfManage && !!trainerId };
}
