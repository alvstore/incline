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

        {/* Duty Status — clock in / clock out */}
        <DutyStatusCard userId={trainer.user_id} />

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

// ===========================================================================
// Duty Status widget — inline (no new files per spec)
// ===========================================================================

type ShiftBlock = { kind: 'morning' | 'evening' | 'night'; start: string; end: string };

function parseTime(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return { h, m };
}
function minutesNow(d = new Date()) { return d.getHours() * 60 + d.getMinutes(); }
function timeToMin(t: string | null | undefined) {
  const p = parseTime(t); return p ? p.h * 60 + p.m : null;
}
function fmt(t: string | null | undefined) { return t ? t.slice(0, 5) : '—'; }

function pickCurrentBlock(shift: any): ShiftBlock['kind'] {
  const now = minutesNow();
  const ms = timeToMin(shift?.morning_start);
  const me = timeToMin(shift?.morning_end);
  const es = timeToMin(shift?.evening_start);
  const ee = timeToMin(shift?.evening_end);

  // Overnight morning block (e.g. 21:00 → 06:00)
  if (ms != null && me != null && me < ms) {
    if (now >= ms || now <= me + 60) return 'night';
  }
  // Within ±120 min of morning
  if (ms != null && me != null && now >= ms - 120 && now <= me + 60) return 'morning';
  if (es != null && ee != null && now >= es - 120 && now <= ee + 60) return 'evening';
  // Default: closer of the two
  if (ms != null && es != null) {
    return Math.abs(now - ms) < Math.abs(now - es) ? 'morning' : 'evening';
  }
  if (ms != null) return 'morning';
  if (es != null) return 'evening';
  return 'morning';
}

function DutyStatusCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const weekday = new Date().getDay();
  const todayDate = format(new Date(), 'yyyy-MM-dd');

  const { data: shift, isLoading: shiftLoading } = useQuery({
    queryKey: ['my-shift', userId, weekday],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('user_id', userId)
        .eq('weekday', weekday)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: punches, isLoading: punchLoading } = useQuery({
    queryKey: ['my-attendance', userId, todayDate],
    enabled: !!userId,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('id, check_in, check_out, shift_type, total_hours')
        .eq('user_id', userId)
        .gte('check_in', start.toISOString())
        .lte('check_in', end.toISOString())
        .order('check_in', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  const punch = useMutation({
    mutationFn: async (shiftType: string) => {
      const { data, error } = await supabase.rpc('punch_duty', { p_shift_type: shiftType });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Duty updated' });
      qc.invalidateQueries({ queryKey: ['my-attendance', userId, todayDate] });
    },
    onError: (e: any) => toast({ title: 'Punch failed', description: e.message, variant: 'destructive' }),
  });

  if (shiftLoading || punchLoading) {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
        <CardContent className="py-6 flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading duty status…
        </CardContent>
      </Card>
    );
  }

  const isOff = !!shift?.is_weekly_off;
  const hasMorning = !!shift?.morning_start && !!shift?.morning_end;
  const hasEvening = !!shift?.evening_start && !!shift?.evening_end;
  const overnight = hasMorning && timeToMin(shift?.morning_end)! < timeToMin(shift?.morning_start)!;

  const openPunch = (punches || []).find((p: any) => !p.check_out);
  const suggested: ShiftBlock['kind'] = openPunch
    ? (openPunch.shift_type as ShiftBlock['kind'])
    : (isOff ? 'morning' : pickCurrentBlock(shift));

  const onPunch = () => punch.mutate(suggested);
  const elapsedMin = openPunch
    ? Math.max(0, Math.round((Date.now() - new Date(openPunch.check_in).getTime()) / 60000))
    : 0;

  // Subtle re-render on tick
  void tick;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 overflow-hidden">
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">Duty Status</p>
            <h3 className="text-lg font-semibold">
              {isOff ? "Today is your weekly off" :
                openPunch ? `On duty · ${labelFor(openPunch.shift_type)} shift` : 'Off duty'}
            </h3>
          </div>
          <Clock className="h-6 w-6 opacity-80" />
        </div>
      </div>
      <CardContent className="py-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <BlockPill
            label="Morning"
            icon={Sun}
            tone="emerald"
            text={isOff ? 'Off' : hasMorning ? `${fmt(shift?.morning_start)} → ${fmt(shift?.morning_end)}${overnight ? ' (overnight)' : ''}` : 'Not scheduled'}
          />
          <BlockPill
            label="Evening"
            icon={Moon}
            tone="indigo"
            text={isOff ? 'Off' : hasEvening ? `${fmt(shift?.evening_start)} → ${fmt(shift?.evening_end)}` : 'Not scheduled'}
          />
        </div>

        {openPunch && (
          <div className="rounded-xl bg-emerald-50 text-emerald-800 px-4 py-2.5 text-sm flex items-center justify-between">
            <span>
              Clocked in at <strong>{format(new Date(openPunch.check_in), 'HH:mm')}</strong>
              {' · '}{Math.floor(elapsedMin / 60)}h {elapsedMin % 60}m elapsed
            </span>
          </div>
        )}

        {(punches || []).filter((p: any) => p.check_out).length > 0 && (
          <div className="text-xs text-slate-500">
            Today's completed punches:{' '}
            {(punches || []).filter((p: any) => p.check_out).map((p: any) => (
              <span key={p.id} className="mr-2">
                {labelFor(p.shift_type)} ({Number(p.total_hours || 0).toFixed(2)}h)
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-1">
          <Button
            size="lg"
            disabled={punch.isPending || (isOff && !openPunch)}
            onClick={onPunch}
            className={openPunch
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white'}
          >
            {punch.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> :
              openPunch ? <Square className="h-4 w-4 mr-2 fill-current" /> : <Play className="h-4 w-4 mr-2 fill-current" />}
            {openPunch ? `Clock Out · ${labelFor(openPunch.shift_type)}` : `Clock In · ${labelFor(suggested)} Shift`}
          </Button>
          {isOff && !openPunch && (
            <p className="text-sm text-slate-500 self-center">Enjoy your rest day — no shift scheduled.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function labelFor(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ');
}

function BlockPill({
  label, icon: Icon, tone, text,
}: { label: string; icon: any; tone: 'emerald' | 'indigo'; text: string }) {
  const cls = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-indigo-50 text-indigo-700 border-indigo-100';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-80">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-sm font-medium mt-1">{text}</div>
    </div>
  );
}

