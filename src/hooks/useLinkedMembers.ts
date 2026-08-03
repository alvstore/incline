import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LinkedMember {
  id: string;
  member_code: string | null;
  full_name: string | null;
}

/**
 * Resolve display info (name + code) for members linked to the given tasks so
 * task cards can show "Mohit Gurjar · INC-26-0025" instead of a bare code.
 */
export function useLinkedMembers(tasks: any[]) {
  const memberIds = [
    ...new Set(
      (tasks || [])
        .filter((t) => t?.linked_entity_type === 'member' && t?.linked_entity_id)
        .map((t) => t.linked_entity_id as string),
    ),
  ].sort();

  const { data } = useQuery<Record<string, LinkedMember>>({
    queryKey: ['task-linked-members', memberIds.join(',')],
    enabled: memberIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: members, error } = await supabase
        .from('members')
        .select('id, member_code, user_id')
        .in('id', memberIds);
      if (error) throw error;

      const userIds = (members || []).map((m) => m.user_id).filter(Boolean) as string[];
      let profiles: { id: string; full_name: string | null }[] = [];
      if (userIds.length > 0) {
        const { data: p } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        profiles = p || [];
      }

      const map: Record<string, LinkedMember> = {};
      (members || []).forEach((m) => {
        map[m.id] = {
          id: m.id,
          member_code: m.member_code,
          full_name: profiles.find((p) => p.id === m.user_id)?.full_name ?? null,
        };
      });
      return map;
    },
  });

  return data || {};
}
