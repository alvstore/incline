import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Heart, AlertCircle, Calendar, Clock, Droplets, Sparkles, Gift, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';
import { EligibleAddOns } from '@/components/benefits/EligibleAddOns';
import { CombinedCreditsSummary } from '@/components/benefits/CombinedCreditsSummary';

export default function MyBenefits() {
  const { profile } = useAuth();
  const { member, activeMembership, isLoading: memberLoading } = useMemberData();
  const [addOnOpen, setAddOnOpen] = useState(false);

  // Fetch benefit credits
  const { data: benefitCredits = [], isLoading: creditsLoading } = useQuery({
    queryKey: ['my-benefit-credits', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_benefit_credits')
        .select(`
          *,
          benefit_type:benefit_types(id, name, code, icon)
        `)
        .eq('member_id', member!.id)
        .gte('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch benefit usage this month
  const { data: benefitUsage = [] } = useQuery({
    queryKey: ['my-benefit-usage', activeMembership?.id],
    enabled: !!activeMembership,
    queryFn: async () => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { data, error } = await supabase
        .from('benefit_usage')
        .select(`
          *,
          benefit_type:benefit_types(id, name, code)
        `)
        .eq('membership_id', activeMembership!.id)
        .gte('usage_date', monthStart)
        .order('usage_date', { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch upcoming bookings
  const { data: upcomingBookings = [] } = useQuery({
    queryKey: ['my-benefit-bookings', member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_bookings')
        .select(`
          *,
          slot:benefit_slots(id, slot_date, start_time, end_time, benefit_type, benefit_type_id)
        `)
        .eq('member_id', member!.id)
        .in('status', ['booked', 'confirmed'])
        .gte('slot.slot_date', new Date().toISOString().split('T')[0])
        .order('booked_at', { ascending: true })
        .limit(10);

      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = memberLoading || creditsLoading;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
          <p className="text-muted-foreground">Your account is not linked to a member profile.</p>
        </div>
      </AppLayout>
    );
  }

  // Resolve a display label + icon from either a string code or a {name, code} object
  const resolveBenefitMeta = (bt: any): { label: string; code: string } => {
    if (!bt) return { label: 'Benefit', code: '' };
    if (typeof bt === 'string') return { label: bt, code: bt };
    return { label: bt.name || bt.code || 'Benefit', code: bt.code || bt.name || '' };
  };

  const getBenefitIcon = (benefitType: any) => {
    const { code } = resolveBenefitMeta(benefitType);
    switch ((code || '').toLowerCase()) {
      case 'steam':
      case 'sauna':
        return <Droplets className="h-5 w-5" />;
      case 'spa':
        return <Sparkles className="h-5 w-5" />;
      default:
        return <Gift className="h-5 w-5" />;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Heart className="h-8 w-8 text-accent" />
              My Benefits
            </h1>
            <p className="text-muted-foreground">
              Track and manage your membership benefits
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAddOnOpen(true)} disabled={!activeMembership}>
              <Plus className="h-4 w-4 mr-2" />
              Buy Add-On Credits
            </Button>
            <Button asChild>
              <Link to="/book?type=recovery">
                <Calendar className="h-4 w-4 mr-2" />
                Book a Slot
              </Link>
            </Button>
          </div>
        </div>

        {/* Active Membership Info */}
        {activeMembership ? (
          <Card className="border-accent/20 bg-accent/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{activeMembership.plan?.name || 'Active Plan'}</h3>
                  <p className="text-sm text-muted-foreground">
                    Valid until {format(new Date(activeMembership.end_date), 'dd MMM yyyy')}
                  </p>
                </div>
                <Badge variant="default">Active</Badge>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-warning/20 bg-warning/5">
            <CardContent className="py-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-warning mb-4" />
              <h3 className="font-semibold">No Active Membership</h3>
              <p className="text-sm text-muted-foreground mt-2">
                You need an active membership to access benefits.
              </p>
              <Button asChild className="mt-4">
                <Link to="/my-requests">Request Membership</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Combined Plan + Add-On summary */}
        {benefitCredits.length > 0 && (
          <CombinedCreditsSummary
            credits={benefitCredits as any}
            onBuyAddon={() => setAddOnOpen(true)}
            disabled={!activeMembership}
          />
        )}

        {/* Benefit Credits */}
        {benefitCredits.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Your Benefit Credits</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {benefitCredits.map((credit) => {
                const usedCredits = credit.credits_total - credit.credits_remaining;
                const usagePercent = (usedCredits / credit.credits_total) * 100;
                const daysLeft = Math.ceil((new Date(credit.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                return (
                  <Card key={credit.id} className="border-border/50">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {getBenefitIcon(credit.benefit_type)}
                          {resolveBenefitMeta(credit.benefit_type).label}
                        </CardTitle>
                        <Badge variant={daysLeft <= 7 ? "destructive" : "outline"}>
                          {daysLeft} days left
                        </Badge>
                      </div>
                      <div className="mt-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {credit.package_id ? 'Add-on' : 'Plan'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Usage</span>
                            <span className="font-medium">
                              {credit.credits_remaining} / {credit.credits_total} remaining
                            </span>
                          </div>
                          <Progress value={100 - usagePercent} className="h-2" />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>Expires {format(new Date(credit.expires_at), 'dd MMM yyyy')}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming Bookings */}
        {upcomingBookings.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Upcoming Bookings</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingBookings.map((booking: any) => (
                <Card key={booking.id} className="border-border/50">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-accent/10">
                          <Calendar className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                          <p className="font-medium">{resolveBenefitMeta(booking.slot?.benefit_type).label}</p>
                          <p className="text-sm text-muted-foreground">
                            {booking.slot?.slot_date && format(new Date(booking.slot.slot_date), 'EEE, dd MMM')} • {booking.slot?.start_time} - {booking.slot?.end_time}
                          </p>
                        </div>
                      </div>
                      <Badge variant={booking.status === 'confirmed' ? 'default' : 'secondary'}>
                        {booking.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Recent Usage */}
        {benefitUsage.length > 0 && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Recent Usage This Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {benefitUsage.slice(0, 5).map((usage: any) => (
                  <div key={usage.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {getBenefitIcon(usage.benefit_type)}
                      <div>
                        <p className="font-medium">{resolveBenefitMeta(usage.benefit_type).label}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(usage.usage_date), 'EEE, dd MMM yyyy')}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">{usage.usage_count || 1} session(s)</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Available to add */}
        {member && (
          <EligibleAddOns
            memberId={member.id}
            memberName={profile?.full_name || undefined}
            membershipId={activeMembership?.id ?? null}
            branchId={member.branch_id}
            variant="grid"
          />
        )}

        {/* Empty State */}
        {benefitCredits.length === 0 && upcomingBookings.length === 0 && benefitUsage.length === 0 && (
          <Card className="border-border/50">
            <CardContent className="py-12 text-center">
              <Heart className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Benefits Yet</h3>
              <p className="text-muted-foreground mb-6">
                {activeMembership
                  ? 'Your plan may include extras. Buy benefit add-ons or check with staff.'
                  : 'You need an active membership to access benefits.'}
              </p>
              <Button onClick={() => setAddOnOpen(true)} disabled={!activeMembership}>
                <Plus className="h-4 w-4 mr-2" />
                Buy Add-On Credits
              </Button>
            </CardContent>
          </Card>
        )}
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
