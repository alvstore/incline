import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared TanStack Query options for unattended front-desk dashboards.
 * Auto-refetches every 5 min, refetches on tab focus, treats data as fresh for 1 min.
 */
export const DASHBOARD_QUERY_OPTIONS = {
  refetchOnWindowFocus: true,
  refetchInterval: 300_000,
  staleTime: 60_000,
  refetchIntervalInBackground: false,
} as const;

export interface BirthdayMember {
  member_id: string;
  user_id: string;
  member_code: string | null;
  full_name: string | null;
  avatar_url: string | null;
  dob: string;
  birthday_date: string;
  days_until: number;
  turning_age: number;
}

export interface BirthdayBuckets {
  today: BirthdayMember[];
  upcoming: BirthdayMember[];
}

export function useUpcomingBirthdays(
  branchId?: string | null,
  daysAhead = 7,
) {
  return useQuery<BirthdayBuckets>({
    queryKey: ['upcoming-birthdays', branchId ?? 'all', daysAhead],
    ...DASHBOARD_QUERY_OPTIONS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_upcoming_birthdays', {
        p_days_ahead: daysAhead,
        p_branch_id: branchId ?? null,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { today?: unknown; upcoming?: unknown }
        | null
        | undefined;
      return {
        today: (Array.isArray(row?.today) ? row!.today : []) as BirthdayMember[],
        upcoming: (Array.isArray(row?.upcoming) ? row!.upcoming : []) as BirthdayMember[],
      };
    },
  });
}

/**
 * Thin wrapper for ad-hoc dashboard queries that should adopt the shared
 * auto-refetch cadence without each call site re-spelling the options.
 */
export function dashboardQueryOptions<T>(
  extra: Partial<UseQueryOptions<T>> = {},
): Partial<UseQueryOptions<T>> {
  return { ...DASHBOARD_QUERY_OPTIONS, ...extra };
}
