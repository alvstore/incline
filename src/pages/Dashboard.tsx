import { useState, lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { StatCardSkeleton } from '@/components/ui/table-skeleton';
import { Skeleton } from '@/components/ui/skeleton';

import { RevenueChart, AttendanceChart, MembershipDistribution, HourlyAttendanceChart, AccountsReceivableWidget, ExpiringMembersWidget, PendingApprovalsWidget } from '@/components/dashboard/DashboardCharts';
import { OccupancyGauge } from '@/components/dashboard/OccupancyGauge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { useBranchContext } from '@/contexts/BranchContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useInView } from '@/hooks/useInView';
import { 
  UserPlus, 
  Dumbbell, 
  Calendar,
  Activity,
  ClipboardList
} from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, differenceInHours } from 'date-fns';

// Lazy-load below-fold heavy components
const LazyLiveAccessLog = lazy(() => import('@/components/devices/LiveAccessLog'));
const LazyAIInsightsWidget = lazy(() => import('@/components/dashboard/AIInsightsWidget').then(m => ({ default: m.AIInsightsWidget })));
const LazyMemberVoiceWidget = lazy(() => import('@/components/dashboard/MemberVoiceWidget').then(m => ({ default: m.MemberVoiceWidget })));
const LazyMembersCountingChart = lazy(() => import('@/components/dashboard/MembersCountingChart'));
const LazyBirthdayWidget = lazy(() => import('@/components/dashboard/BirthdayWidget'));
import { MemberGrowthCards } from '@/components/dashboard/MemberGrowthCards';
import { JoinedSummaryStrip } from '@/components/dashboard/JoinedSummaryStrip';
import { DASHBOARD_QUERY_OPTIONS } from '@/hooks/useDashboardData';

function ChartSkeleton() {
  return <Skeleton className="h-64 rounded-2xl" />;
}

