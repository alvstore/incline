import { useQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface MemberIdentityHeaderProps {
  memberId: string;
  /** Fallback name shown while the record loads. */
  memberName?: string;
  /** Optional line of context under the name (e.g. current plan). */
  subtitle?: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-600',
  suspended: 'bg-amber-100 text-amber-700',
  blacklisted: 'bg-red-100 text-red-700',
};

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

/**
 * Identity strip shown at the top of member-scoped drawers (purchase, upgrade,
 * add-on) so staff always see who the transaction belongs to.
 */
export function MemberIdentityHeader({
  memberId,
  memberName,
  subtitle,
  className = '',
}: MemberIdentityHeaderProps) {
  const { data, isLoading } = useMemberIdentity(memberId);

  const name = data?.full_name || memberName || 'Member';
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 ${className}`}
    >
      {isLoading && !data ? (
        <Skeleton className="h-12 w-12 rounded-full" />
      ) : (
        <Avatar className="h-12 w-12">
          <AvatarImage src={data?.avatar_url || undefined} alt={name} />
          <AvatarFallback className="text-sm font-semibold">{initials}</AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-slate-900">{name}</p>
          {data?.status && (
            <Badge
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium border-0 ${
                STATUS_STYLES[data.status] || 'bg-slate-100 text-slate-600'
              }`}
            >
              {data.status}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-slate-500">
          {data?.member_code ? data.member_code : isLoading ? 'Loading…' : ''}
          {subtitle ? `${data?.member_code ? ' · ' : ''}${subtitle}` : ''}
        </p>
      </div>
    </div>
  );
}
