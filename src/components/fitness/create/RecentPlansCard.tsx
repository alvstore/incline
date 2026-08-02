import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Dumbbell, UtensilsCrossed, Sparkles, ChevronRight } from 'lucide-react';
import { fetchMemberAssignments } from '@/services/fitnessService';
import { useBranchContext } from '@/contexts/BranchContext';

/**
 * The five most recent member plan assignments, so repeat work (build the next
 * block for the same member) starts one click away instead of from scratch.
 */
export function RecentPlansCard() {
  const navigate = useNavigate();
  const { effectiveBranchId } = useBranchContext();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['fitness-recent-assignments', effectiveBranchId],
    queryFn: () => fetchMemberAssignments(effectiveBranchId ?? null),
    staleTime: 60 * 1000,
  });

  const rows = (data ?? []).slice(0, 5);

  if (isError) return null;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/60 ring-1 ring-border">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recently assigned
          </h2>
          <button
            onClick={() => navigate('/fitness/member-plans')}
            className="flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No plans assigned yet — create your first one above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex min-h-[52px] flex-wrap items-center gap-3 py-2.5"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    r.plan_type === 'workout'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-emerald-500/10 text-emerald-600'
                  }`}
                  aria-hidden
                >
                  {r.plan_type === 'workout' ? (
                    <Dumbbell className="h-4 w-4" />
                  ) : (
                    <UtensilsCrossed className="h-4 w-4" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.plan_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.member_name}
                    {r.member_code ? ` · ${r.member_code}` : ''}
                    {r.valid_from ? ` · from ${r.valid_from}` : ''}
                  </p>
                </div>

                {r.is_expired && (
                  <Badge className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted">
                    Expired
                  </Badge>
                )}

                <button
                  onClick={() =>
                    navigate(
                      `/fitness/create/ai?memberId=${r.member_id}&memberName=${encodeURIComponent(
                        r.member_name || '',
                      )}&memberCode=${encodeURIComponent(r.member_code || '')}&type=${r.plan_type}`,
                    )
                  }
                  aria-label={`Create a new ${r.plan_type} plan for ${r.member_name}`}
                  className="flex min-h-[36px] cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-primary ring-1 ring-border transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  New plan
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