export default function DashboardPage() {
  const { profile, roles, user } = useAuth();
  const { selectedBranch, setSelectedBranch, branchFilter, branches } = useBranchContext();

  // InView hooks for below-fold sections
  const { ref: crmRef, inView: crmInView } = useInView();
  const { ref: bottomRef, inView: bottomInView } = useInView();
  const { ref: insightsRef, inView: insightsInView } = useInView();

  // Fetch dashboard statistics
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['dashboard-stats', branchFilter],
    enabled: !!user,
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = startOfMonth(new Date()).toISOString();
      const monthEnd = endOfMonth(new Date()).toISOString();

      // Members count
      let membersQuery = supabase.from('members').select('id, status', { count: 'exact' });
      if (branchFilter) membersQuery = membersQuery.eq('branch_id', branchFilter);
      const { count: totalMembers } = await membersQuery;

      let activeMembersQuery = supabase.from('members').select('id', { count: 'exact' }).eq('status', 'active');
      if (branchFilter) activeMembersQuery = activeMembersQuery.eq('branch_id', branchFilter);
      const { count: activeMembers } = await activeMembersQuery;

      // Frozen memberships count
      let frozenQuery = supabase.from('memberships').select('id', { count: 'exact' }).eq('status', 'frozen');
      if (branchFilter) frozenQuery = frozenQuery.eq('branch_id', branchFilter);
      const { count: frozenMemberships } = await frozenQuery;

      // Today's attendance
      let attendanceQuery = supabase.from('member_attendance').select('id', { count: 'exact' }).gte('check_in', today);
      if (branchFilter) attendanceQuery = attendanceQuery.eq('branch_id', branchFilter);
      const { count: todayCheckins } = await attendanceQuery;

      // Currently in gym
      let currentQuery = supabase.from('member_attendance').select('id', { count: 'exact' }).gte('check_in', today).is('check_out', null);
      if (branchFilter) currentQuery = currentQuery.eq('branch_id', branchFilter);
      const { count: currentlyIn } = await currentQuery;

      // Monthly revenue
      let paymentsQuery = supabase.from('payments').select('amount').gte('payment_date', monthStart).lte('payment_date', monthEnd);
      if (branchFilter) paymentsQuery = paymentsQuery.eq('branch_id', branchFilter);
      const { data: payments } = await paymentsQuery;
      const monthlyRevenue = payments?.reduce((sum, p) => sum + p.amount, 0) || 0;

      // Expiring memberships (next 7 days)
      const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      let expiringQuery = supabase.from('memberships').select('id', { count: 'exact' }).eq('status', 'active').lte('end_date', next7Days).gte('end_date', today);
      if (branchFilter) expiringQuery = expiringQuery.eq('branch_id', branchFilter);
      const { count: expiringMemberships } = await expiringQuery;

      // New leads this month
      let leadsQuery = supabase.from('leads').select('id', { count: 'exact' }).gte('created_at', monthStart);
      if (branchFilter) leadsQuery = leadsQuery.eq('branch_id', branchFilter);
      const { count: newLeads } = await leadsQuery;

      // Active trainers
      let trainersQuery = supabase.from('trainers').select('id', { count: 'exact' }).eq('is_active', true);
      if (branchFilter) trainersQuery = trainersQuery.eq('branch_id', branchFilter);
      const { count: activeTrainers } = await trainersQuery;

      // Today's classes
      let classesQuery = supabase.from('classes').select('id', { count: 'exact' }).gte('scheduled_at', today).lt('scheduled_at', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
      if (branchFilter) classesQuery = classesQuery.eq('branch_id', branchFilter);
      const { count: todayClasses } = await classesQuery;

      // Pending approvals
      let approvalsQuery = supabase.from('approval_requests').select('id', { count: 'exact' }).eq('status', 'pending');
      if (branchFilter) approvalsQuery = approvalsQuery.eq('branch_id', branchFilter);
      const { count: pendingApprovals } = await approvalsQuery;

      return {
        totalMembers: totalMembers || 0,
        activeMembers: activeMembers || 0,
        frozenMemberships: frozenMemberships || 0,
        todayCheckins: todayCheckins || 0,
        currentlyIn: currentlyIn || 0,
        monthlyRevenue,
        expiringMemberships: expiringMemberships || 0,
        newLeads: newLeads || 0,
        activeTrainers: activeTrainers || 0,
        todayClasses: todayClasses || 0,
        pendingApprovals: pendingApprovals || 0,
      };
    },
  });

  // Revenue chart data (last 6 months)
  const { data: revenueData = [] } = useQuery({
    queryKey: ['revenue-chart', branchFilter],
    enabled: !!user,
    queryFn: async () => {
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const date = subDays(new Date(), i * 30);
        const monthStart = startOfMonth(date).toISOString();
        const monthEnd = endOfMonth(date).toISOString();
        
        let query = supabase.from('payments').select('amount').gte('payment_date', monthStart).lte('payment_date', monthEnd);
        if (branchFilter) query = query.eq('branch_id', branchFilter);
        const { data } = await query;
        
        months.push({
          name: format(date, 'MMM'),
          revenue: data?.reduce((sum, p) => sum + p.amount, 0) || 0,
        });
      }
      return months;
    },
  });

  // Attendance chart data (last 7 days)
  const { data: attendanceData = [] } = useQuery({
    queryKey: ['attendance-chart', branchFilter],
    enabled: !!user,
    queryFn: async () => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = subDays(new Date(), i);
        const dayStart = date.toISOString().split('T')[0];
        const dayEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        let query = supabase.from('member_attendance').select('id', { count: 'exact' }).gte('check_in', dayStart).lt('check_in', dayEnd);
        if (branchFilter) query = query.eq('branch_id', branchFilter);
        const { count } = await query;
        
        days.push({
          name: format(date, 'EEE'),
          checkins: count || 0,
        });
      }
      return days;
    },
  });

  // Membership distribution
  const { data: membershipData = [] } = useQuery({
    queryKey: ['membership-distribution', branchFilter],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase.from('memberships').select('membership_plans(name)').eq('status', 'active');
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data } = await query;
      
      const counts: Record<string, number> = {};
      data?.forEach((m: any) => {
        const name = m.membership_plans?.name || 'Unknown';
        counts[name] = (counts[name] || 0) + 1;
      });
      
      return Object.entries(counts).map(([name, value]) => ({ name, value }));
    },
  });

  // Hourly attendance - only fetch when CRM section is visible
  const { data: hourlyAttendanceData = [] } = useQuery({
    queryKey: ['hourly-attendance', branchFilter],
    enabled: !!user && crmInView,
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      let query = supabase.from('member_attendance').select('check_in').gte('check_in', today);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data } = await query;

      const hourCounts: Record<number, number> = {};
      for (let i = 5; i <= 22; i++) hourCounts[i] = 0;

      data?.forEach((a: any) => {
        const hour = new Date(a.check_in).getHours();
        if (hour >= 5 && hour <= 22) {
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        }
      });

      return Object.entries(hourCounts).map(([hour, count]) => ({
        hour: `${hour}:00`,
        checkins: count,
      }));
    },
  });

  // Accounts Receivable - only fetch when CRM section is visible
  const { data: receivablesData } = useQuery({
    queryKey: ['accounts-receivable', branchFilter],
    enabled: !!user && crmInView,
    queryFn: async () => {
      // Include 'partial' (most common dues state) + 'sent' which is the
      // dispatched-but-unpaid state used by the billing engine. The owed>0
      // filter below ensures fully-paid rows never leak in.
      let query = supabase
        .from('invoices')
        .select('id, total_amount, amount_paid, status, member_id, members(member_code, user_id, profiles:user_id(full_name))')
        .in('status', ['pending', 'overdue', 'partial'])
        .order('total_amount', { ascending: false })
        .limit(20);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data } = await query;
      const items = (data || [])
        .map((inv: any) => ({
          id: inv.id,
          memberName: inv.members?.profiles?.full_name || 'Unknown',
          memberCode: inv.members?.member_code || '',
          owed: (inv.total_amount || 0) - (inv.amount_paid || 0),
          status: inv.status,
        }))
        .filter((r: any) => r.owed > 0)
        .slice(0, 5);
      const totalOutstanding = items.reduce((sum: number, r: any) => sum + r.owed, 0);
      return { items, totalOutstanding };
    },
  });

  // Expiring in 48 hours - only fetch when CRM section is visible
  const { data: expiringMembers = [] } = useQuery({
    queryKey: ['expiring-48h', branchFilter],
    enabled: !!user && crmInView,
    queryFn: async () => {
      const now = new Date();
      const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const today = now.toISOString().split('T')[0];

      let query = supabase
        .from('memberships')
        .select('id, end_date, member_id, members(member_code, profiles:user_id(full_name)), membership_plans(name)')
        .eq('status', 'active')
        .gte('end_date', today)
        .lte('end_date', in48h)
        .limit(5);

      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data } = await query;

      return (data || []).map((m: any) => ({
        memberId: m.member_id,
        memberCode: m.members?.member_code,
        memberName: m.members?.profiles?.full_name || 'Unknown',
        hoursRemaining: differenceInHours(new Date(m.end_date), now),
        planName: m.membership_plans?.name || 'N/A',
      }));
    },
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Welcome back, {profile?.full_name?.split(' ')[0] || 'Admin'}!
            </h1>
            <p className="text-muted-foreground">
              Here's what's happening at your gym today
            </p>
          </div>
        </div>

        {/* Hero Gradient Card */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl shadow-lg shadow-primary/20 p-6 text-primary-foreground">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Gym Health</h2>
              <p className="text-primary-foreground/70 text-sm mt-1">Real-time overview of your business</p>
            </div>
            <div className="grid grid-cols-3 gap-8">
              <div className="text-center">
                <p className="text-3xl font-bold">{stats?.totalMembers || 0}</p>
                <p className="text-primary-foreground/70 text-xs mt-1">Total Members</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold">₹{(stats?.monthlyRevenue || 0).toLocaleString()}</p>
                <p className="text-primary-foreground/70 text-xs mt-1">Revenue This Month</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold">{stats?.expiringMemberships || 0}</p>
                {(stats?.expiringMemberships || 0) > 0 && (
                  <Badge className="bg-destructive text-destructive-foreground text-xs mt-1 border-0">Action Needed</Badge>
                )}
                <p className="text-primary-foreground/70 text-xs mt-1">Expiring Soon</p>
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Stats Row */}
        {/* Member Growth KPI Cards */}
        <MemberGrowthCards branchFilter={branchFilter} />

        {/* Secondary Stats Row */}
        {statsLoading ? (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <StatCard
              title="New Leads"
              value={stats?.newLeads || 0}
              icon={UserPlus}
              description="This month"
              variant="info"
            />
            <StatCard
              title="Active Trainers"
              value={stats?.activeTrainers || 0}
              icon={Dumbbell}
              variant="default"
            />
            <StatCard
              title="Today's Classes"
              value={stats?.todayClasses || 0}
              icon={Calendar}
              variant="accent"
            />
            <StatCard
              title="Pending Approvals"
              value={stats?.pendingApprovals || 0}
              icon={ClipboardList}
              variant="warning"
            />
          </div>
        )}

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2">
          <RevenueChart data={revenueData} />
          <AttendanceChart data={attendanceData} />
        </div>

        {/* Members Counting + Joined Summary */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <Suspense fallback={<ChartSkeleton />}>
              <LazyMembersCountingChart branchFilter={branchFilter} />
            </Suspense>
          </div>
          <JoinedSummaryStrip branchFilter={branchFilter} />
        </div>

        {/* CRM Widgets Row — lazy loaded */}
        <div ref={crmRef} className="grid gap-6 md:grid-cols-4">
          {crmInView ? (
            <>
              <OccupancyGauge currentlyIn={stats?.currentlyIn || 0} capacity={branches?.find(b => b.id === branchFilter)?.capacity || 50} />
              <HourlyAttendanceChart data={hourlyAttendanceData} />
              <AccountsReceivableWidget
                data={receivablesData?.items || []}
                totalOutstanding={receivablesData?.totalOutstanding || 0}
              />
              <ExpiringMembersWidget data={expiringMembers} />
            </>
          ) : (
            <>
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
            </>
          )}
        </div>

        {/* Bottom Row — lazy loaded */}
        <div ref={bottomRef} className="grid gap-6 md:grid-cols-3">
          {bottomInView ? (
            <>
              <MembershipDistribution data={membershipData} />
              <Card className="shadow-lg rounded-2xl border-0 md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-success" />
                    Live Access Feed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Suspense fallback={<ChartSkeleton />}>
                    <LazyLiveAccessLog />
                  </Suspense>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <ChartSkeleton />
              <Skeleton className="h-64 rounded-2xl md:col-span-2" />
            </>
          )}
        </div>

        {/* AI Insights + Member Voice — lazy loaded */}
        <div ref={insightsRef} className="grid gap-6 md:grid-cols-2">
          {insightsInView ? (
            <Suspense fallback={<><ChartSkeleton /><ChartSkeleton /></>}>
              <LazyAIInsightsWidget branchId={branchFilter} />
              <LazyMemberVoiceWidget />
            </Suspense>
          ) : (
            <>
              <ChartSkeleton />
              <ChartSkeleton />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
