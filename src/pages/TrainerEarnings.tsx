import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTrainerData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { buildPayslipPdf, downloadBlob } from '@/utils/pdfBlob';
import { useBrandContext } from '@/lib/brand/useBrandContext';
import {
  Wallet, TrendingUp, Calendar, DollarSign, CheckCircle,
  Clock, AlertCircle, User, Download
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Loader2 } from 'lucide-react';

export default function TrainerEarnings() {
  const { profile } = useAuth();
  const { trainer, isLoading: trainerLoading } = useTrainerData();
  const [selectedMonth, setSelectedMonth] = useState(0);

  const monthDate = subMonths(new Date(), selectedMonth);
  const monthStart = startOfMonth(monthDate).toISOString();
  const monthEnd = endOfMonth(monthDate).toISOString();

  // Fetch completed sessions for the month
  const { data: completedSessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['trainer-completed-sessions', trainer?.id, selectedMonth],
    enabled: !!trainer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_sessions')
        .select(`
          *,
          member_pt_package:member_pt_packages(member:members(member_code, user_id), package:pt_packages(name)),
          trainer:trainers(id, user_id)
        `)
        .eq('trainer_id', trainer!.id)
        .eq('status', 'completed')
        .gte('scheduled_at', monthStart)
        .lte('scheduled_at', monthEnd)
        .order('scheduled_at', { ascending: false });

      if (error) throw error;

      // Enrich with profile names
      const userIds = (data || []).map((s: any) => s.member_pt_package?.member?.user_id).filter(Boolean);
      let profilesMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', [...new Set(userIds)]);
        profilesMap = (profiles || []).reduce((acc: Record<string, string>, p: any) => { acc[p.id] = p.full_name || ''; return acc; }, {});
      }

      return (data || []).map((s: any) => ({
        ...s,
        _member_name: s.member_pt_package?.member?.user_id ? profilesMap[s.member_pt_package.member.user_id] : s.member_pt_package?.member?.member_code || 'Unknown',
        _member_code: s.member_pt_package?.member?.member_code,
        _package_name: s.member_pt_package?.package?.name,
      }));
    },
  });

  // Fetch trainer commissions
  const { data: commissions = [] } = useQuery({
    queryKey: ['trainer-commissions', trainer?.id, selectedMonth],
    enabled: !!trainer,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('trainer_commissions' as any)
          .select('*')
          .eq('trainer_id', trainer!.id)
          .gte('release_date', monthStart.split('T')[0])
          .lte('release_date', monthEnd.split('T')[0])
          .order('release_date', { ascending: false });

        if (error) return [];
        return data || [];
      } catch {
        return [];
      }
    },
  });

  const sessionRate = trainer?.hourly_rate || 500;
  const totalSessionsCompleted = completedSessions.length;
  const estimatedEarnings = totalSessionsCompleted * sessionRate;
  const totalCommissions = commissions.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
  const baseSalary = (trainer as any)?.salary || 0;
  // Payroll Audit FIX: Total pay = Base Salary + (Completed Sessions × Hourly Rate) + Commissions
  const grossPay = baseSalary + estimatedEarnings + totalCommissions;
  // PF is 12% of Base Salary only
  const pfDeduction = Math.round(baseSalary * 0.12);
  const netPay = grossPay - pfDeduction;

  const isLoading = trainerLoading || sessionsLoading;

  const { data: brand } = useBrandContext((trainer as any)?.branch_id || null);

  const handleDownloadPayslip = () => {
    if (!trainer || !brand) return;
    const blob = buildPayslipPdf({
      employee_name: profile?.full_name || 'Trainer',
      employee_code: (trainer as any)?.employee_code || trainer.id.slice(0, 8),
      designation: 'Personal Trainer',
      period_label: format(monthDate, 'MMMM yyyy'),
      period_start: monthStart.split('T')[0],
      period_end: monthEnd.split('T')[0],
      attendance: { present: totalSessionsCompleted, payable_days: totalSessionsCompleted, total_days: 26, monthly_salary: baseSalary },
      earnings: { base: baseSalary, pt_commission: estimatedEarnings + totalCommissions, ot: 0, bonus: 0 },
      deductions: { deductions: pfDeduction, advance: 0, penalty: 0 },
      gross: grossPay,
      net: netPay,
    }, brand);
    downloadBlob(blob, `Payslip_${format(monthDate, 'yyyy-MM')}.pdf`);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!trainer) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Trainer Profile Found</h2>
          <p className="text-muted-foreground">Your account is not linked to a trainer profile.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Wallet className="h-8 w-8 text-success" />
              My Earnings
            </h1>
            <p className="text-muted-foreground">Track your sessions and earnings</p>
          </div>
          <div className="flex gap-2">
            {[0, 1, 2].map((monthOffset) => {
              const date = subMonths(new Date(), monthOffset);
              return (
                <Button
                  key={monthOffset}
                  variant={selectedMonth === monthOffset ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedMonth(monthOffset)}
                >
                  {format(date, 'MMM yyyy')}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <StatCard title="Completed Sessions" value={totalSessionsCompleted} icon={CheckCircle} description={format(monthDate, 'MMMM yyyy')} variant="success" />
          <StatCard title="Session Rate" value={`₹${sessionRate}`} icon={DollarSign} description="Per session" variant="accent" />
          <StatCard title="Estimated Earnings" value={`₹${estimatedEarnings.toLocaleString()}`} icon={Wallet} description="From sessions" variant="default" />
          <StatCard title="Commissions" value={`₹${totalCommissions.toLocaleString()}`} icon={TrendingUp} description="Package sales" variant="info" />
        </div>

        {/* Total Earnings Card with Download */}
        <Card className="border-success/20 bg-success/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Estimated Earnings — {format(monthDate, 'MMMM yyyy')}</p>
                <p className="text-4xl font-bold text-success">
                  ₹{netPay.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Base: ₹{baseSalary.toLocaleString()} + Sessions: ₹{estimatedEarnings.toLocaleString()} + Commission: ₹{totalCommissions.toLocaleString()} − PF: ₹{pfDeduction.toLocaleString()}
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="p-4 rounded-full bg-success/10">
                  <Wallet className="h-8 w-8 text-success" />
                </div>
                <Button size="sm" variant="outline" onClick={handleDownloadPayslip}>
                  <Download className="h-4 w-4 mr-1" />
                  Payslip
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Session History */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Completed Sessions — {format(monthDate, 'MMMM yyyy')}
            </CardTitle>
            <CardDescription>Sessions you've completed this month</CardDescription>
          </CardHeader>
          <CardContent>
            {completedSessions.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No completed sessions this month</p>
              </div>
            ) : (
              <div className="space-y-3">
                {completedSessions.map((session: any) => (
                  <div key={session.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-full bg-success/10">
                        <CheckCircle className="h-5 w-5 text-success" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <p className="font-medium">
                            {session._member_name || session._member_code || 'Unknown'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{format(new Date(session.scheduled_at), 'EEE, dd MMM • HH:mm')}</span>
                          <span>•</span>
                          <span>{session.duration_minutes} min</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-success">₹{sessionRate}</p>
                      <Badge variant="outline" className="text-xs">
                        {session._package_name || 'Session'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Note */}
        <Card className="border-border/50 bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-1">Earnings Calculation</p>
                <p>
                  Earnings shown are estimates based on completed sessions and base salary. Final payment may vary based on
                  commission structure, deductions, and company policies. Download your payslip for detailed breakdown.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
