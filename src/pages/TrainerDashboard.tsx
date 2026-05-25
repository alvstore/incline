import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTrainerData } from '@/hooks/useMemberData';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Calendar, Clock, Users, Dumbbell, TrendingUp,
  CheckCircle, AlertCircle, User, Wallet, Sun, Moon, Play, Square, Loader2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { PtPackageBadge } from '@/components/pt/PtPackageBadge';
import { TrainerTodayPanel } from '@/components/pt/TrainerTodayPanel';

export default function TrainerDashboard() {
  const { profile } = useAuth();
  const { trainer, generalClients, ptClients, todaySessions, myClasses, isLoading } = useTrainerData();

  // Earnings this month — uses same logic as TrainerEarnings page (sessions × hourly rate + commissions)
  const monthStart = startOfMonth(new Date()).toISOString();
  const monthEnd = endOfMonth(new Date()).toISOString();

  const { data: monthEarnings } = useQuery({
    queryKey: ['trainer-dashboard-earnings', trainer?.id, monthStart],
    enabled: !!trainer,
    queryFn: async () => {
      const { data: sessions } = await supabase
        .from('pt_sessions')
        .select('id')
        .eq('trainer_id', trainer!.id)
        .eq('status', 'completed')
        .gte('scheduled_at', monthStart)
        .lte('scheduled_at', monthEnd);

      const completedCount = sessions?.length || 0;
      const sessionRate = (trainer as any)?.hourly_rate || 0;
      const sessionsEarn = completedCount * sessionRate;

      let commissionsTotal = 0;
      try {
        const { data: comms } = await supabase
          .from('trainer_commissions' as any)
          .select('amount')
          .eq('trainer_id', trainer!.id)
          .gte('release_date', monthStart.split('T')[0])
          .lte('release_date', monthEnd.split('T')[0]);
        commissionsTotal = (comms || []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
      } catch { /* table may not exist in some envs */ }

      return {
        completedSessions: completedCount,
        estimated: sessionsEarn + commissionsTotal,
        sessionsEarn,
        commissionsTotal,
      };
    },
  });

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

  const completedToday = todaySessions.filter(s => s.status === 'completed').length;
  const pendingToday = todaySessions.filter(s => s.status === 'scheduled').length;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome, {profile?.full_name?.split(' ')[0] || 'Trainer'}!
            </h1>
            <p className="text-muted-foreground">
              {trainer.branch?.name} • {trainer.specializations?.[0] || 'Personal Trainer'}
            </p>
          </div>
          <Badge variant="default" className="w-fit">
            {trainer.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        {/* Primary Stats */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          <StatCard
            title="General Clients"
            value={generalClients.length}
            icon={Users}
            description="Assigned to you"
            variant="default"
          />
          <StatCard
            title="PT Clients"
            value={ptClients.length}
            icon={Dumbbell}
            description="Active packages"
            variant="warning"
          />
          <StatCard
            title="Today's Sessions"
            value={todaySessions.length}
            icon={Calendar}
            description={`${completedToday} done · ${pendingToday} pending`}
            variant="accent"
          />
          <StatCard
            title="My Classes"
            value={myClasses.length}
            icon={Dumbbell}
            description="Upcoming"
            variant="success"
          />
          <Link to="/trainer-earnings" aria-label="View detailed earnings">
            <StatCard
              title="My Earnings (This Month)"
              value={`₹${(monthEarnings?.estimated || 0).toLocaleString()}`}
              icon={Wallet}
              description={
                monthEarnings
                  ? `${monthEarnings.completedSessions} sessions${monthEarnings.commissionsTotal > 0 ? ` · ₹${monthEarnings.commissionsTotal.toLocaleString()} commission` : ''}`
                  : 'View payslip'
              }
              variant="info"
            />
          </Link>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-4">
          <Link to="/my-clients">
            <Card className="rounded-2xl hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <Users className="h-8 w-8 text-accent" />
                <span className="font-medium">View My Clients</span>
              </CardContent>
            </Card>
          </Link>
          <Link to="/pt-sessions">
            <Card className="rounded-2xl hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <Calendar className="h-8 w-8 text-success" />
                <span className="font-medium">Manage Sessions</span>
              </CardContent>
            </Card>
          </Link>
          <Link to="/trainer-plan-builder">
            <Card className="rounded-2xl hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <Dumbbell className="h-8 w-8 text-warning" />
                <span className="font-medium">Create Fitness Plan</span>
              </CardContent>
            </Card>
          </Link>
          <Link to="/trainer-earnings">
            <Card className="rounded-2xl hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <Wallet className="h-8 w-8 text-info" />
                <span className="font-medium">My Earnings</span>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Mark Today's PT Sessions — works for session-based AND monthly packs */}
        <TrainerTodayPanel trainerId={trainer.id} ptClients={ptClients as any[]} />

        <div className="grid gap-6 md:grid-cols-2">
          {/* Today's Sessions */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Today's Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todaySessions.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No sessions scheduled for today</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {todaySessions.map((session: any) => (
                    <div key={session.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {session.status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-success" />
                        ) : (
                          <Clock className="h-5 w-5 text-warning" />
                        )}
                        <div>
                          <p className="font-medium">{session.member?.profiles?.full_name || session.member?.member_code}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(session.scheduled_at), 'HH:mm')} • {session.duration_minutes} min
                          </p>
                        </div>
                      </div>
                      <Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>
                        {session.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* My Clients */}
          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                My Clients
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/my-clients">View All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {generalClients.length === 0 && ptClients.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No clients assigned</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {generalClients.slice(0, 3).map((client: any) => (
                    <div key={client.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                          <p className="font-medium">{client.profile?.full_name || client.member_code}</p>
                          <p className="text-sm text-muted-foreground">General Training</p>
                        </div>
                      </div>
                      <Badge variant="outline">General</Badge>
                    </div>
                  ))}
                  {ptClients.slice(0, 3).map((client: any) => (
                    <div key={client.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                          <Dumbbell className="h-5 w-5 text-warning" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{client.member?.profile?.full_name || client.member?.member_code}</p>
                          <p className="text-xs text-muted-foreground truncate">{client.package?.name}</p>
                        </div>
                      </div>
                      <PtPackageBadge
                        packageType={(client.package_type ?? client.package?.package_type ?? 'session_based') as 'session_based' | 'monthly'}
                        sessionsRemaining={client.sessions_remaining}
                        sessionsTotal={client.sessions_total}
                        expiryDate={client.expiry_date}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Classes */}
          <Card className="border-border/50 md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Dumbbell className="h-5 w-5" />
                My Upcoming Classes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {myClasses.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No upcoming classes assigned</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {myClasses.slice(0, 4).map((classItem: any) => (
                    <div key={classItem.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{classItem.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(classItem.scheduled_at), 'EEE, dd MMM • HH:mm')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Capacity: {classItem.capacity}
                        </p>
                      </div>
                      <Badge variant="outline">{classItem.class_type}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
