import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Activity, ArrowRight, CalendarDays, ClipboardList, Clock3,
  Dumbbell, LogOut, MessageSquare, ShoppingBag, UserRound, UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberData } from '@/hooks/useMemberData';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { GymLoader } from '@/components/ui/gym-loader';
import { MemberPasswordSheet } from '@/components/member/MemberPasswordSheet';
import { StreakBanner } from '@/components/member-app/StreakBanner';
import { TodayWorkoutCard } from '@/components/member-app/TodayWorkoutCard';
import { RecoveryTray } from '@/components/member-app/RecoveryTray';

const card = 'rounded-2xl bg-card p-5 shadow-lg shadow-slate-200/50 dark:shadow-none';

/** A member-only, mobile-first doorway into the existing live member workflows. */
export default function MemberAppHome() {
  const { profile, signOut } = useAuth();
  const { member, activeMembership, scheduledMembership, isLoading, daysRemaining, upcomingClasses, ptPackages } = useMemberData();
  const { data: clubClasses = [] } = useQuery({
    queryKey: ['member-dashboard-club-classes', member?.branch_id],
    enabled: !!member?.branch_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('id, name, scheduled_at')
        .eq('branch_id', member!.branch_id).eq('is_active', true).is('cancelled_at', null)
        .gte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(3);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <AppLayout><div className="flex min-h-[50vh] items-center justify-center"><GymLoader text="Loading your club" /></div></AppLayout>;
  if (!member) return <AppLayout><div className="mx-auto max-w-lg p-6"><div className={card}><h1 className="font-semibold">No member profile linked</h1><p className="mt-2 text-sm text-muted-foreground">Please ask reception to link your account to your membership.</p></div></div></AppLayout>;

  const first = profile?.full_name?.split(' ')[0] || 'Member';
  const initials = profile?.full_name?.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() || 'IN';
  const plan = activeMembership || scheduledMembership;
  const planStatus = activeMembership?.status === 'frozen' ? 'Frozen' : activeMembership ? 'Active' : scheduledMembership ? 'Scheduled' : 'No active plan';
  const pt = ptPackages.find(p => p.status === 'active');
  const nextBooked = [...upcomingClasses].sort((a, b) => new Date(a.class?.scheduled_at || 0).getTime() - new Date(b.class?.scheduled_at || 0).getTime())[0];
  const nextClass = nextBooked?.class || clubClasses[0];
  const isBooked = !!nextBooked;
  const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

  const isFrozen = activeMembership?.status === 'frozen';
  const quick = [
    { label: 'Classes', to: '/book?type=classes', icon: CalendarDays },
    { label: 'Diet', to: '/my-diet', icon: UtensilsCrossed },
    { label: 'Store', to: '/member-store', icon: ShoppingBag },
    { label: 'Progress', to: '/my-progress', icon: Activity },
    { label: 'Requests', to: '/my-requests', icon: ClipboardList },
    { label: 'Feedback', to: '/member-feedback', icon: MessageSquare },
    { label: 'PT', to: '/my-pt-sessions', icon: Dumbbell },
    { label: 'Profile', to: '/member-profile', icon: UserRound },
  ];

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-5 bg-slate-50 px-4 py-5 dark:bg-background sm:px-6 lg:py-8">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p><h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Hello, {first}</h1></div>
          <Link to="/member-profile" aria-label="View your profile" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Avatar className="h-12 w-12 ring-2 ring-primary/30 ring-offset-2 ring-offset-background"><AvatarImage src={profile?.avatar_url ?? undefined} alt={profile?.full_name || 'Your avatar'} className="object-cover" /><AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials}</AvatarFallback></Avatar></Link>
        </header>

        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-3">
            <StreakBanner memberId={member.id} />
            <TodayWorkoutCard memberId={member.id} />
          </div>
          <section aria-label="Membership" className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-theme-gradient p-6 text-white shadow-xl shadow-primary/20 lg:col-span-2">
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
            <div className="relative flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-white/80">{member.branch?.name || 'The Incline'}</p><h2 className="mt-2 text-xl font-bold">{plan?.plan?.name || 'Ready to get started?'}</h2><p className="mt-1 text-xs text-white/80">{member.member_code}</p></div><span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">{planStatus}</span></div>
            <div className="relative mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/15 p-3"><p className="text-xs text-white/80">{activeMembership ? isFrozen ? 'Access' : 'Days left' : scheduledMembership ? 'Starts' : 'Plan'}</p><p className="text-xl font-bold">{isFrozen ? 'Paused' : activeMembership ? daysRemaining : scheduledMembership ? format(new Date(scheduledMembership.start_date), 'dd MMM') : '—'}</p></div>
              <Link to="/my-pt-sessions" className="rounded-xl bg-white/15 p-3 transition-colors hover:bg-white/25"><p className="text-xs text-white/80">PT sessions</p><p className="text-xl font-bold">{pt ? pt.sessions_remaining : '—'}</p></Link>
            </div>
            <Link to="/renewal-center" className="relative mt-4 inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white px-4 text-sm font-bold text-primary transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{activeMembership ? 'Renew & upgrade' : 'Explore plans'}<ArrowRight className="h-4 w-4" /></Link>
          </section>
        </div>

        <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2 rounded-2xl bg-card p-3 shadow-lg shadow-slate-200/50 dark:shadow-none sm:grid-cols-8">
          {quick.map(q => { const Icon = q.icon; return (
            <Link key={q.to} to={q.to} className="group flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl transition-colors duration-200 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-105"><Icon className="h-5 w-5" aria-hidden /></span>
              <span className="text-[11px] font-medium text-foreground">{q.label}</span>
            </Link>); })}
        </nav>

        <RecoveryTray memberId={member.id} disabled={isFrozen} />

        <section className="rounded-2xl bg-card p-5 shadow-lg shadow-slate-200/50 dark:shadow-none" aria-labelledby="next-class-title">
          <div className="flex items-center justify-between gap-2"><h2 id="next-class-title" className="text-lg font-bold text-foreground">{isBooked ? 'Your next class' : 'Up next at the club'}</h2>{isBooked && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Booked</span>}</div>
          {nextClass ? <div className="mt-4 flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-theme-gradient text-white"><CalendarDays className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate font-semibold text-foreground">{nextClass.name}</p><p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />{dateLabel(nextClass.scheduled_at)}</p></div></div> : <p className="mt-3 text-sm text-muted-foreground">New sessions are added every week — check the schedule soon.</p>}
          <Button asChild variant="outline" className="mt-4 min-h-11 w-full"><Link to="/book?type=classes">{isBooked ? 'View my bookings' : 'Browse classes'}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 dark:shadow-none" aria-label="Account">
          <p className="text-sm font-semibold text-foreground">Your account</p>
          <div className="flex flex-wrap gap-2"><MemberPasswordSheet /><Button variant="ghost" className="min-h-11" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button></div>
        </section>
      </div>
    </AppLayout>
  );
}