import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  Calendar, Clock, CreditCard, Dumbbell, FileText, 
  TrendingUp, User, AlertCircle, CheckCircle, Lock, Gift, Snowflake, Sparkles, Plus, Heart
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getBenefitIcon } from '@/lib/benefitIcons';
import useEmblaCarousel from 'embla-carousel-react';
import { useState } from 'react';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';
import { EligibleAddOns } from '@/components/benefits/EligibleAddOns';

export default function MemberDashboard() {
  const { profile } = useAuth();
  const { 
    member, 
    activeMembership, 
    ptPackages, 
    recentAttendance, 
    pendingInvoices,
    upcomingClasses,
    daysRemaining,
    isLoading 
  } = useMemberData();

  const isFrozen = activeMembership?.status === 'frozen';
  const [emblaRef] = useEmblaCarousel({ loop: true });
  const [addOnOpen, setAddOnOpen] = useState(false);

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

  // Fetch benefit entitlements for active membership
  const { data: entitlements } = useQuery({
    queryKey: ['my-entitlements', activeMembership?.id],
    enabled: !!activeMembership?.id,
    queryFn: async () => {
      // Get plan benefits with benefit type details
      const { data: planBenefits, error: pbErr } = await supabase
        .from('plan_benefits')
        .select('*, benefit_types:benefit_type_id(name, icon, code, is_bookable)')
        .eq('plan_id', activeMembership!.plan_id);
      
      if (pbErr) { console.error('Error fetching plan benefits:', pbErr); return []; }
      if (!planBenefits || planBenefits.length === 0) return [];

      // Get usage for this membership
      const { data: usageData, error: uErr } = await supabase
        .from('benefit_usage')
        .select('benefit_type_id, usage_count')
        .eq('membership_id', activeMembership!.id);

      if (uErr) { console.error('Error fetching usage:', uErr); }

      // Aggregate usage by benefit_type_id
      const usageMap: Record<string, number> = {};
      (usageData || []).forEach((u: any) => {
        const key = u.benefit_type_id || 'unknown';
        usageMap[key] = (usageMap[key] || 0) + (u.usage_count || 1);
      });

      // Calculate membership duration in months
      const startDate = new Date(activeMembership!.start_date);
      const endDate = new Date(activeMembership!.end_date);
      const durationDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
      const durationMonths = Math.max(1, Math.round(durationDays / 30));

      return planBenefits.map((pb: any) => {
        const bt = pb.benefit_types;
        const typeId = pb.benefit_type_id;
        const used = usageMap[typeId] || 0;
        const frequency = pb.frequency || 'per_membership';
        const limitCount = pb.limit_count;

        let totalAllowed: number | null = null; // null = unlimited
        let periodLabel = '';

        if (!limitCount || limitCount <= 0) {
          // Unlimited
          totalAllowed = null;
          periodLabel = '';
        } else if (frequency === 'per_membership') {
          // Total pool — limit_count IS the total for the entire membership
          totalAllowed = limitCount;
          periodLabel = 'Total';
        } else if (frequency === 'daily') {
          totalAllowed = limitCount;
          periodLabel = 'per day';
        } else if (frequency === 'weekly') {
          totalAllowed = limitCount;
          periodLabel = 'per week';
        } else if (frequency === 'monthly') {
          totalAllowed = limitCount;
          periodLabel = 'per month';
        } else {
          totalAllowed = limitCount;
          periodLabel = '';
        }

        return {
          id: pb.id,
          name: bt?.name || 'Benefit',
          icon: bt?.icon || 'sparkles',
          code: bt?.code || 'other',
          isBookable: bt?.is_bookable || false,
          used,
          totalAllowed,
          periodLabel,
          frequency,
        };
      });
    },
  });

  if (isLoading) {
    return <AppLayout><div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div></AppLayout>;
  }

  if (!member) {
    return <AppLayout><div className="flex flex-col items-center justify-center min-h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-warning" /><h2 className="text-xl font-semibold">No Member Profile Found</h2><p className="text-muted-foreground">Your account is not linked to a member profile.</p></div></AppLayout>;
  }

  const activePtPackage = ptPackages.find(p => p.status === 'active');
  const totalPendingAmount = pendingInvoices.reduce((sum, inv) => sum + (inv.total_amount - (inv.amount_paid || 0)), 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome, {profile?.full_name?.split(' ')[0] || 'Member'}!
            </h1>
            <p className="text-muted-foreground">
              Member ID: {member.member_code} • {member.branch?.name}
            </p>
          </div>
          {isFrozen ? (
            <div className="text-right">
              <Badge className="w-fit bg-info/10 text-info border-info/30 hover:bg-info/20">
                <Snowflake className="h-3.5 w-3.5 mr-1" />
                FROZEN — {activeMembership?.plan?.name || 'Plan'}
              </Badge>
              {freezeDetails?.end_date && (
                <p className="text-xs text-muted-foreground mt-1">
                  {differenceInDays(new Date(freezeDetails.end_date), new Date()) > 0
                    ? `${differenceInDays(new Date(freezeDetails.end_date), new Date())} days remaining`
                    : 'Freeze ending soon'}
                  {' • Ends '}{format(new Date(freezeDetails.end_date), 'dd MMM yyyy')}
                </p>
              )}
            </div>
          ) : (
            <Badge variant={activeMembership ? "default" : "destructive"} className="w-fit">
              {activeMembership ? 'Active Membership' : 'No Active Membership'}
            </Badge>
          )}
        </div>

        {/* Ad Banners Carousel */}
        {banners.length > 0 && (
          <div className="overflow-hidden rounded-2xl" ref={emblaRef}>
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

        {/* Frozen Alert */}
        {isFrozen && (
          <Alert className="border-info/30 bg-info/5">
            <Snowflake className="h-4 w-4 text-info" />
            <AlertTitle className="text-info">Membership Frozen — {activeMembership?.plan?.name}</AlertTitle>
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-muted-foreground">Your membership is currently paused. Gym access and bookings are disabled.</span>
              <Button size="sm" variant="outline" className="w-fit border-info/30 text-info hover:bg-info/10" asChild>
                <Link to="/my-requests">Request Unfreeze</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Primary Stats */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <StatCard
            title="Membership Status"
            value={isFrozen ? 'Frozen' : (activeMembership ? activeMembership.plan?.name || 'Active' : 'Inactive')}
            icon={isFrozen ? Snowflake : CreditCard}
            description={isFrozen ? 'Membership Paused' : (activeMembership ? `${daysRemaining} days remaining` : 'Renew now')}
            variant={isFrozen ? "default" : (activeMembership ? "success" : "destructive")}
          />
          <StatCard
            title="PT Sessions"
            value={activePtPackage?.sessions_remaining || 0}
            icon={Dumbbell}
            description={activePtPackage ? `of ${activePtPackage.sessions_total} remaining` : 'No active package'}
            variant="accent"
          />
          <StatCard
            title="This Month Visits"
            value={recentAttendance.filter(a => new Date(a.check_in).getMonth() === new Date().getMonth()).length}
            icon={Clock}
            variant="default"
          />
          <div className="flex flex-col">
            <StatCard
              title="Pending Dues"
              value={`₹${totalPendingAmount.toLocaleString()}`}
              icon={FileText}
              description={pendingInvoices.length > 0 ? `${pendingInvoices.length} invoice(s)` : 'All paid'}
              variant={totalPendingAmount > 0 ? "warning" : "success"}
            />
            {totalPendingAmount > 0 && pendingInvoices[0]?.id && (
              <Button asChild size="sm" className="mt-2 rounded-xl bg-gradient-to-r from-warning to-warning hover:from-warning hover:to-warning text-primary-foreground">
                <Link to={`/member/pay?invoice=${pendingInvoices[0].id}`}>
                  <CreditCard className="h-3.5 w-3.5 mr-1.5" /> Pay Now
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-4">
          {isFrozen ? (
            <Card className="opacity-50 cursor-not-allowed h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <Calendar className="h-8 w-8 text-muted-foreground" />
                <span className="font-medium text-muted-foreground">Book & Schedule</span>
                <span className="text-xs text-muted-foreground">Disabled while frozen</span>
              </CardContent>
            </Card>
          ) : (
            <Link to="/my-classes">
              <Card className="hover:border-accent/50 transition-colors cursor-pointer h-full">
                <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                  <Calendar className="h-8 w-8 text-accent" />
                  <span className="font-medium">Book & Schedule</span>
                </CardContent>
              </Card>
            </Link>
          )}
          <Link to="/my-progress">
            <Card className="hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <TrendingUp className="h-8 w-8 text-success" />
                <span className="font-medium">View Progress</span>
              </CardContent>
            </Card>
          </Link>
          <Link to="/member-store">
            <Card className="hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <CreditCard className="h-8 w-8 text-warning" />
                <span className="font-medium">Shop Products</span>
              </CardContent>
            </Card>
          </Link>
          <Link to="/my-referrals">
            <Card className="hover:border-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                <Gift className="h-8 w-8 text-primary" />
                <span className="font-medium">Refer & Earn</span>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Eligible Add-Ons strip */}
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

        <div className="grid gap-6 md:grid-cols-2">
          {/* My Entitlements */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-accent" />
                My Entitlements
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!activeMembership ? (
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-4">No active membership</p>
                  <Button variant="outline" asChild><Link to="/my-requests">Get Membership</Link></Button>
                </div>
              ) : !entitlements || entitlements.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-muted-foreground">No benefits configured for your plan</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {entitlements.map((ent: any) => {
                    const IconComponent = getBenefitIcon(ent.icon || ent.code);
                    // Sum purchased add-on credits for this benefit type (matches by name OR code, case-insensitive)
                    const matchingCredits = (benefitCredits as any[]).filter((c: any) => {
                      const cName = (c.benefit_type?.name || c.benefit_type || '').toString().toLowerCase();
                      const cCode = (c.benefit_type?.code || '').toString().toLowerCase();
                      return cName === (ent.name || '').toLowerCase() || cCode === (ent.code || '').toLowerCase();
                    });
                    const addOnRemaining = matchingCredits.reduce((s: number, c: any) => s + (c.credits_remaining || 0), 0);
                    const planRemaining = ent.totalAllowed !== null ? Math.max(0, ent.totalAllowed - ent.used) : null;
                    const totalRemaining = planRemaining === null ? null : planRemaining + addOnRemaining;

                    return (
                      <div key={ent.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-accent/10 flex items-center justify-center">
                            <IconComponent className="h-4.5 w-4.5 text-accent" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{ent.name}</p>
                            {ent.periodLabel && (
                              <p className="text-xs text-muted-foreground capitalize">{ent.periodLabel}</p>
                            )}
                            {addOnRemaining > 0 && totalRemaining !== null && (
                              <p className="text-[10px] text-destructive font-medium mt-0.5">
                                Includes +{addOnRemaining} add-on credit{addOnRemaining !== 1 ? 's' : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {totalRemaining === null ? (
                            <Badge variant="outline" className="text-success border-success/30">Unlimited</Badge>
                          ) : (
                            <span className="text-sm font-semibold">
                              {totalRemaining}{' '}
                              <span className="text-muted-foreground font-normal">
                                / {(ent.totalAllowed || 0) + addOnRemaining}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* Add-On Credits (purchased extras) */}
                  {benefitCredits.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Heart className="h-3 w-3 text-destructive" /> Add-On Credits
                      </p>
                      {benefitCredits.map((credit: any) => {
                        const daysLeft = Math.ceil((new Date(credit.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={credit.id} className="flex items-center justify-between p-2.5 bg-destructive/10 dark:bg-destructive/10 rounded-lg">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-7 w-7 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                                <Sparkles className="h-3.5 w-3.5 text-destructive" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{credit.benefit_type?.name || 'Add-On'}</p>
                                <p className="text-[10px] text-muted-foreground">Exp. {format(new Date(credit.expires_at), 'dd MMM')} · {daysLeft}d left</p>
                              </div>
                            </div>
                            <span className="text-sm font-bold text-destructive shrink-0">
                              {credit.credits_remaining}<span className="text-[10px] font-normal text-muted-foreground">/{credit.credits_total}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!isFrozen && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/my-classes">Book Now</Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAddOnOpen(true)}
                        disabled={!activeMembership}
                        className="border-destructive/30 text-destructive hover:bg-destructive/10"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Buy Add-On
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Membership Details */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {isFrozen ? <Snowflake className="h-5 w-5 text-info" /> : <CreditCard className="h-5 w-5" />}
                Membership Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeMembership ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium">{activeMembership.plan?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {isFrozen ? (
                      <Badge className="bg-info/10 text-info border-info/30"><Snowflake className="h-3 w-3 mr-1" />Frozen</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start Date</span>
                    <span>{format(new Date(activeMembership.start_date), 'dd MMM yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">End Date</span>
                    <span>{format(new Date(activeMembership.end_date), 'dd MMM yyyy')}</span>
                  </div>
                  {!isFrozen && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Days Remaining</span>
                      <Badge variant={daysRemaining > 7 ? "default" : "destructive"}>{daysRemaining} days</Badge>
                    </div>
                  )}
                  {isFrozen && (
                    <Button className="w-full" variant="outline" asChild>
                      <Link to="/my-requests">Request Unfreeze</Link>
                    </Button>
                  )}
                  {!isFrozen && daysRemaining <= 7 && (
                    <Button className="w-full" asChild>
                      <Link to="/my-requests">Request Renewal</Link>
                    </Button>
                  )}
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-4">No active membership</p>
                  <Button asChild><Link to="/my-requests">Request Membership</Link></Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Classes */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Calendar className="h-5 w-5" />Upcoming Classes</CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingClasses.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-4">No upcoming classes</p>
                  {!isFrozen && <Button variant="outline" asChild><Link to="/my-classes">Book a Class</Link></Button>}
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingClasses.slice(0, 3).map((booking: any) => (
                    <div key={booking.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{booking.class?.name}</p>
                        <p className="text-sm text-muted-foreground">{format(new Date(booking.class?.scheduled_at), 'EEE, dd MMM • HH:mm')}</p>
                      </div>
                      <Badge variant="outline">Booked</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Attendance */}
          <Card className="border-border/50">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" />Recent Attendance</CardTitle></CardHeader>
            <CardContent>
              {recentAttendance.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No attendance records</p>
              ) : (
                <div className="space-y-3">
                  {recentAttendance.slice(0, 5).map((record) => (
                    <div key={record.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-success" /><span>{format(new Date(record.check_in), 'dd MMM yyyy')}</span></div>
                      <span className="text-sm text-muted-foreground">{format(new Date(record.check_in), 'HH:mm')}{record.check_out && ` - ${format(new Date(record.check_out), 'HH:mm')}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assigned Trainer */}
          <Card className="border-border/50">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Dumbbell className="h-5 w-5" />My Trainer</CardTitle></CardHeader>
            <CardContent>
              {member.assigned_trainer ? (
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center"><User className="h-6 w-6 text-accent" /></div>
                  <div><p className="font-medium">{(member.assigned_trainer as any)?.profile?.full_name || 'Trainer'}</p><p className="text-sm text-muted-foreground">Personal Trainer</p></div>
                </div>
              ) : activePtPackage?.trainer ? (
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center"><User className="h-6 w-6 text-accent" /></div>
                  <div><p className="font-medium">{(activePtPackage.trainer as any)?.profiles?.full_name || 'Trainer'}</p><p className="text-sm text-muted-foreground">PT Package Trainer</p></div>
                </div>
              ) : (
                <div className="text-center py-4"><p className="text-muted-foreground mb-4">No trainer assigned</p><Button variant="outline" asChild><Link to="/my-requests">Request Trainer</Link></Button></div>
              )}
            </CardContent>
          </Card>

          {/* Assigned Locker */}
          <Card className="border-border/50">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5" />My Locker</CardTitle></CardHeader>
            <CardContent>
              {assignedLocker ? (
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center"><Lock className="h-6 w-6 text-warning" /></div>
                  <div>
                    <p className="font-medium">Locker #{assignedLocker.locker?.locker_number}</p>
                    <p className="text-sm text-muted-foreground">{assignedLocker.locker?.size || 'Standard'} Size{assignedLocker.end_date && ` • Until ${format(new Date(assignedLocker.end_date), 'dd MMM yyyy')}`}</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4"><p className="text-muted-foreground mb-4">No locker assigned</p><Button variant="outline" asChild><Link to="/my-requests">Request Locker</Link></Button></div>
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
