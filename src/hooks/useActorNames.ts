import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resolve auth user ids (created_by / added_by / granted_by / received_by …)
 * into display names for audit trails.
 */
export function useActorNames(ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter(Boolean) as string[])).sort();

  const query = useQuery<Record<string, string>>({
    queryKey: ['actor-names', unique],
    enabled: unique.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', unique);
      if (error) return {};
      return Object.fromEntries((data || []).map((p) => [p.id, p.full_name || '']));
    },
  });

  const map = query.data || {};
  const nameOf = (id: string | null | undefined) =>
    (id ? map[id] : null) || null;

  return { nameOf, isLoading: query.isLoading };
}
