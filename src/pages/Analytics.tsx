import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, CreditCard, TrendingUp, Calendar, AlertCircle, DollarSign, ShoppingBag, Package, ArrowUp, ArrowDown, Dumbbell, Trophy, Award, Clock, Activity, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { format, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, getDay, subDays, addDays } from 'date-fns';
import { analyticsService } from '@/services/analyticsService';
import { useState } from 'react';
import { ResponsiveSheet, ResponsiveSheetHeader, ResponsiveSheetTitle, ResponsiveSheetDescription } from '@/components/ui/ResponsiveSheet';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  PieChart as RechartsPie,
  Pie,
  Cell,
} from 'recharts';

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AnalyticsPage() {
  const { branchFilter } = useBranchContext();

  const { data: stats } = useQuery({
    queryKey: ['analytics-stats', branchFilter],
    queryFn: async () => {
      let membersQ = supabase.from('members').select('id', { count: 'exact', head: true });
      let paymentsQ = supabase.from('payments').select('amount').eq('status', 'completed');
      let invoicesQ = supabase.from('invoices').select('total_amount, amount_paid, status');
      if (branchFilter) {
        membersQ = membersQ.eq('branch_id', branchFilter);
        paymentsQ = paymentsQ.eq('branch_id', branchFilter);
        invoicesQ = invoicesQ.eq('branch_id', branchFilter);
      }
      const [membersRes, paymentsRes, invoicesRes] = await Promise.all([membersQ, paymentsQ, invoicesQ]);
      const totalRevenue = paymentsRes.data?.reduce((sum, p) => sum + p.amount, 0) || 0;
      const pendingAmount = invoicesRes.data
        ?.filter((i: any) => i.status === 'pending' || i.status === 'partial' || i.status === 'overdue')
        .reduce((sum, i) => sum + ((i.total_amount || 0) - (i.amount_paid || 0)), 0) || 0;
      return { totalMembers: membersRes.count || 0, totalRevenue, pendingAmount };
    },
    refetchInterval: 60000,
  });

  const { data: totalExpenses = 0 } = useQuery({
    queryKey: ['analytics-total-expenses', branchFilter],
    queryFn: async () => {
      let q = supabase.from('expenses').select('amount').eq('status', 'approved');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      return data?.reduce((sum, e) => sum + e.amount, 0) || 0;
    },
  });

  const { data: revenueByMonth = [], isLoading: revenueLoading } = useQuery({
    queryKey: ['analytics-revenue-by-month', branchFilter],
    queryFn: async () => {
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const date = subMonths(new Date(), i);
        const monthStart = startOfMonth(date).toISOString();
        const monthEnd = endOfMonth(date).toISOString();
        let q = supabase.from('payments').select('amount').gte('payment_date', monthStart).lte('payment_date', monthEnd).eq('status', 'completed');
        if (branchFilter) q = q.eq('branch_id', branchFilter);
        const { data } = await q;
        months.push({
          name: format(date, 'MMM'),
          fullMonth: format(date, 'MMM yyyy'),
          revenue: data?.reduce((sum, p) => sum + p.amount, 0) || 0,
        });
      }
      return months;
    },
  });

  const { data: memberGrowth = [], isLoading: growthLoading } = useQuery({
    queryKey: ['analytics-member-growth', branchFilter],
    queryFn: async () => {
      let q = supabase.from('members').select('created_at').order('created_at');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      if (!data || data.length === 0) return [];
      const grouped = data.reduce((acc: Record<string, number>, m) => {
        const month = format(new Date(m.created_at), 'yyyy-MM');
        acc[month] = (acc[month] || 0) + 1;
        return acc;
      }, {});
      let cumulative = 0;
      return Object.entries(grouped).slice(-12).map(([month, count]) => {
        cumulative += count as number;
        return { name: format(new Date(month + '-01'), 'MMM yy'), newMembers: count as number, totalMembers: cumulative };
      });
    },
  });

  const { data: memberStatusData = [] } = useQuery({
    queryKey: ['analytics-member-status', branchFilter],
    queryFn: async () => {
      let q = supabase.from('memberships').select('status, branch_id');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      if (!data || data.length === 0) return [];
      const counts: Record<string, number> = {};
      data.forEach((m: any) => { const s = m.status || 'unknown'; counts[s] = (counts[s] || 0) + 1; });
      const colorMap: Record<string, string> = {
        active: 'hsl(var(--success))', expired: 'hsl(var(--destructive))',
        frozen: 'hsl(var(--info))', cancelled: 'hsl(var(--warning))',
      };
      return Object.entries(counts).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1), value,
        fill: colorMap[name] || 'hsl(var(--muted-foreground))',
      }));
    },
  });

  const { data: revenueByPlan = [], isLoading: planLoading } = useQuery({
    queryKey: ['analytics-revenue-by-plan', branchFilter],
    queryFn: async () => {
      let q = supabase.from('memberships').select('price_paid, membership_plans(name), branch_id');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      if (!data || data.length === 0) return [];
      const grouped = data.reduce((acc: Record<string, number>, m: any) => {
        const planName = m.membership_plans?.name || 'Other';
        acc[planName] = (acc[planName] || 0) + (m.price_paid || 0);
        return acc;
      }, {});
      return Object.entries(grouped)
        .map(([name, value], index) => ({ name, value, fill: CHART_COLORS[index % CHART_COLORS.length] }))
        .sort((a, b) => b.value - a.value).slice(0, 5);
    },
  });

  const { data: weeklyEarnings = [] } = useQuery({
    queryKey: ['analytics-weekly-earnings', branchFilter],
    queryFn: async () => {
      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString();
      let q = supabase.from('payments').select('amount, payment_date').gte('payment_date', weekStart).lte('payment_date', weekEnd).eq('status', 'completed');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      const dayTotals: number[] = [0, 0, 0, 0, 0, 0, 0];
      data?.forEach((p) => {
        const d = getDay(new Date(p.payment_date));
        const idx = d === 0 ? 6 : d - 1;
        dayTotals[idx] += p.amount;
      });
      return DAY_NAMES.map((name, i) => ({ name, earnings: dayTotals[i] }));
    },
  });

  const { data: popularProducts = [] } = useQuery({
    queryKey: ['analytics-popular-products'],
    queryFn: async () => {
      const { data: items } = await supabase
        .from('invoice_items')
        .select('reference_id, quantity, description, unit_price')
        .eq('reference_type', 'product');
      if (!items || items.length === 0) return [];
      const grouped: Record<string, { name: string; price: number; qty: number }> = {};
      items.forEach((item) => {
        const key = item.reference_id || item.description;
        if (!grouped[key]) grouped[key] = { name: item.description, price: item.unit_price, qty: 0 };
        grouped[key].qty += item.quantity || 1;
      });
      return Object.values(grouped).sort((a, b) => b.qty - a.qty).slice(0, 5);
    },
  });

  // PT Analytics
  const { data: ptStats } = useQuery({
    queryKey: ['analytics-pt-stats', branchFilter],
    queryFn: async () => {
      let q = supabase.from('member_pt_packages').select('id, price_paid, trainer_id, status, trainers(user_id)');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      if (!data || data.length === 0) return { totalRevenue: 0, activePackages: 0, totalSold: 0, topTrainer: null, trainerStats: [] };

      const totalRevenue = data.reduce((sum, p) => sum + (p.price_paid || 0), 0);
      const activePackages = data.filter((p: any) => p.status === 'active').length;
      const totalSold = data.length;

      // Group by trainer
      const trainerMap: Record<string, { revenue: number; clients: number; userId: string | null }> = {};
      data.forEach((p: any) => {
        const tid = p.trainer_id || 'unknown';
        if (!trainerMap[tid]) trainerMap[tid] = { revenue: 0, clients: 0, userId: (p.trainers as any)?.user_id || null };
        trainerMap[tid].revenue += p.price_paid || 0;
        trainerMap[tid].clients += 1;
      });

      const trainerStats = Object.entries(trainerMap)
        .map(([id, s]) => ({ trainerId: id, ...s }))
        .sort((a, b) => b.revenue - a.revenue);

      // Resolve top trainer name
      let topTrainer: { name: string; revenue: number; clients: number } | null = null;
      if (trainerStats.length > 0 && trainerStats[0].userId) {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', trainerStats[0].userId).maybeSingle();
        topTrainer = { name: profile?.full_name || 'Unknown', revenue: trainerStats[0].revenue, clients: trainerStats[0].clients };
      }

      // Resolve all trainer names for the chart
      const userIds = trainerStats.map(t => t.userId).filter(Boolean) as string[];
      let profilesMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p.full_name || 'Unknown'; return acc; }, {} as Record<string, string>);
      }

      const resolvedTrainerStats = trainerStats.slice(0, 5).map(t => ({
        name: t.userId ? (profilesMap[t.userId] || 'Unknown') : 'Unknown',
        revenue: t.revenue,
        clients: t.clients,
      }));

      return { totalRevenue, activePackages, totalSold, topTrainer, trainerStats: resolvedTrainerStats };
    },
  });

  const { data: storeOrders = [] } = useQuery({
    queryKey: ['analytics-store-orders', branchFilter],
    queryFn: async () => {
      let q = supabase
        .from('invoices')
        .select('id, invoice_number, total_amount, status, created_at, member_id, members(member_code, profiles:user_id(full_name))')
        .not('pos_sale_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      return data || [];
    },
  });

  // Footfall Heatmap: check-ins per day-of-week (0=Mon) x hour for past 90 days
  const { data: footfallData = [], isLoading: footfallLoading } = useQuery({
    queryKey: ['analytics-footfall', branchFilter],
    queryFn: async () => {
      const since = subDays(new Date(), 90).toISOString();
      let q = supabase.from('member_attendance').select('check_in').gte('check_in', since);
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      // Build map: [dayOfWeek][hour] = count  (dayOfWeek 0=Mon..6=Sun)
      const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
      data?.forEach((row) => {
        const d = new Date(row.check_in);
        const jsDay = d.getDay(); // 0=Sun
        const dayIdx = jsDay === 0 ? 6 : jsDay - 1; // Mon=0..Sun=6
        const hour = d.getHours();
        grid[dayIdx][hour]++;
      });
      return grid;
    },
  });

  // Upcoming renewals: active memberships expiring within 30 days
  const { data: renewalData, isLoading: renewalLoading } = useQuery({
    queryKey: ['analytics-renewals', branchFilter],
    queryFn: async () => {
      const today = new Date();
      const in30 = addDays(today, 30).toISOString().split('T')[0];
      const todayStr = today.toISOString().split('T')[0];
      let q = supabase
        .from('memberships')
        .select('id, end_date, member_id, members(profiles:user_id(full_name))')
        .eq('status', 'active')
        .gte('end_date', todayStr)
        .lte('end_date', in30)
        .order('end_date');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      type RenewalRow = {
        id: string;
        end_date: string;
        member_id: string;
        members: { profiles: { full_name: string | null } | null } | null;
      };
      const members = ((data as unknown as RenewalRow[]) || []).map((m) => ({
        id: m.id,
        name: m.members?.profiles?.full_name || 'Unknown',
        endDate: m.end_date,
      }));
      const in7 = addDays(today, 7).toISOString().split('T')[0];
      const in14 = addDays(today, 14).toISOString().split('T')[0];
      return {
        all: members,
        bucket7: members.filter((m) => m.endDate <= in7),
        bucket14: members.filter((m) => m.endDate <= in14),
        bucket30: members,
      };
    },
  });

  // Avg session duration per day for last 14 days
  const { data: sessionDurationData = [], isLoading: sessionLoading } = useQuery({
    queryKey: ['analytics-session-duration', branchFilter],
    queryFn: async () => {
      const since = subDays(new Date(), 14).toISOString();
      let q = supabase
        .from('member_attendance')
        .select('check_in, check_out')
        .gte('check_in', since)
        .not('check_out', 'is', null);
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data } = await q;
      if (!data || data.length === 0) return [];
      // Group by date, compute average duration in minutes
      const byDay: Record<string, { total: number; count: number }> = {};
      data.forEach((row) => {
        const dateKey = row.check_in.split('T')[0];
        const durationMs = new Date(row.check_out!).getTime() - new Date(row.check_in).getTime();
        const durationMin = durationMs / 60000;
        if (durationMin <= 0 || durationMin > 480) return; // skip bad data
        if (!byDay[dateKey]) byDay[dateKey] = { total: 0, count: 0 };
        byDay[dateKey].total += durationMin;
        byDay[dateKey].count++;
      });
      return Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, { total, count }]) => ({
          date: format(new Date(date), 'dd MMM'),
          avgMinutes: Math.round(total / count),
        }));
    },
  });

  const [renewalDialog, setRenewalDialog] = useState<{ open: boolean; bucket: string; members: { id: string; name: string; endDate: string }[] }>({
    open: false, bucket: '', members: [],
  });

  const HEATMAP_HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM to 9 PM
  const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const footfallMax = footfallData.length > 0
    ? Math.max(...footfallData.flatMap((row) => HEATMAP_HOURS.map((h) => row[h])))
    : 1;

  const formatCurrency = (value: number) => `₹${value.toLocaleString()}`;
  const collectionRate = stats?.totalRevenue && stats?.pendingAmount
    ? Math.round((stats.totalRevenue / (stats.totalRevenue + stats.pendingAmount)) * 100) : 0;
  const netProfit = (stats?.totalRevenue || 0) - totalExpenses;
  const activeMemberships = memberStatusData.find(s => s.name === 'Active')?.value || 0;
  const totalMemberships = memberStatusData.reduce((s, d) => s + d.value, 0);
  const retentionRate = totalMemberships > 0 ? Math.round((activeMemberships / totalMemberships) * 100) : 0;
  const weeklyTotal = weeklyEarnings.reduce((s, d) => s + d.earnings, 0);
  const totalProductsSold = popularProducts.reduce((s, p) => s + p.qty, 0);

  const ordersByStatus = (status: string) => {
    const statusMap: Record<string, string[]> = {
      new: ['pending', 'draft'],
      processing: ['partial', 'overdue'],
      completed: ['paid'],
    };
    return storeOrders.filter((o: any) => (statusMap[status] || []).includes(o.status));
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Hero Gradient Card */}
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl shadow-lg shadow-primary/20 p-6 text-primary-foreground">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Gym Analytics</h1>
              <p className="text-primary-foreground/70 text-sm mt-1">Complete business performance insights</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              <div className="text-center">
                <p className="text-3xl font-bold">{stats?.totalMembers || 0}</p>
                <p className="text-primary-foreground/70 text-xs mt-1">Total Members</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold">₹{((stats?.totalRevenue || 0) / 1000).toFixed(0)}k</p>
                <p className="text-primary-foreground/70 text-xs mt-1">Total Revenue</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold">{collectionRate}%</p>
                <p className="text-primary-foreground/70 text-xs mt-1">Collection Rate</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold">₹{((stats?.pendingAmount || 0) / 1000).toFixed(0)}k</p>
                {(stats?.pendingAmount || 0) > 0 && <Badge className="bg-destructive text-destructive-foreground text-xs mt-1">Due</Badge>}
                <p className="text-primary-foreground/70 text-xs mt-1">Pending Dues</p>
              </div>
            </div>
          </div>
        </div>

        {/* Earning Reports + Member Retention */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Earning Reports
              </CardTitle>
              <CardDescription>Revenue trends over the last 12 months</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                {revenueLoading ? (
                  <div className="h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
                ) : revenueByMonth.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueByMonth}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: number) => [formatCurrency(value), 'Revenue']} labelFormatter={(label, payload) => payload[0]?.payload?.fullMonth || label} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground"><div className="text-center"><CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No revenue data yet</p></div></div>
                )}
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground font-medium">Earnings</span>
                    <span className="font-bold text-foreground">{formatCurrency(stats?.totalRevenue || 0)}</span>
                  </div>
                  <Progress value={100} className="h-2 [&>div]:bg-primary" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground font-medium">Profit</span>
                    <span className="font-bold text-success">{formatCurrency(netProfit)}</span>
                  </div>
                  <Progress value={stats?.totalRevenue ? (netProfit / stats.totalRevenue) * 100 : 0} className="h-2 [&>div]:bg-success" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground font-medium">Expenses</span>
                    <span className="font-bold text-warning">{formatCurrency(totalExpenses)}</span>
                  </div>
                  <Progress value={stats?.totalRevenue ? (totalExpenses / stats.totalRevenue) * 100 : 0} className="h-2 [&>div]:bg-warning" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Member Retention
              </CardTitle>
              <CardDescription>Membership status distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[220px] relative">
                {memberStatusData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPie>
                        <Pie data={memberStatusData} cx="50%" cy="50%" innerRadius={65} outerRadius={95} paddingAngle={3} dataKey="value">
                          {memberStatusData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                        </Pie>
                        <Tooltip formatter={(value: number) => [value, 'Members']} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                      </RechartsPie>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-foreground">{retentionRate}%</p>
                        <p className="text-xs text-muted-foreground">Active</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground"><div className="text-center"><Users className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No membership data yet</p></div></div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {memberStatusData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.fill }} />
                    <span className="text-xs text-muted-foreground">{entry.name}</span>
                    <span className="text-xs font-bold text-foreground ml-auto">{entry.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Weekly Earnings + Popular Products + Recent Store Orders */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                Weekly Earnings
              </CardTitle>
              <CardDescription>This week's daily revenue</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyEarnings}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => [formatCurrency(value), 'Earnings']} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                    <Bar dataKey="earnings" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-success/10 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-success" /></div>
                    <div><p className="text-sm font-medium text-foreground">Net Profit</p><p className="text-xs text-muted-foreground">Weekly income - expenses</p></div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{formatCurrency(weeklyTotal - (totalExpenses / 4))}</p>
                    <span className="text-xs text-success flex items-center gap-0.5 justify-end"><ArrowUp className="h-3 w-3" />Net</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center"><DollarSign className="h-4 w-4 text-primary" /></div>
                    <div><p className="text-sm font-medium text-foreground">Total Income</p><p className="text-xs text-muted-foreground">Payments collected</p></div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{formatCurrency(weeklyTotal)}</p>
                    <span className="text-xs text-success flex items-center gap-0.5 justify-end"><ArrowUp className="h-3 w-3" />Income</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center"><AlertCircle className="h-4 w-4 text-warning" /></div>
                    <div><p className="text-sm font-medium text-foreground">Total Expenses</p><p className="text-xs text-muted-foreground">Approved expenses</p></div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{formatCurrency(totalExpenses)}</p>
                    <span className="text-xs text-warning flex items-center gap-0.5 justify-end"><ArrowDown className="h-3 w-3" />Cost</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                Popular Products
              </CardTitle>
              <CardDescription>Total {totalProductsSold} items sold</CardDescription>
            </CardHeader>
            <CardContent>
              {popularProducts.length > 0 ? (
                <div className="space-y-4">
                  {popularProducts.map((product, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <ShoppingBag className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground truncate max-w-[140px]">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{formatCurrency(product.price)}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs font-bold">{product.qty} sold</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center"><Package className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No product sales yet</p></div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-primary" />
                Recent Store Orders
              </CardTitle>
              <CardDescription>POS &amp; store sales overview</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="new" className="w-full">
                <TabsList className="w-full grid grid-cols-3 mb-4">
                  <TabsTrigger value="new">New</TabsTrigger>
                  <TabsTrigger value="processing">Processing</TabsTrigger>
                  <TabsTrigger value="completed">Completed</TabsTrigger>
                </TabsList>
                {['new', 'processing', 'completed'].map((tab) => (
                  <TabsContent key={tab} value={tab}>
                    {ordersByStatus(tab).length > 0 ? (
                      <div className="space-y-3">
                        {ordersByStatus(tab).map((order: any) => {
                          const dotColor = tab === 'new' ? 'bg-info' : tab === 'processing' ? 'bg-warning' : 'bg-success';
                          return (
                            <div key={order.id} className="flex items-center justify-between py-1">
                              <div className="flex items-center gap-3">
                                <div className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
                                <div>
                                  <p className="text-sm font-medium text-foreground">{(order as any).members?.profiles?.full_name || 'Walk-in'}</p>
                                  <p className="text-xs text-muted-foreground">{format(new Date(order.created_at), 'dd MMM yyyy')}</p>
                                </div>
                              </div>
                              <span className="text-sm font-bold text-foreground">{formatCurrency(order.total_amount)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-muted-foreground text-sm">No {tab} orders</div>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Membership Growth
              </CardTitle>
              <CardDescription>New and total members over time</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {growthLoading ? (
                <div className="h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
              ) : memberGrowth.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={memberGrowth}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                    <Legend />
                    <Area type="monotone" dataKey="totalMembers" name="Total Members" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" />
                    <Area type="monotone" dataKey="newMembers" name="New Members" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.15)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground"><div className="text-center"><Users className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No member data yet</p></div></div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Revenue by Plan
              </CardTitle>
              <CardDescription>Top performing membership plans</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {planLoading ? (
                <div className="h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
              ) : revenueByPlan.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueByPlan} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => [formatCurrency(value), 'Revenue']} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {revenueByPlan.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground"><div className="text-center"><Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No membership data yet</p></div></div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* PT Analytics Section */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Top Performer Hero Card */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-12 w-12 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                  <Trophy className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm opacity-80">Top PT Performer</p>
                  <h3 className="text-xl font-bold">{ptStats?.topTrainer?.name || 'No data'}</h3>
                </div>
              </div>
              {ptStats?.topTrainer && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-primary-foreground/10 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold">{formatCurrency(ptStats.topTrainer.revenue)}</p>
                    <p className="text-xs opacity-70">Revenue</p>
                  </div>
                  <div className="bg-primary-foreground/10 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold">{ptStats.topTrainer.clients}</p>
                    <p className="text-xs opacity-70">Clients</p>
                  </div>
                </div>
              )}
              {!ptStats?.topTrainer && (
                <p className="text-sm opacity-60 mt-2">No PT packages sold yet</p>
              )}
            </CardContent>
          </Card>

          {/* PT Revenue + Packages Sold */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">PT Revenue</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(ptStats?.totalRevenue || 0)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-info/10 flex items-center justify-center">
                  <Dumbbell className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Packages Sold</p>
                  <p className="text-2xl font-bold text-foreground">{ptStats?.totalSold || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <Award className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Packages</p>
                  <p className="text-2xl font-bold text-foreground">{ptStats?.activePackages || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Revenue by Trainer */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Dumbbell className="h-5 w-5 text-primary" />
                Revenue by Trainer
              </CardTitle>
              <CardDescription>Top performing trainers by PT sales</CardDescription>
            </CardHeader>
            <CardContent>
              {(ptStats?.trainerStats || []).length > 0 ? (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ptStats?.trainerStats} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value: number) => [formatCurrency(value), 'Revenue']} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center"><Dumbbell className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>No PT data yet</p></div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Operational Insights Section */}
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Operational Insights
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {/* Footfall Heatmap */}
            <Card className="rounded-2xl border-none shadow-lg shadow-primary/5 md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Gym Footfall Heatmap
                </CardTitle>
                <CardDescription>Check-in intensity by day and hour (past 90 days)</CardDescription>
              </CardHeader>
              <CardContent>
                {footfallLoading ? (
                  <div className="h-40 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : footfallMax === 0 ? (
                  <div className="h-40 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No attendance data in the past 90 days</p>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[520px]">
                      {/* Hour labels */}
                      <div className="flex mb-1">
                        <div className="w-10 shrink-0" />
                        {HEATMAP_HOURS.map((h) => (
                          <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground font-medium" style={{ minWidth: 0 }}>
                            {h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
                          </div>
                        ))}
                      </div>
                      {HEATMAP_DAYS.map((day, dayIdx) => (
                        <div key={day} className="flex items-center gap-0.5 mb-0.5">
                          <div className="w-10 shrink-0 text-[10px] text-muted-foreground font-medium text-right pr-2">{day}</div>
                          {HEATMAP_HOURS.map((h) => {
                            const count = footfallData[dayIdx]?.[h] ?? 0;
                            const intensity = footfallMax > 0 ? count / footfallMax : 0;
                            const alpha = intensity === 0 ? 0 : Math.max(0.08, intensity);
                            return (
                              <div
                                key={h}
                                className="flex-1 rounded-sm cursor-default transition-transform hover:scale-110"
                                style={{
                                  aspectRatio: '1',
                                  minWidth: 0,
                                  backgroundColor: `hsl(var(--primary) / ${alpha})`,
                                  border: intensity === 0 ? '1px solid hsl(var(--border))' : 'none',
                                }}
                                title={`${day} ${h}:00 — ${count} check-in${count !== 1 ? 's' : ''}`}
                                data-testid={`heatmap-cell-${dayIdx}-${h}`}
                              />
                            );
                          })}
                        </div>
                      ))}
                      {/* Colour scale legend */}
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-[10px] text-muted-foreground">Low</span>
                        {[0.08, 0.25, 0.45, 0.65, 0.85, 1].map((a) => (
                          <div key={a} className="h-3 w-5 rounded-sm" style={{ backgroundColor: `hsl(var(--primary) / ${a})` }} />
                        ))}
                        <span className="text-[10px] text-muted-foreground">High</span>
                        <span className="text-[10px] text-muted-foreground ml-2">Peak: {footfallMax} check-ins</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upcoming Renewals */}
            <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
              <CardHeader>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-primary" />
                  Upcoming Renewals
                </CardTitle>
                <CardDescription>Active memberships expiring soon</CardDescription>
              </CardHeader>
              <CardContent>
                {renewalLoading ? (
                  <div className="h-32 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[
                      { label: 'Next 7 days', members: renewalData?.bucket7 || [], color: 'text-destructive', bg: 'bg-destructive/10' },
                      { label: 'Next 14 days', members: renewalData?.bucket14 || [], color: 'text-warning', bg: 'bg-warning/10' },
                      { label: 'Next 30 days', members: renewalData?.bucket30 || [], color: 'text-info', bg: 'bg-info/10' },
                    ].map(({ label, members, color, bg }) => (
                      <button
                        key={label}
                        className={`w-full flex items-center justify-between rounded-xl px-4 py-3 ${bg} hover:opacity-80 transition-opacity cursor-pointer`}
                        onClick={() => setRenewalDialog({ open: true, bucket: label, members })}
                        data-testid={`renewal-bucket-${label.replace(/\s+/g, '-').toLowerCase()}`}
                      >
                        <div className="text-left">
                          <p className="text-sm font-semibold text-foreground">{label}</p>
                          <p className={`text-xs font-medium ${color}`}>{members.length} member{members.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${renewalData?.bucket30?.length ? Math.min(100, (members.length / (renewalData.bucket30.length || 1)) * 100) : 0}%`,
                                backgroundColor: `hsl(var(--primary))`,
                              }}
                            />
                          </div>
                        </div>
                      </button>
                    ))}
                    {!renewalData?.bucket30?.length && (
                      <div className="text-center text-muted-foreground text-sm py-4">
                        <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        No renewals in the next 30 days
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Session Duration */}
          <div className="mt-6">
            <Card className="rounded-2xl border-none shadow-lg shadow-primary/5">
              <CardHeader>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Avg Session Duration
                </CardTitle>
                <CardDescription>Average time members spend per day (last 14 days, minutes)</CardDescription>
              </CardHeader>
              <CardContent>
                {sessionLoading ? (
                  <div className="h-48 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : sessionDurationData.length > 0 ? (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sessionDurationData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}m`} />
                        <Tooltip
                          formatter={(value: number) => [`${value} min`, 'Avg Duration']}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                        <Bar dataKey="avgMinutes" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No session data yet</p>
                      <p className="text-xs mt-1">Data appears when check-out times are recorded</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Renewal members dialog */}
      <ResponsiveSheet open={renewalDialog.open} onOpenChange={(open) => setRenewalDialog((p) => ({ ...p, open }))} width="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Expiring — {renewalDialog.bucket}</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Members whose plans are expiring in the selected time window.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        {renewalDialog.members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No members expiring in this window.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto mt-3">
            {renewalDialog.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0" data-testid={`renewal-member-${m.id}`}>
                <p className="text-sm font-medium text-foreground">{m.name}</p>
                <Badge variant="outline" className="text-xs">{format(new Date(m.endDate), 'dd MMM yyyy')}</Badge>
              </div>
            ))}
          </div>
        )}
      </ResponsiveSheet>
    </AppLayout>
  );
}
