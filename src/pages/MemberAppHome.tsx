import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Activity, ArrowRight, CalendarDays, ChevronRight, ClipboardList, Clock3,
  Dumbbell, HeartPulse, LogOut, MessageSquare, ShoppingBag,
  UserRound, UtensilsCrossed, Waves,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberData } from '@/hooks/useMemberData';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { GymLoader } from '@/components/ui/gym-loader';
import { MemberPasswordSheet } from '@/components/member/MemberPasswordSheet';

const actions = [
  { label: 'Book a class', description: 'Explore coached sessions', to: '/book?type=classes', icon: CalendarDays },
  { label: 'Book recovery', description: 'Find an available facility slot', to: '/book?type=recovery', icon: Waves },
  { label: 'Workout plan', description: 'See your coach’s plan', to: '/my-workout', icon: Dumbbell },
  { label: 'Diet plan', description: 'Your nutrition guidance', to: '/my-diet', icon: UtensilsCrossed },
  { label: 'Store & add-ons', description: 'Shop your club’s catalogue', to: '/member-store', icon: ShoppingBag },
  { label: 'My progress', description: 'Visits and measurements', to: '/my-progress', icon: Activity },
  { label: 'Feedback', description: 'Tell us how we’re doing', to: '/member-feedback', icon: MessageSquare },
  { label: 'Requests', description: 'Track service requests', to: '/my-requests', icon: ClipboardList },
];

const card = 'rounded-2xl border border-slate-100 bg-white p-5 shadow-lg shadow-slate-200/50 dark:border-border dark:bg-card dark:shadow-none';

function ActionLink({ action }: { action: typeof actions[number] }) {
  const Icon = action.icon;
  return (
    <Link to={action.to} className="group flex min-h-[76px] items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-border dark:bg-card">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" aria-hidden /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{action.label}</span><span className="block text-xs text-muted-foreground">{action.description}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
    </Link>
  );
}

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

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 bg-slate-50 px-4 py-5 dark:bg-background sm:px-6 lg:py-8">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-sm text-muted-foreground">Your club, your way</p><h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Hello, {first}</h1><p className="mt-1 text-sm text-muted-foreground">{member.branch?.name || 'The Incline'}</p></div>
          <Link to="/member-profile" aria-label="View your profile" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Avatar className="h-12 w-12 ring-2 ring-primary/20"><AvatarImage src={profile?.avatar_url ?? undefined} alt={profile?.full_name || 'Your avatar'} className="object-cover" /><AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials}</AvatarFallback></Avatar></Link>
        </header>

        <section aria-label="Membership" className="relative overflow-hidden rounded-2xl bg-theme-gradient p-6 text-white shadow-xl shadow-primary/20 sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-white/80">Your membership</p><h2 className="mt-2 max-w-[19rem] text-xl font-bold sm:text-2xl">{plan?.plan?.name || 'Ready to get started?'}</h2><p className="mt-1 text-xs text-white/80">{member.member_code}</p></div><span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">{planStatus}</span></div>
          <div className="relative mt-6 flex items-end justify-between gap-3"><div><p className="text-sm text-white/80">{activeMembership ? activeMembership.status === 'frozen' ? 'Access paused' : 'Days remaining' : scheduledMembership ? 'Membership starts' : 'Explore memberships'}</p><p className="mt-0.5 text-2xl font-bold">{activeMembership?.status === 'frozen' ? '—' : activeMembership ? daysRemaining : scheduledMembership ? format(new Date(scheduledMembership.start_date), 'dd MMM yyyy') : 'Join us'}</p></div><Link to="/renewal-center" className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-white px-4 text-xs font-bold text-primary transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{activeMembership ? 'View options' : 'Explore plans'}<ArrowRight className="h-4 w-4" /></Link></div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Link to="/book?type=classes" className={`${card} min-h-28 transition-shadow hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}><CalendarDays className="h-5 w-5 text-primary" /><p className="mt-3 text-xl font-bold text-foreground">{upcomingClasses.length}</p><p className="text-xs text-muted-foreground">Upcoming bookings</p></Link>
          <Link to="/my-pt-sessions" className={`${card} min-h-28 transition-shadow hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}><Dumbbell className="h-5 w-5 text-primary" /><p className="mt-3 text-xl font-bold text-foreground">{pt ? pt.sessions_remaining : '—'}</p><p className="text-xs text-muted-foreground">{pt ? 'PT sessions left' : 'No active PT package'}</p></Link>
        </div>

        <section className={card} aria-labelledby="next-class-title"><div className="flex items-center justify-between gap-2"><h2 id="next-class-title" className="text-lg font-bold text-foreground">{isBooked ? 'Your next class' : 'Discover a class'}</h2><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span></div>{nextClass ? <div className="mt-4"><p className="font-semibold text-foreground">{nextClass.name}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />{dateLabel(nextClass.scheduled_at)} IST</p></div> : <p className="mt-3 text-sm text-muted-foreground">No upcoming club classes are scheduled right now. Check back soon.</p>}<Button asChild className="mt-5 min-h-11 w-full"><Link to="/book?type=classes">{isBooked ? 'View my bookings' : 'Browse classes'}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></section>

        <section aria-labelledby="explore-title"><div className="mb-3 flex items-center justify-between"><h2 id="explore-title" className="text-lg font-bold text-foreground">Explore your club</h2><HeartPulse className="h-5 w-5 text-primary" aria-hidden /></div><div className="grid gap-3 sm:grid-cols-2">{actions.map(action => <ActionLink key={action.to} action={action} />)}</div></section>

        <section className={card} aria-labelledby="account-title"><h2 id="account-title" className="text-lg font-bold text-foreground">Your account</h2><p className="mt-1 text-sm text-muted-foreground">Your photo, contact details and account security.</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" asChild className="min-h-11"><Link to="/member-profile"><UserRound className="mr-2 h-4 w-4" />View & edit profile</Link></Button><MemberPasswordSheet /><Button variant="ghost" className="min-h-11" onClick={() => void signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button></div></section>

      </div>
    </AppLayout>
  );
}