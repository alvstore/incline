import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  Calendar, Clock, CreditCard, Dumbbell, FileText, 
  TrendingUp, User, AlertCircle, CheckCircle, Lock, Gift, Snowflake, Sparkles, Plus, Heart, CalendarClock
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import useEmblaCarousel from 'embla-carousel-react';
import { useState } from 'react';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';
import { EligibleAddOns } from '@/components/benefits/EligibleAddOns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AddToHomeScreen } from '@/components/member/AddToHomeScreen';
import { BrowserNotifications } from '@/components/member/BrowserNotifications';
import { fetchMemberEntitlements } from '@/lib/benefits/memberEntitlements';
import { MemberEntitlementGrid } from '@/components/benefits/MemberEntitlementGrid';

export default function MemberDashboard() {
  const { profile } = useAuth();
  const { 
    member, 
    activeMembership, 
    scheduledMembership,
    isScheduled,
    daysUntilStart,
    ptPackages, 
    recentAttendance, 
    pendingInvoices,
    upcomingClasses,
    daysRemaining,
    isLoading 
  } = useMemberData();

  const isFrozen = activeMembership?.status === 'frozen';
  const startsLabel = scheduledMembership
    ? daysUntilStart <= 0
      ? 'Starts today'
      : daysUntilStart === 1
        ? 'Starts tomorrow'
        : `Starts in ${daysUntilStart} days`
    : '';

  const [emblaRef] = useEmblaCarousel({ loop: true });
  const [addOnOpen, setAddOnOpen] = useState(false);

  // Gifts/credits granted by staff should appear without a page refresh
  useRealtimeInvalidate({
    channel: 'member-dashboard-benefits',
    tables: ['member_benefit_credits', 'member_comps'],
    invalidateKeys: [['dashboard-benefit-credits'], ['my-entitlements'], ['my-member-entitlements']],
    enabled: !!member?.id,
  });



  // Fetch benefit add-on credits (purchased extras)
  const { data: benefitCredits = [] } = useQuery({
    queryKey: ['dashboard-benefit-credits', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_benefit_credits')
        .select('*, benefit_type:benefit_types(id, name, code, icon)')
        .eq('member_id', member!.id)
        .gte('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true });
      if (error) { console.error(error); return []; }
      return data || [];
    },
  });

  // Fetch freeze details for frozen state
  const { data: freezeDetails } = useQuery({
    queryKey: ['freeze-details', activeMembership?.id],
    enabled: !!activeMembership?.id && isFrozen,
    queryFn: async () => {
      const { data } = await supabase
        .from('membership_freeze_history')
        .select('*')
        .eq('membership_id', activeMembership!.id)
        .in('status', ['approved', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // Next club sessions — shown when the member has nothing booked yet
  const { data: clubClasses = [] } = useQuery({
    queryKey: ['member-dashboard-club-classes', member?.branch_id],
    enabled: !!member?.branch_id,
    queryFn: async (): Promise<{ id: string; name: string; scheduled_at: string }[]> => {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, scheduled_at')
        .eq('branch_id', member!.branch_id)
        .eq('is_active', true)
        .is('cancelled_at', null)
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; scheduled_at: string }[];
    },
  });

  // Fetch ad banners
  const { data: banners = [] } = useQuery({
    queryKey: ['member-banners', member?.branch_id],
    enabled: !!member?.branch_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('ad_banners')
        .select('*')
        .eq('branch_id', member!.branch_id)
        .eq('is_active', true)
        .order('display_order');
      return data || [];
    },
  });

  // Fetch assigned locker
  const { data: assignedLocker } = useQuery({
    queryKey: ['my-locker', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locker_assignments')
        .select('*, locker:lockers(locker_number, size)')
        .eq('member_id', member!.id)
        .eq('is_active', true)
        .maybeSingle();
      if (error) { console.error('Error fetching locker:', error); return null; }
      return data;
    },
  });

  const {
    data: entitlements = [],
    isLoading: entitlementsLoading,
    isError: entitlementsError,
    refetch: refetchEntitlements,
  } = useQuery({
    queryKey: ['my-member-entitlements', member?.id, activeMembership?.id],
    enabled: !!member?.id && !!activeMembership?.id,
    queryFn: () => fetchMemberEntitlements({
      memberId: member!.id,
      membershipId: activeMembership!.id,
      planId: activeMembership!.plan_id,
    }),
  });

  if (isLoading) {
    return <AppLayout><div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div></AppLayout>;
  }

  if (!member) {
    return <AppLayout><div className="flex flex-col items-center justify-center min-h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-warning" /><h2 className="text-xl font-semibold">No Member Profile Found</h2><p className="text-muted-foreground">Your account is not linked to a member profile.</p></div></AppLayout>;
  }

  const activePtPackage = ptPackages.find(p => p.status === 'active');
  const totalPendingAmount = pendingInvoices.reduce((sum, inv) => sum + (inv.total_amount - (inv.amount_paid || 0)), 0);

  const visitsThisMonth = recentAttendance.filter(a => {
    const d = new Date(a.check_in); const n = new Date();
    return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  }).length;
  const planName = activeMembership?.plan?.name || scheduledMembership?.plan?.name || 'No active plan';
  const totalPlanDays = activeMembership
    ? Math.max(1, differenceInDays(new Date(activeMembership.end_date), new Date(activeMembership.start_date)))
    : 1;
  const planUsedPct = activeMembership ? Math.min(100, Math.max(0, ((totalPlanDays - daysRemaining) / totalPlanDays) * 100)) : 0;
  const card = 'rounded-2xl bg-white dark:bg-card shadow-lg shadow-slate-200/50 dark:shadow-none transition-all duration-200 hover:shadow-xl hover:shadow-primary/10';
  const label = 'text-xs font-semibold text-slate-500 uppercase tracking-wider';
  const iconBadge = 'bg-primary/10 text-primary p-2 rounded-full';
  const statusBadge = isFrozen
    ? { text: 'Frozen', cls: 'bg-blue-100 text-blue-700', Icon: Snowflake }
    : activeMembership
      ? { text: 'Active', cls: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle }
      : isScheduled
        ? { text: 'Scheduled', cls: 'bg-slate-100 text-slate-600', Icon: CalendarClock }
        : { text: 'Inactive', cls: 'bg-red-100 text-red-700', Icon: AlertCircle };

  const quickActions = [
    { to: '/book', label: 'Book & Schedule', Icon: Calendar, disabled: isFrozen },
    { to: '/my-progress', label: 'My Progress', Icon: TrendingUp },
    { to: '/member-store', label: 'Shop', Icon: CreditCard },
    { to: '/my-referrals', label: 'Refer & Earn', Icon: Gift },
  ];

  return (
    <AppLayout>
      <div className="min-w-0 space-y-6">
        <AddToHomeScreen />
        <BrowserNotifications branchId={member.branch_id} />
        {/* Hero pass */}
        <section className="relative overflow-hidden min-w-0 rounded-2xl bg-theme-gradient p-4 sm:p-6 md:p-8 text-white shadow-xl shadow-primary/20">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="relative grid min-w-0 gap-5 sm:gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div className="min-w-0 space-y-4">
              <div>
                <p className="text-sm text-white/80">Welcome back</p>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  {profile?.full_name?.split(' ')[0] || 'Member'}
                </h1>
                <p className="mt-1 text-sm text-white/80">{member.member_code} · {member.branch?.name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickActions.map(({ to, label: l, Icon, disabled }) => disabled ? (
                  <span key={to} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-3 text-xs sm:px-4 sm:text-sm text-white/60 cursor-not-allowed">
                    <Icon className="h-4 w-4" />{l}
                  </span>
                ) : (
                  <Link key={to} to={to} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-3 text-xs sm:px-4 sm:text-sm font-medium backdrop-blur transition-colors duration-200 hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white cursor-pointer">
                    <Icon className="h-4 w-4" />{l}
                  </Link>
                ))}
              </div>
            </div>

            <div className="min-w-0 rounded-2xl bg-white/10 p-3.5 sm:p-5 backdrop-blur ring-1 ring-white/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Your plan</p>
                  <p className="truncate text-lg font-bold">{planName}</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge.cls}`}>
                  <statusBadge.Icon className="h-3 w-3" />{statusBadge.text}
                </span>
              </div>
              {activeMembership ? (
                <div className="mt-4 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-3xl font-bold">{isFrozen ? '—' : daysRemaining}</span>
                    <span className="text-xs text-white/80">
                      {isFrozen ? 'Paused' : 'days left'} · ends {format(new Date(activeMembership.end_date), 'dd MMM yyyy')}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={Math.round(planUsedPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Membership time used">
                    <div className="h-full rounded-full bg-white" style={{ width: `${planUsedPct}%` }} />
                  </div>
                  {isFrozen && freezeDetails?.end_date && (
                    <p className="text-xs text-white/80">Freeze ends {format(new Date(freezeDetails.end_date), 'dd MMM yyyy')}</p>
                  )}
                </div>
              ) : isScheduled ? (
                <p className="mt-4 text-sm text-white/90">{startsLabel} · {format(new Date(scheduledMembership!.start_date), 'dd MMM yyyy')}</p>
              ) : (
                <Button asChild size="sm" className="mt-4 bg-white text-primary hover:bg-white/90">
                  <Link to="/renewal-center">Get a membership</Link>
                </Button>
              )}
              {activeMembership && !isFrozen && daysRemaining <= 15 && (
                <Button asChild size="sm" className="mt-4 w-full bg-white text-primary hover:bg-white/90">
                  <Link to="/renewal-center">Renew now</Link>
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Ad Banners Carousel */}
        {banners.length > 0 && (
          <div className="overflow-hidden rounded-2xl shadow-lg shadow-slate-200/50" ref={emblaRef}>
            <div className="flex">
              {banners.map((banner: any) => (
                <div key={banner.id} className="flex-[0_0_100%] min-w-0">
                  {banner.redirect_url ? (
                    <a href={banner.redirect_url} target="_blank" rel="noreferrer">
                      <img src={banner.image_url} alt={banner.title || 'Promotion'} className="w-full h-40 md:h-52 object-cover rounded-2xl" />
                    </a>
                  ) : (
                    <img src={banner.image_url} alt={banner.title || 'Promotion'} className="w-full h-40 md:h-52 object-cover rounded-2xl" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isFrozen && (
          <Alert className="rounded-2xl border-0 bg-blue-50 shadow-lg shadow-slate-200/50">
            <Snowflake className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-700">Membership frozen</AlertTitle>
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-slate-600">Gym access and bookings are paused.</span>
              <Button size="sm" variant="outline" className="w-fit" asChild>
                <Link to="/my-requests">Request Unfreeze</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isScheduled && (
          <Alert className="rounded-2xl border-0 bg-primary/10 shadow-lg shadow-slate-200/50">
            <CalendarClock className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">Membership scheduled — {scheduledMembership?.plan?.name}</AlertTitle>
            <AlertDescription className="text-slate-600">
              Runs {format(new Date(scheduledMembership!.start_date), 'dd MMM yyyy')} – {format(new Date(scheduledMembership!.end_date), 'dd MMM yyyy')}. Entry, bookings and benefits unlock automatically on your start date.
            </AlertDescription>
          </Alert>
        )}

        {/* KPI strip */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between"><span className={label}>PT Sessions</span><span className={iconBadge}><Dumbbell className="h-4 w-4" /></span></div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-foreground">{activePtPackage?.sessions_remaining || 0}</p>
            <p className="text-xs text-slate-500">{activePtPackage ? `of ${activePtPackage.sessions_total} left` : 'No active package'}</p>
          </div>
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between"><span className={label}>Visits this month</span><span className="bg-emerald-50 text-emerald-600 p-2 rounded-full"><Clock className="h-4 w-4" /></span></div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-foreground">{visitsThisMonth}</p>
            <p className="text-xs text-slate-500">Last 10 check-ins tracked</p>
          </div>
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between"><span className={label}>Classes booked</span><span className={iconBadge}><Calendar className="h-4 w-4" /></span></div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-foreground">{upcomingClasses.length}</p>
            <p className="text-xs text-slate-500">Upcoming</p>
          </div>
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between">
              <span className={label}>Pending dues</span>
              <span className={totalPendingAmount > 0 ? 'bg-red-50 text-red-600 p-2 rounded-full' : 'bg-emerald-50 text-emerald-600 p-2 rounded-full'}><FileText className="h-4 w-4" /></span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-foreground">₹{totalPendingAmount.toLocaleString('en-IN')}</p>
            {totalPendingAmount > 0 && pendingInvoices[0]?.id ? (
              <Link to={`/member/pay?invoice=${pendingInvoices[0].id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded">
                <CreditCard className="h-3 w-3" /> Pay now · {pendingInvoices.length} invoice(s)
              </Link>
            ) : (
              <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">All paid</span>
            )}
          </div>
        </div>

        {member && activeMembership && (
          <EligibleAddOns
            memberId={member.id}
            memberName={profile?.full_name || undefined}
            membershipId={activeMembership.id}
            branchId={member.branch_id}
            variant="compact"
            limit={3}
          />
        )}

        {/* Bento grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Entitlements — wide */}
          <Card className={`${card} border-0 lg:col-span-2`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-foreground flex items-center gap-2">
                <span className={iconBadge}><Sparkles className="h-5 w-5" /></span>
                My Entitlements
              </CardTitle>
              {activeMembership && !isFrozen && (
                <Button size="sm" variant="outline" onClick={() => setAddOnOpen(true)} className="rounded-full">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add-On
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!activeMembership ? (
                <div className="py-6 text-center">
                  {isScheduled ? (
                    <p className="text-sm text-slate-500">Your {scheduledMembership?.plan?.name} benefits unlock on {format(new Date(scheduledMembership!.start_date), 'dd MMM yyyy')}.</p>
                  ) : (
                    <>
                      <p className="text-sm text-slate-500 mb-4">No active membership</p>
                      <Button variant="outline" asChild><Link to="/renewal-center">Get Membership</Link></Button>
                    </>
                  )}
                </div>
              ) : entitlementsLoading ? (
                <div className="grid gap-3 sm:grid-cols-2" aria-label="Loading entitlements">
                  {[0, 1].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />)}
                </div>
              ) : entitlementsError ? (
                <div className="py-6 text-center" role="alert">
                  <p className="text-sm text-destructive">We couldn't load your entitlements.</p>
                  <Button variant="outline" className="mt-3" onClick={() => refetchEntitlements()}>Try again</Button>
                </div>
              ) : entitlements.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No active benefits, gifts or add-ons found.</p>
              ) : (
                <div className="space-y-4">
                  <MemberEntitlementGrid entitlements={entitlements} frozen={isFrozen} />
                  {!isFrozen && (
                    <Button asChild className="w-full bg-theme-gradient text-white hover:opacity-95">
                      <Link to="/book?type=recovery">Book a recovery session</Link>
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Next up */}
          <Card className={`${card} border-0`}>
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-foreground flex items-center gap-2">
                <span className={iconBadge}><Calendar className="h-5 w-5" /></span>
                Next Up
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingClasses.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">No classes booked yet — browse this week's schedule and reserve your spot.</p>
                  {clubClasses.map((cls) => (
                    <div key={cls.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-muted/40 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-foreground">{cls.name}</p>
                        <p className="text-xs text-slate-500">{format(new Date(cls.scheduled_at), 'EEE, dd MMM • HH:mm')}</p>
                      </div>
                      {!isFrozen && <Button size="sm" variant="outline" asChild className="shrink-0 rounded-full"><Link to="/book">Book</Link></Button>}
                    </div>
                  ))}
                  {!isFrozen && <Button className="w-full" variant="outline" asChild><Link to="/book">See full schedule</Link></Button>}
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingClasses.slice(0, 4).map((booking: any) => (
                    <div key={booking.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-muted/40 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-foreground">{booking.class?.name}</p>
                        <p className="text-xs text-slate-500">{format(new Date(booking.class?.scheduled_at), 'EEE, dd MMM • HH:mm')}</p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Booked</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent attendance */}
          <Card className={`${card} border-0`}>
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-foreground flex items-center gap-2">
                <span className="bg-emerald-50 text-emerald-600 p-2 rounded-full"><Clock className="h-5 w-5" /></span>
                Recent Visits
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentAttendance.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">No visits yet</p>
              ) : (
                <ul className="space-y-3">
                  {recentAttendance.slice(0, 5).map((record) => (
                    <li key={record.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-900 dark:text-foreground"><CheckCircle className="h-4 w-4 text-emerald-500" />{format(new Date(record.check_in), 'EEE, dd MMM')}</span>
                      <span className="text-slate-500">{format(new Date(record.check_in), 'HH:mm')}{record.check_out && ` – ${format(new Date(record.check_out), 'HH:mm')}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Trainer */}
          <Card className={`${card} border-0`}>
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-foreground flex items-center gap-2">
                <span className={iconBadge}><Dumbbell className="h-5 w-5" /></span>
                My Trainer
              </CardTitle>
            </CardHeader>
            <CardContent>
              {member.assigned_trainer || activePtPackage?.trainer ? (() => {
                const t = (member.assigned_trainer ?? activePtPackage!.trainer) as { profile?: { full_name?: string; avatar_url?: string | null } } | null;
                const name = t?.profile?.full_name || 'Trainer';
                const avatar = t?.profile?.avatar_url ?? null;
                const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
                return (
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 ring-2 ring-primary/20">
                      {avatar && <AvatarImage src={avatar} alt={name} className="object-cover" />}
                      <AvatarFallback className="bg-primary/10 font-semibold text-primary">{ini}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900 dark:text-foreground">{name}</p>
                      <p className="text-xs text-slate-500">{member.assigned_trainer ? 'Personal Trainer' : 'PT Package Trainer'}</p>
                    </div>
                  </div>
                );
              })() : (
                <div className="py-2 text-center"><p className="mb-4 text-sm text-slate-500">No trainer assigned</p><Button variant="outline" asChild><Link to="/my-requests">Request Trainer</Link></Button></div>
              )}
            </CardContent>
          </Card>

          {/* Locker */}
          <Card className={`${card} border-0`}>
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-foreground flex items-center gap-2">
                <span className="bg-amber-50 text-amber-600 p-2 rounded-full"><Lock className="h-5 w-5" /></span>
                My Locker
              </CardTitle>
            </CardHeader>
            <CardContent>
              {assignedLocker ? (
                <div>
                  <p className="text-2xl font-bold text-slate-900 dark:text-foreground">#{assignedLocker.locker?.locker_number}</p>
                  <p className="text-xs text-slate-500">{assignedLocker.locker?.size || 'Standard'} size{assignedLocker.end_date && ` · until ${format(new Date(assignedLocker.end_date), 'dd MMM yyyy')}`}</p>
                </div>
              ) : (
                <div className="py-2 text-center"><p className="mb-4 text-sm text-slate-500">No locker assigned</p><Button variant="outline" asChild><Link to="/my-requests">Request Locker</Link></Button></div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {member && (
        <PurchaseAddOnDrawer
          open={addOnOpen}
          onOpenChange={setAddOnOpen}
          memberId={member.id}
          memberName={profile?.full_name || undefined}
          membershipId={activeMembership?.id ?? null}
          branchId={member.branch_id}
          mode="member"
        />
      )}
    </AppLayout>
  );
}
