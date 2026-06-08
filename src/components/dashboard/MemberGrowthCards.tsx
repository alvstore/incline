import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, UserPlus, Eye, ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react';
import { startOfMonth, subMonths, subDays, format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  branchFilter: string | null;
}

interface Metric {
  current: number;
  previous: number;
}

async function countMembers(branchFilter: string | null, opts: { status?: string; createdGte?: string; createdLt?: string } = {}) {
  let q = supabase.from('members').select('id', { count: 'exact', head: true });
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  if (opts.status) q = q.eq('status', opts.status as any);
  if (opts.createdGte) q = q.gte('created_at', opts.createdGte);
  if (opts.createdLt) q = q.lt('created_at', opts.createdLt);
  const { count } = await q;
  return count ?? 0;
}

async function countAttendance(branchFilter: string | null, gte: string, lt: string) {
  let q = supabase.from('member_attendance').select('id', { count: 'exact', head: true }).gte('check_in', gte).lt('check_in', lt);
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  const { count } = await q;
  return count ?? 0;
}

export function MemberGrowthCards({ branchFilter }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['member-growth-kpis', branchFilter],
    queryFn: async () => {
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString();
      const prevMonthStart = startOfMonth(subMonths(now, 1)).toISOString();
      const thirtyAgo = subDays(now, 30).toISOString();
      const sixtyAgo = subDays(now, 60).toISOString();
      const todayStart = format(now, 'yyyy-MM-dd');
      const tomorrowStart = format(subDays(now, -1), 'yyyy-MM-dd');
      const lastWeekDay = format(subDays(now, 7), 'yyyy-MM-dd');
      const lastWeekDayPlus = format(subDays(now, 6), 'yyyy-MM-dd');

      const [currentActive, prevActive, newThis, newPrev, todayVis, lastWeekVis] = await Promise.all([
        countMembers(branchFilter, { status: 'active' }),
        // proxy: members created before 30d ago and still active is harder; use total active minus joined-last-30 as previous
        countMembers(branchFilter, { status: 'active', createdLt: thirtyAgo }),
        countMembers(branchFilter, { createdGte: monthStart }),
        countMembers(branchFilter, { createdGte: prevMonthStart, createdLt: monthStart }),
        countAttendance(branchFilter, todayStart, tomorrowStart),
        countAttendance(branchFilter, lastWeekDay, lastWeekDayPlus),
      ]);

      return {
        currentMembers: { current: currentActive, previous: prevActive } as Metric,
        newMembers: { current: newThis, previous: newPrev } as Metric,
        todayVisitors: { current: todayVis, previous: lastWeekVis } as Metric,
      };
    },
    enabled: true,
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
      <GrowthCard title="Current Members" value={data.currentMembers.current} previous={data.currentMembers.previous} icon={Users} subtitle="Active memberships" />
      <GrowthCard title="New Members" value={data.newMembers.current} previous={data.newMembers.previous} icon={UserPlus} subtitle="This month" />
      <GrowthCard title="Today's Visitors" value={data.todayVisitors.current} previous={data.todayVisitors.previous} icon={Eye} subtitle="vs same day last week" />
    </div>
  );
}

function GrowthCard({ title, value, previous, icon: Icon, subtitle }: { title: string; value: number; previous: number; icon: LucideIcon; subtitle: string }) {
  const diff = value - previous;
  const pct = previous > 0 ? (diff / previous) * 100 : value > 0 ? 100 : 0;
  const isUp = diff >= 0;
  const DeltaIcon = isUp ? ArrowUp : ArrowDown;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-primary/5 hover:shadow-xl hover:shadow-primary/10 transition-all duration-200">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-4xl font-bold tracking-tight text-foreground tabular-nums">{value.toLocaleString()}</p>
          </div>
          <div className="rounded-full bg-primary/10 text-primary p-2.5">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className={cn('flex items-center gap-1 text-xs font-semibold', isUp ? 'text-success dark:text-success' : 'text-destructive')}>
            <DeltaIcon className="h-3.5 w-3.5" />
            <span>{isUp ? '+' : ''}{diff.toLocaleString()}</span>
            <span className="opacity-80">({isUp ? '+' : ''}{pct.toFixed(2)}%)</span>
          </div>
          <span className="text-[11px] text-muted-foreground">{subtitle}</span>
        </div>
      </CardContent>
    </Card>
  );
}
