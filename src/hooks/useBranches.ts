import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useBranches() {
  // Only authenticated users can read branches (RLS + GRANT both scoped to
  // authenticated). Anon visitors on the public landing page should not hit
  // this endpoint or they get a 42501 permission error flood.
  const { user } = useAuth();
  return useQuery({
    queryKey: ['branches', user?.id ?? 'anon'],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
    },
  });
}

export function useBranch(branchId: string) {
  return useQuery({
    queryKey: ['branch', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('id', branchId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!branchId,
  });
}

export function useUserBranch(userId: string) {
  return useQuery({
    queryKey: ['userBranch', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_branches')
        .select('branch_id, branches(*)')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });
}