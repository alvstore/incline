import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Returns true if the current authenticated user is a member that owns at
 * least one PT package (any status). Used to gate PT navigation items.
 */
export function useMemberHasPtPackage() {
  const { user, roles } = useAuth();
  const isMember = roles.some(r => r.role === 'member');

  const q = useQuery({
    queryKey: ['member-has-pt-package', user?.id],
    enabled: !!user && isMember,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: member } = await supabase
        .from('members')
        .select('id')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (!member?.id) return false;
      const { count } = await supabase
        .from('member_pt_packages')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', member.id);
      return (count ?? 0) > 0;
    },
  });

  return { hasPt: !!q.data, isLoading: q.isLoading };
}
