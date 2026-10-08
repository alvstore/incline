import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MemberIdentity {
  member_code: string | null;
  status: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

/** Shared, cached identity lookup so drawers never re-fetch (or flash) the avatar. */
export function useMemberIdentity(memberId?: string) {
  return useQuery<MemberIdentity | null>({
    queryKey: ['member-identity', memberId],
    enabled: !!memberId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select(
          'member_code, status, profiles:user_id(full_name, avatar_url), lead:lead_id(full_name, avatar_url)',
        )
        .eq('id', memberId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const p: any = (data as any).profiles || (data as any).lead || {};
      return {
        member_code: (data as any).member_code ?? null,
        status: (data as any).status ?? null,
        full_name: p.full_name ?? null,
        avatar_url: p.avatar_url ?? null,
      };
    },
  });
}
