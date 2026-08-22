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
import { cn } from '@/lib/utils';
import {
  Calendar, Clock, Users, Dumbbell, TrendingUp,
  CheckCircle, AlertCircle, User, Wallet, Sun, Moon, Play, Square, Loader2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { PtPackageBadge } from '@/components/pt/PtPackageBadge';
import { TrainerTodayPanel } from '@/components/pt/TrainerTodayPanel';
import { MyShiftWeekCard } from '@/components/staff/MyShiftWeekCard';

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
      const sessionRate = (trainer as any)?.hourly_rate || 500;
      const sessionsEarn = completedCount * sessionRate;
      const baseSalary = (trainer as any)?.salary || 0;

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
        baseSalary,
        sessionsEarn,
        commissionsTotal,
        estimated: baseSalary + sessionsEarn + commissionsTotal,
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
  const firstName = profile?.full_name?.split(' ')[0] || 'Trainer';
  const totalClients = generalClients.length + ptClients.length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* ── Hero band ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-7 text-white shadow-lg shadow-indigo-500/20">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{greeting}</p>
              <h1 className="mt-1 truncate text-3xl font-bold tracking-tight">{firstName}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80">
                <span>{trainer.branch?.name ?? 'Incline'}</span>
                <span aria-hidden="true">·</span>
                <span>{trainer.specializations?.[0] || 'Personal Trainer'}</span>
                <Badge
                  className={cn(
                    'rounded-full border-0 px-2.5 py-0.5 text-[11px] font-medium',
                    trainer.is_active ? 'bg-emerald-400/20 text-emerald-50' : 'bg-white/20 text-white',
                  )}
                >
                  {trainer.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:gap-5">
              <HeroStat label="Clients" value={totalClients} />
              <HeroStat label="Today" value={`${completedToday}/${todaySessions.length}`} />
              <HeroStat label="Earnings" value={`₹${(monthEarnings?.estimated || 0).toLocaleString('en-IN')}`} />
            </div>
          </div>
        </section>

        {/* ── Duty + week roster ────────────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <DutyStatusCard userId={trainer.user_id} />
          <MyShiftWeekCard userId={trainer.user_id} />
        </div>

        {/* ── KPI row ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard
            title="General Clients"
            value={generalClients.length}
            icon={Users}
            description="Assigned to you"
            variant="default"
            className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
          />
          <StatCard
            title="PT Clients"
            value={ptClients.length}
            icon={Dumbbell}
            description="Active packages"
            variant="warning"
            className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
          />
          <StatCard
            title="Today's Sessions"
            value={todaySessions.length}
            icon={Calendar}
            description={`${completedToday} done · ${pendingToday} pending`}
            variant="accent"
            className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
          />
          <StatCard
            title="My Classes"
            value={myClasses.length}
            icon={Dumbbell}
            description="Upcoming"
            variant="success"
            className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
          />
          <Link to="/trainer-earnings" aria-label="View detailed earnings" className="cursor-pointer">
            <StatCard
              title="My Earnings"
              value={`₹${(monthEarnings?.estimated || 0).toLocaleString('en-IN')}`}
              icon={Wallet}
              description="This month"
              variant="info"
              className="h-full rounded-2xl border-0 bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:shadow-xl"
            />
          </Link>
        </div>

        {/* ── Quick actions ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <QuickActionLink to="/my-clients" icon={Users} label="My Clients" hint="Roster & progress" tone="indigo" />
          <QuickActionLink to="/schedule-session" icon={Calendar} label="Schedule Session" hint="Book a PT slot" tone="emerald" />
          <QuickActionLink to="/trainer-plan-builder" icon={TrendingUp} label="Fitness Plans" hint="Build & assign" tone="amber" />
          <QuickActionLink to="/member-store" icon={Wallet} label="Member Store" hint="Sell add-ons" tone="violet" />
        </div>

        {/* Mark Today's PT Sessions — works for session-based AND monthly packs */}
        <TrainerTodayPanel trainerId={trainer.id} ptClients={ptClients as any[]} />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Today's Sessions */}
          <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                  <Clock className="h-4 w-4" />
                </span>
                Today's sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todaySessions.length === 0 ? (
                <EmptyState icon={Calendar} text="No sessions scheduled for today" />
              ) : (
                <ol className="relative space-y-3 border-l border-dashed border-slate-200 pl-5">
                  {todaySessions.map((session: any) => {
                    const done = session.status === 'completed';
                    return (
                      <li key={session.id} className="relative">
                        <span
                          className={cn(
                            'absolute -left-[27px] top-3 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background',
                            done ? 'bg-emerald-500' : 'bg-amber-400',
                          )}
                          aria-hidden="true"
                        />
                        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 transition-colors duration-150 hover:bg-muted">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {session.member?.profiles?.full_name || session.member?.member_code}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(session.scheduled_at), 'HH:mm')} · {session.duration_minutes} min
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                              done
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-amber-100 text-amber-700 hover:bg-amber-100',
                            )}
                          >
                            {done ? 'Completed' : session.status}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* My Clients */}
          <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                  <Users className="h-4 w-4" />
                </span>
                My clients
              </CardTitle>
              <Button variant="ghost" size="sm" className="rounded-lg" asChild>
                <Link to="/my-clients">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {generalClients.length === 0 && ptClients.length === 0 ? (
                <EmptyState icon={Users} text="No clients assigned yet" />
              ) : (
                <div className="space-y-2">
                  {generalClients.slice(0, 3).map((client: any) => (
                    <div
                      key={client.id}
                      className="flex items-center justify-between gap-3 rounded-xl p-2 transition-colors duration-150 hover:bg-muted/60"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                          <User className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {client.profile?.full_name || client.member_code}
                          </p>
                          <p className="text-xs text-muted-foreground">General training</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 rounded-full text-xs">General</Badge>
                    </div>
                  ))}
                  {ptClients.slice(0, 3).map((client: any) => (
                    <div
                      key={client.id}
                      className="flex items-center justify-between gap-3 rounded-xl p-2 transition-colors duration-150 hover:bg-muted/60"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                          <Dumbbell className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {client.member?.profile?.full_name || client.member?.member_code}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{client.package?.name}</p>
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
          <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                  <Dumbbell className="h-4 w-4" />
                </span>
                My upcoming classes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {myClasses.length === 0 ? (
                <EmptyState icon={Calendar} text="No upcoming classes assigned" />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {myClasses.slice(0, 4).map((classItem: any) => (
                    <div
                      key={classItem.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4 transition-colors duration-150 hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{classItem.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(classItem.scheduled_at), 'EEE, dd MMM · HH:mm')}
                        </p>
                        <p className="text-xs text-muted-foreground">Capacity {classItem.capacity}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 rounded-full text-xs">{classItem.class_type}</Badge>
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

function HeroStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2 text-center backdrop-blur-sm sm:px-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold tabular-nums sm:text-xl">{value}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function QuickActionLink({ to, icon: Icon, label, hint, tone }: { to: string; icon: any; label: string; hint?: string; tone: string }) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    violet: 'text-violet-600 bg-violet-50',
  };

  return (
    <Link to={to} className="group cursor-pointer rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label={label}>
      <Card className="h-full overflow-hidden rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
        <CardContent className="flex items-center gap-3 p-4">
          <span className={cn('shrink-0 rounded-xl p-3 transition-transform duration-200 group-hover:scale-105', tones[tone])}>
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
            {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}



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

  if (ms != null && me != null && me < ms) {
    if (now >= ms || now <= me + 60) return 'night';
  }
  if (ms != null && me != null && now >= ms - 120 && now <= me + 60) return 'morning';
  if (es != null && ee != null && now >= es - 120 && now <= ee + 60) return 'evening';
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
        .select('id, check_in, check_out, shift_type, total_hours, source')
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
        <CardContent className="py-6 flex items-center gap-3 text-slate-500">
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

  // Check if current punch is from MIPS
  const isMipsPunch = openPunch?.source === 'mips';

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 overflow-hidden">
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80 font-semibold">Duty Status</p>
            <h3 className="text-lg font-bold">
              {isOff ? "Weekly Off" :
                openPunch ? `On Duty · ${labelFor(openPunch.shift_type)}` : 'Off Duty'}
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
            text={isOff ? 'Off' : hasMorning ? `${fmt(shift?.morning_start)} → ${fmt(shift?.morning_end)}` : 'No shift'}
          />
          <BlockPill
            label="Evening"
            icon={Moon}
            tone="indigo"
            text={isOff ? 'Off' : hasEvening ? `${fmt(shift?.evening_start)} → ${fmt(shift?.evening_end)}` : 'No shift'}
          />
        </div>

        {openPunch && (
          <div className="rounded-xl bg-emerald-50 text-emerald-700 px-4 py-3 text-sm flex items-center justify-between border border-emerald-100">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              <span>
                Clocked in at <strong>{format(new Date(openPunch.check_in), 'HH:mm')}</strong>
                {isMipsPunch && <Badge variant="outline" className="ml-2 text-[10px] py-0 border-emerald-200 text-emerald-600 bg-white">MIPS</Badge>}
              </span>
            </div>
            <span className="font-bold tabular-nums">
              {Math.floor(elapsedMin / 60)}h {elapsedMin % 60}m
            </span>
          </div>
        )}

        {/* Attendance is captured at the MIPS turnstile. Manual punching is a
            fallback only — clock-out stays available, clock-in is demoted. */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {openPunch ? (
            <Button
              size="lg"
              disabled={punch.isPending}
              onClick={onPunch}
              className="rounded-xl bg-red-500 px-8 text-white shadow-md transition-all hover:bg-red-600 active:scale-95"
            >
              {punch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4 fill-current" />}
              Clock out
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={punch.isPending || isOff}
              onClick={onPunch}
              className="rounded-xl text-slate-500 hover:text-slate-700"
            >
              {punch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
              Turnstile unreachable? Punch manually
            </Button>
          )}
          {openPunch && isMipsPunch && (
            <p className="self-center text-sm italic text-slate-500">Check-out normally happens at the turnstile</p>
          )}
        </div>

        <p className="text-[10px] text-slate-400">
          Attendance is synchronized from the biometric MIPS turnstile. Manual punch is only a fallback.
        </p>

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
    <div className={cn("rounded-xl border p-3 flex flex-col gap-1 shadow-sm", cls)}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider opacity-70">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-sm font-bold tracking-tight">{text}</div>
    </div>
  );
}


