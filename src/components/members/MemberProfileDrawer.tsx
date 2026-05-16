import { useEffect, useState, useMemo, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  User, Users, Phone, Mail, Calendar, MapPin, Building2, 
  CreditCard, Dumbbell, Clock, Gift, AlertCircle,
  CheckCircle, XCircle, Pause, History, Snowflake, 
  Play, UserCog, IndianRupee, Ruler, UserMinus, UserCheck,
  Award, Copy, Share2, MessageCircle, Edit, Heart, Activity, Plus, FileText, Download,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { differenceInDays, format } from 'date-fns';
import { toast } from 'sonner';
import { FreezeMembershipDrawer } from './FreezeMembershipDrawer';
import { UnfreezeMembershipDrawer } from './UnfreezeMembershipDrawer';
import { AssignTrainerDrawer } from './AssignTrainerDrawer';
import { RecordMeasurementDrawer } from './RecordMeasurementDrawer';
import { CancelMembershipDrawer } from './CancelMembershipDrawer';
import { MeasurementProgressView } from './MeasurementProgressView';
import { EditProfileDrawer } from './EditProfileDrawer';
import { MemberPlanProgressBlock } from '@/components/fitness/member/MemberPlanProgressBlock';
import { RecordBenefitUsageDrawer } from '../benefits/RecordBenefitUsageDrawer';
import { TopUpBenefitDrawer } from '../benefits/TopUpBenefitDrawer';
import { PurchaseAddOnDrawer } from '../benefits/PurchaseAddOnDrawer';
import { fetchMemberRewards, claimReward, fetchMemberReferrals } from '@/services/referralService';
import { RecordPaymentDrawer } from '@/components/invoices/RecordPaymentDrawer';
import { CompGiftDrawer } from './CompGiftDrawer';
import { DocumentVaultTab } from './DocumentVaultTab';
import { MemberRegistrationFormDrawer } from './MemberRegistrationForm';
import { TransferBranchDrawer } from './TransferBranchDrawer';
import { TransferMembershipDrawer } from './TransferMembershipDrawer';
import { RewardsWalletCard } from './RewardsWalletCard';
import { invalidateMembersData } from '@/lib/memberInvalidation';

// ─── Pending Invoices Section ───
function PendingInvoicesSection({ memberId, branchId }: { memberId: string; branchId: string }) {
  const [paymentDrawerOpen, setPaymentDrawerOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ['member-pending-invoices', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, total_amount, amount_paid, status, due_date, invoice_type')
        .eq('member_id', memberId)
        .in('status', ['pending', 'partial', 'overdue'])
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!memberId,
  });

  if (pendingInvoices.length === 0) return null;

  return (
    <>
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Pending Dues ({pendingInvoices.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendingInvoices.map((inv: any) => {
            const due = (inv.total_amount || 0) - (inv.amount_paid || 0);
            return (
              <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div>
                  <p className="text-sm font-medium">{inv.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">
                    Total: ₹{inv.total_amount?.toLocaleString('en-IN')} · Paid: ₹{(inv.amount_paid || 0).toLocaleString('en-IN')}
                  </p>
                  {inv.due_date && (
                    <p className="text-xs text-muted-foreground">Due: {format(new Date(inv.due_date), 'dd MMM yyyy')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-xs">₹{due.toLocaleString('en-IN')}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedInvoice(inv);
                      setPaymentDrawerOpen(true);
                    }}
                  >
                    <IndianRupee className="h-3 w-3 mr-1" />Pay
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {selectedInvoice && (
        <RecordPaymentDrawer
          open={paymentDrawerOpen}
          onOpenChange={(open) => {
            setPaymentDrawerOpen(open);
            if (!open) {
              queryClient.invalidateQueries({ queryKey: ['member-pending-invoices', memberId] });
              queryClient.invalidateQueries({ queryKey: ['member-payments', memberId] });
            }
          }}
          invoice={selectedInvoice}
          branchId={branchId}
        />
      )}
    </>
  );
}

// ─── Benefits & Usage Tab ───
function BenefitsUsageTab({ memberId, activeMembership, branchId, memberGender }: { memberId: string; activeMembership: any; branchId: string; memberGender?: string | null }) {
  const queryClient = useQueryClient();
  const [usageDrawerOpen, setUsageDrawerOpen] = useState(false);
  const [topUpDrawerOpen, setTopUpDrawerOpen] = useState(false);
  const [topUpBenefit, setTopUpBenefit] = useState<any>(null);
  const [addOnOpen, setAddOnOpen] = useState(false);

  // Member-level comps (gifts) — independent of plan
  const { data: comps = [] } = useQuery({
    queryKey: ['member-comps-profile', memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_comps')
        .select('id, comp_sessions, used_sessions, benefit_type_id, benefit_types(id, name, code)')
        .eq('member_id', memberId);
      if (error) throw error;
      return data || [];
    },
  });

  // Realtime: keep comps + usage live
  useEffect(() => {
    if (!memberId) return;
    const channel = supabase
      .channel(`member-profile-benefits-${memberId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_comps', filter: `member_id=eq.${memberId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['member-comps-profile', memberId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'benefit_usage', filter: activeMembership?.id ? `membership_id=eq.${activeMembership.id}` : undefined }, () => {
        queryClient.invalidateQueries({ queryKey: ['member-benefit-usage-summary', activeMembership?.id] });
        queryClient.invalidateQueries({ queryKey: ['member-benefit-bookings-recent', memberId, activeMembership?.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [memberId, activeMembership?.id, queryClient]);

  const { data: planBenefits = [] } = useQuery({
    queryKey: ['member-plan-benefits', activeMembership?.plan_id],
    queryFn: async () => {
      if (!activeMembership?.plan_id) return [];
      const { data, error } = await supabase
        .from('plan_benefits')
        .select('*, benefit_types:benefit_type_id(id, name, code, icon)')
        .eq('plan_id', activeMembership.plan_id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeMembership?.plan_id,
  });

  // Fetch facility gender_access for benefit types to filter by member gender
  const benefitTypeIds = planBenefits.map((b: any) => b.benefit_type_id).filter(Boolean);
  const { data: facilityGenderMap = [] } = useQuery({
    queryKey: ['facility-gender-map', benefitTypeIds],
    queryFn: async () => {
      if (!benefitTypeIds.length) return [];
      const { data } = await supabase
        .from('facilities')
        .select('benefit_type_id, gender_access')
        .in('benefit_type_id', benefitTypeIds);
      return data || [];
    },
    enabled: benefitTypeIds.length > 0,
  });

  // Real usage from benefit_usage table
  const { data: usageSummary = [] } = useQuery({
    queryKey: ['member-benefit-usage-summary', activeMembership?.id],
    queryFn: async () => {
      if (!activeMembership?.id) return [];
      const { data, error } = await supabase
        .from('benefit_usage')
        .select('benefit_type_id, usage_count')
        .eq('membership_id', activeMembership.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeMembership?.id,
  });

  // Recent bookings with facility details
  const { data: recentBookings = [] } = useQuery({
    queryKey: ['member-benefit-bookings-recent', memberId, activeMembership?.id],
    queryFn: async () => {
      if (!activeMembership?.id) return [];
      const { data, error } = await supabase
        .from('benefit_bookings')
        .select('id, status, booked_at, cancelled_at, slot_id')
        .eq('member_id', memberId)
        .eq('membership_id', activeMembership.id)
        .order('booked_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      if (!data?.length) return [];

      // Fetch slot details
      const slotIds = [...new Set(data.map(b => b.slot_id))];
      const { data: slots } = await supabase
        .from('benefit_slots')
        .select('id, slot_date, start_time, end_time, facility_id')
        .in('id', slotIds);

      // Fetch facility names
      const facilityIds = [...new Set((slots || []).map(s => s.facility_id).filter(Boolean))] as string[];
      let facilityMap: Record<string, string> = {};
      if (facilityIds.length > 0) {
        const { data: facilities } = await supabase
          .from('facilities')
          .select('id, name')
          .in('id', facilityIds);
        facilityMap = (facilities || []).reduce((acc, f) => { acc[f.id] = f.name; return acc; }, {} as Record<string, string>);
      }

      const slotMap = (slots || []).reduce((acc, s) => {
        acc[s.id] = { ...s, facility_name: s.facility_id ? facilityMap[s.facility_id] || 'Facility' : 'Facility' };
        return acc;
      }, {} as Record<string, any>);

      return data.map(b => ({
        ...b,
        slot: slotMap[b.slot_id] || null,
      }));
    },
    enabled: !!activeMembership?.id,
  });

  const getFrequencyLabel = (f: string) => {
    const map: Record<string, string> = { unlimited: 'Unlimited', daily: '/day', weekly: '/week', monthly: '/month', per_membership: 'total' };
    return map[f] || f;
  };

  // Compute real used counts per benefit_type_id
  const usageMap = useMemo(() => {
    const map: Record<string, number> = {};
    usageSummary.forEach((u: any) => {
      if (u.benefit_type_id) {
        map[u.benefit_type_id] = (map[u.benefit_type_id] || 0) + (u.usage_count || 1);
      }
    });
    return map;
  }, [usageSummary]);

  // Aggregate active comps by benefit_type_id
  const compMap = useMemo(() => {
    const map: Record<string, { total: number; used: number; remaining: number; name?: string }> = {};
    (comps as any[]).forEach((c) => {
      if (!c.benefit_type_id) return;
      const m = map[c.benefit_type_id] || { total: 0, used: 0, remaining: 0, name: c.benefit_types?.name };
      m.total += c.comp_sessions || 0;
      m.used += c.used_sessions || 0;
      m.remaining += Math.max(0, (c.comp_sessions || 0) - (c.used_sessions || 0));
      m.name = m.name || c.benefit_types?.name;
      map[c.benefit_type_id] = m;
    });
    return map;
  }, [comps]);

  const planBenefitTypeIds = new Set<string>();
  const planRows = planBenefits.map((b: any) => {
    const isUnlimited = b.frequency === 'unlimited';
    const used = b.benefit_type_id ? (usageMap[b.benefit_type_id] || 0) : 0;
    const planLimit = b.limit_count || 0;
    const planRemaining = isUnlimited ? null : Math.max(0, planLimit - used);
    if (b.benefit_type_id) planBenefitTypeIds.add(b.benefit_type_id);
    const comp = b.benefit_type_id ? compMap[b.benefit_type_id] : undefined;
    const compTotal = comp?.total || 0;
    const compUsed = comp?.used || 0;
    const compRemaining = comp?.remaining || 0;
    const totalLimit = planLimit + compTotal;
    const totalUsed = used + compUsed;
    const totalRemaining = isUnlimited ? null : Math.max(0, totalLimit - totalUsed);
    return {
      benefit_type: b.benefit_type,
      benefit_type_id: b.benefit_type_id,
      label: b.benefit_types?.name || b.benefit_type,
      name: b.benefit_types?.name || b.benefit_type,
      frequency: b.frequency,
      limit_count: b.limit_count,
      description: b.description,
      used,
      remaining: planRemaining,
      isUnlimited,
      compTotal,
      compUsed,
      compRemaining,
      totalLimit,
      totalUsed,
      totalRemaining,
      isGiftOnly: false,
    };
  }).filter((b: any) => {
    if (!memberGender) return true;
    const facility = facilityGenderMap.find((f: any) => f.benefit_type_id === b.benefit_type_id);
    if (!facility) return true;
    return facility.gender_access === 'unisex' || facility.gender_access === memberGender;
  });

  // Append gift-only benefits (comps for benefit types not in plan)
  const giftOnlyRows = Object.entries(compMap)
    .filter(([btId]) => !planBenefitTypeIds.has(btId))
    .map(([btId, c]) => ({
      benefit_type: 'other',
      benefit_type_id: btId,
      label: c.name || 'Gift Benefit',
      name: c.name || 'Gift Benefit',
      frequency: 'per_membership',
      limit_count: c.total,
      description: 'Complimentary sessions',
      used: c.used,
      remaining: c.remaining,
      isUnlimited: false,
      compTotal: c.total,
      compUsed: c.used,
      compRemaining: c.remaining,
      totalLimit: c.total,
      totalUsed: c.used,
      totalRemaining: c.remaining,
      isGiftOnly: true,
    }));

  const availableBenefits = [...planRows, ...giftOnlyRows];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'booked': case 'confirmed': return <Badge variant="secondary" className="text-[10px]">Booked</Badge>;
      case 'attended': case 'checked_in': return <Badge variant="default" className="text-[10px]">Attended</Badge>;
      case 'cancelled': return <Badge variant="outline" className="text-[10px]">Cancelled</Badge>;
      case 'no_show': return <Badge variant="destructive" className="text-[10px]">No Show</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  return (
    <TabsContent value="benefits" className="space-y-4 mt-4">
      {!activeMembership ? (
        <Card>
          <CardContent className="pt-4 text-center text-muted-foreground">
            <Heart className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No active membership to show benefits</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  Plan Entitlements
                </CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="default" onClick={() => setAddOnOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Sell Add-On
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setUsageDrawerOpen(true)}>
                    <Activity className="h-3 w-3 mr-1" />
                    Log Usage
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {availableBenefits.length > 0 ? (
                <div className="space-y-3">
                  {availableBenefits.map((b: any, idx: number) => {
                    const totalLimit = b.totalLimit ?? b.limit_count ?? 0;
                    const totalUsed = b.totalUsed ?? b.used ?? 0;
                    const totalRemaining = b.isUnlimited ? null : (b.totalRemaining ?? Math.max(0, totalLimit - totalUsed));
                    const progressPct = b.isUnlimited ? 100 : totalLimit ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;
                    const isExhausted = !b.isUnlimited && totalRemaining === 0;
                    const hasComp = (b.compTotal || 0) > 0;
                    const isGiftOnly = !!b.isGiftOnly;
                    const barColor = b.isUnlimited
                      ? 'bg-blue-500'
                      : isExhausted
                        ? 'bg-destructive'
                        : isGiftOnly
                          ? 'bg-amber-500'
                          : 'bg-emerald-500';
                    const borderColor = b.isUnlimited
                      ? 'border-l-blue-500'
                      : isExhausted
                        ? 'border-l-destructive'
                        : isGiftOnly
                          ? 'border-l-amber-500'
                          : 'border-l-emerald-500';

                    return (
                      <div key={idx} className={`p-3 rounded-lg bg-muted/50 border-l-4 ${borderColor}`}>
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Heart className={`h-4 w-4 ${isGiftOnly ? 'text-amber-600' : 'text-primary'}`} />
                            <span className="font-medium text-sm truncate">{b.name}</span>
                            {hasComp && !isGiftOnly && (
                              <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px] gap-1 shrink-0">
                                <Gift className="h-3 w-3" /> +{b.compRemaining} gift
                              </Badge>
                            )}
                            {isGiftOnly && (
                              <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px] gap-1 shrink-0">
                                <Gift className="h-3 w-3" /> Gift
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {b.isUnlimited ? (
                              <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-xs">
                                ∞ Unlimited{hasComp ? ` + ${b.compRemaining}` : ''}
                              </Badge>
                            ) : (
                              <div className="text-right">
                                <span className={`text-xs font-semibold ${isExhausted ? 'text-destructive' : 'text-foreground'}`}>
                                  {totalUsed}/{totalLimit} {getFrequencyLabel(b.frequency)}
                                </span>
                                {hasComp && !isGiftOnly && (
                                  <div className="text-[10px] text-muted-foreground leading-tight">
                                    {b.limit_count || 0} plan + <span className="text-amber-700 font-medium">{b.compTotal} gift</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        {!b.isUnlimited && totalLimit > 0 && (
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        )}
                        {b.isUnlimited && (
                          <div className="h-2 bg-blue-500/20 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500 w-full animate-pulse opacity-40" />
                          </div>
                        )}
                        {isExhausted && b.benefit_type_id && !isGiftOnly && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 w-full text-xs h-7"
                            onClick={() => {
                              setTopUpBenefit(b);
                              setTopUpDrawerOpen(true);
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Top Up Sessions
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No benefits included in this plan</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent Bookings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentBookings.length > 0 ? (
                <div className="space-y-2">
                  {recentBookings.map((b: any) => (
                    <div key={b.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <div>
                        <p className="text-sm font-medium">{b.slot?.facility_name || 'Facility'}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.slot?.slot_date ? format(new Date(b.slot.slot_date), 'dd MMM yyyy') : 'N/A'}
                          {b.slot?.start_time ? ` • ${b.slot.start_time.slice(0, 5)} - ${b.slot.end_time?.slice(0, 5)}` : ''}
                        </p>
                      </div>
                      {getStatusBadge(b.status)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No bookings recorded yet</p>
              )}
            </CardContent>
          </Card>

          <RecordBenefitUsageDrawer
            open={usageDrawerOpen}
            onOpenChange={setUsageDrawerOpen}
            membershipId={activeMembership.id}
            memberId={memberId}
            memberName=""
            availableBenefits={availableBenefits}
          />

          {topUpBenefit && (
            <TopUpBenefitDrawer
              open={topUpDrawerOpen}
              onOpenChange={setTopUpDrawerOpen}
              memberId={memberId}
              membershipId={activeMembership.id}
              branchId={branchId}
              benefitName={topUpBenefit.name}
              benefitTypeId={topUpBenefit.benefit_type_id}
              benefitType={topUpBenefit.benefit_type}
            />
          )}

          <PurchaseAddOnDrawer
            open={addOnOpen}
            onOpenChange={setAddOnOpen}
            memberId={memberId}
            membershipId={activeMembership.id}
            branchId={branchId}
            mode="staff"
          />
        </>
      )}
    </TabsContent>
  );
}

interface MemberProfileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: any;
  onPurchaseMembership: () => void;
  onPurchasePT: () => void;
}

type RecentActivityItem = {
  id: string;
  timestamp: string;
  type: 'check_in' | 'check_out' | 'membership' | 'payment' | 'pt_package';
  title: string;
  subtitle?: string;
  amount?: number | null;
  badge: string;
};

export function MemberProfileDrawer({ 
  open, 
  onOpenChange, 
  member,
  onPurchaseMembership,
  onPurchasePT
}: MemberProfileDrawerProps) {
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const isManagerOrAbove = hasAnyRole(['owner', 'admin', 'manager']);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [unfreezeOpen, setUnfreezeOpen] = useState(false);
  const [assignTrainerOpen, setAssignTrainerOpen] = useState(false);
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [compGiftOpen, setCompGiftOpen] = useState(false);
  const [registrationFormOpen, setRegistrationFormOpen] = useState(false);
  const [transferBranchOpen, setTransferBranchOpen] = useState(false);
  const [transferMembershipOpen, setTransferMembershipOpen] = useState(false);
  const tabsScrollRef = useRef<HTMLDivElement>(null);

  const scrollTabs = (dir: 'left' | 'right') => {
    if (tabsScrollRef.current) {
      tabsScrollRef.current.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
    }
  };

  const toggleMemberStatus = async () => {
    if (!member?.id) return;
    setIsTogglingStatus(true);
    try {
      const newStatus = member.status === 'active' ? 'inactive' : 'active';
      const { error } = await supabase
        .from('members')
        .update({ status: newStatus })
        .eq('id', member.id);
      
      if (error) throw error;
      toast.success(newStatus === 'active' ? 'Member activated' : 'Member deactivated');
      invalidateMembersData(queryClient);
    } catch (error) {
      toast.error('Failed to update member status');
    } finally {
      setIsTogglingStatus(false);
    }
  };

  // Fetch full member details with all relations
  const { data: memberDetails } = useQuery({
    queryKey: ['member-details', member?.id],
    queryFn: async () => {
      if (!member?.id) return null;
      
      const { data, error } = await supabase
        .from('members')
        .select(`
          *,
          profiles:user_id(
            full_name, email, phone, avatar_url, gender, date_of_birth,
            address, city, state, emergency_contact_name, emergency_contact_phone
          ),
          branch:branch_id(name, code),
          created_by_profile:created_by(full_name, email),
          memberships(
            *,
            membership_plans(name, duration_days, price, is_transferable)
          ),
          member_pt_packages(
            *,
            pt_packages(name, total_sessions),
            trainers(user_id)
          ),
          referrer:referred_by(member_code, user_id)
        `)
        .eq('id', member.id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!member?.id && open,
  });

  // Fetch referrer name from profile
  const referrerUserId = (memberDetails?.referrer as any)?.user_id;
  const { data: referrerProfile } = useQuery({
    queryKey: ['referrer-profile', referrerUserId],
    queryFn: async () => {
      if (!referrerUserId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', referrerUserId)
        .single();
      return data;
    },
    enabled: !!referrerUserId,
  });

  // Fetch assigned trainer name
  const assignedTrainerId = memberDetails?.assigned_trainer_id || member?.assigned_trainer_id;
  const { data: assignedTrainerProfile } = useQuery({
    queryKey: ['assigned-trainer-profile', assignedTrainerId],
    queryFn: async () => {
      if (!assignedTrainerId) return null;
      const { data: trainer } = await supabase
        .from('trainers')
        .select('user_id')
        .eq('id', assignedTrainerId)
        .single();
      if (!trainer?.user_id) return null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', trainer.user_id)
        .single();
      return profile;
    },
    enabled: !!assignedTrainerId,
  });

  // Fetch wallet balance
  const { data: memberWallet } = useQuery({
    queryKey: ['member-wallet-balance', member?.id],
    queryFn: async () => {
      if (!member?.id) return null;
      const { data } = await supabase
        .from('wallets')
        .select('balance')
        .eq('member_id', member.id)
        .maybeSingle();
      return data;
    },
    enabled: !!member?.id && open,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['member-payments', member?.id],
    queryFn: async () => {
      if (!member?.id) return [];
      
      const { data, error } = await supabase
        .from('payments')
        .select(`
          *,
          invoices(invoice_number)
        `)
        .eq('member_id', member.id)
        .order('payment_date', { ascending: false })
        .limit(10);
      
      if (error) throw error;

      // Fetch receiver names from profiles separately (received_by references auth.users, not profiles)
      const receiverIds = [...new Set(data?.filter(p => p.received_by).map(p => p.received_by) || [])];
      let receiverMap: Record<string, string> = {};
      if (receiverIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', receiverIds);
        if (profiles) {
          receiverMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name]));
        }
      }

      return (data || []).map(p => ({
        ...p,
        received_by_name: p.received_by ? receiverMap[p.received_by] || null : null,
      }));
    },
    enabled: !!member?.id && open,
  });

  // Fetch attendance history
  const { data: attendance = [] } = useQuery({
    queryKey: ['member-attendance', member?.id],
    queryFn: async () => {
      if (!member?.id) return [];
      
      const { data, error } = await supabase
        .from('member_attendance')
        .select('*')
        .eq('member_id', member.id)
        .order('check_in', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
    enabled: !!member?.id && open,
  });

  const { data: registrationFormDocument } = useQuery({
    queryKey: ['member-registration-form', member?.id],
    queryFn: async () => {
      if (!member?.id) return null;
      const { data, error } = await supabase
        .from('member_documents')
        .select('id, file_name, created_at, storage_path, file_url')
        .eq('member_id', member.id)
        .eq('document_type', 'registration_form')
        .order('created_at', { ascending: false })
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!member?.id && open,
  });

  // Fetch rewards
  const { data: rewards = [] } = useQuery({
    queryKey: ['member-rewards', member?.id],
    queryFn: () => fetchMemberRewards(member.id),
    enabled: !!member?.id && open,
  });

  // Fetch referrals
  const { data: referrals = [] } = useQuery({
    queryKey: ['member-referrals', member?.id],
    queryFn: () => fetchMemberReferrals(member.id),
    enabled: !!member?.id && open,
  });

  // Claim reward mutation
  const claimRewardMutation = useMutation({
    mutationFn: (rewardId: string) => claimReward(rewardId, member.id),
    onSuccess: () => {
      toast.success('Reward claimed successfully!');
      queryClient.invalidateQueries({ queryKey: ['member-rewards', member?.id] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to claim reward');
    },
  });

  const copyReferralCode = () => {
    const code = member.member_code;
    navigator.clipboard.writeText(code);
    toast.success('Referral code copied!');
  };

  const shareViaWhatsApp = () => {
    const code = member.member_code;
    const message = `Join ${theme?.gymName || 'our gym'} with my referral code: ${code} and get exclusive rewards!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const shareViaEmail = () => {
    const code = member.member_code;
    const subject = `Join me at ${theme?.gymName || 'our gym'}!`;
    const body = `Hey!\n\nI'd love for you to join my gym. Use my referral code: ${code} when signing up to get exclusive rewards!\n\nSee you there!`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  const [theme, setTheme] = useState<any>(null);

  useEffect(() => {
    import('@/services/cmsService').then(({ cmsService }) => {
      setTheme(cmsService.getTheme());
    });
  }, []);

  const profile = memberDetails?.profiles || member?.profiles;
  const activeMembership = memberDetails?.memberships?.find((m: any) => m.status === 'active' || m.status === 'frozen');
  const activePTPackage = memberDetails?.member_pt_packages?.find((p: any) => p.status === 'active');
  const hasRegistrationForm = !!registrationFormDocument;

  // Gifted free days (membership extensions) for active membership
  const { data: freeDaysList = [] } = useQuery({
    queryKey: ['member-profile-free-days', activeMembership?.id],
    enabled: !!activeMembership?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_free_days')
        .select('id, days_added, reason, created_at')
        .eq('membership_id', activeMembership!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const freeDaysTotal = (freeDaysList as any[]).reduce((s, r) => s + Number(r.days_added || 0), 0);

  const recentActivity = useMemo<RecentActivityItem[]>(() => {
    const membershipItems = (memberDetails?.memberships || []).map((membership: any) => ({
      id: `membership-${membership.id}`,
      timestamp: membership.created_at || membership.start_date,
      type: 'membership' as const,
      title: membership.status === 'active' ? 'Membership purchased' : 'Membership updated',
      subtitle: membership.membership_plans?.name
        ? `${membership.membership_plans.name} · ${format(new Date(membership.start_date), 'dd MMM yyyy')} to ${format(new Date(membership.end_date), 'dd MMM yyyy')}`
        : undefined,
      amount: membership.price_paid,
      badge: membership.status === 'active' ? 'Membership' : 'Renewal',
    }));

    const paymentItems = payments.map((payment: any) => ({
      id: `payment-${payment.id}`,
      timestamp: payment.payment_date,
      type: 'payment' as const,
      title: 'Payment received',
      subtitle: payment.invoices?.invoice_number ? `Invoice ${payment.invoices.invoice_number}` : payment.received_by_name ? `Received by ${payment.received_by_name}` : undefined,
      amount: payment.amount,
      badge: 'Payment',
    }));

    const attendanceItems = attendance.flatMap((att: any) => {
      const items: RecentActivityItem[] = [
        {
          id: `checkin-${att.id}`,
          timestamp: att.check_in,
          type: 'check_in',
          title: 'Checked in',
          subtitle: att.membership_id ? 'Attendance recorded' : undefined,
          badge: 'Check-in',
        },
      ];

      if (att.check_out) {
        items.push({
          id: `checkout-${att.id}`,
          timestamp: att.check_out,
          type: 'check_out',
          title: 'Checked out',
          subtitle: `Visit started ${format(new Date(att.check_in), 'dd MMM yyyy, HH:mm')}`,
          badge: 'Check-out',
        });
      }

      return items;
    });

    const ptPackageItems = (memberDetails?.member_pt_packages || []).map((pkg: any) => ({
      id: `pt-${pkg.id}`,
      timestamp: pkg.created_at,
      type: 'pt_package' as const,
      title: 'PT package purchased',
      subtitle: pkg.pt_packages?.name
        ? `${pkg.pt_packages.name} · ${pkg.sessions_remaining}/${pkg.sessions_total} sessions left`
        : undefined,
      amount: pkg.price_paid,
      badge: 'PT',
    }));

    return [...attendanceItems, ...membershipItems, ...paymentItems, ...ptPackageItems]
      .filter((item) => !!item.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [attendance, memberDetails?.member_pt_packages, memberDetails?.memberships, payments]);

  // Group activity by day, then by badge
  const groupedActivity = useMemo(() => {
    const byDay = new Map<string, RecentActivityItem[]>();
    for (const item of recentActivity) {
      const key = format(new Date(item.timestamp), 'yyyy-MM-dd');
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(item);
    }
    return Array.from(byDay.entries()).map(([dayKey, items]) => {
      const groups = new Map<string, RecentActivityItem[]>();
      for (const it of items) {
        if (!groups.has(it.badge)) groups.set(it.badge, []);
        groups.get(it.badge)!.push(it);
      }
      return {
        dayKey,
        date: new Date(dayKey),
        items,
        groups: Array.from(groups.entries()).map(([badge, list]) => ({ badge, items: list })),
      };
    });
  }, [recentActivity]);

  const [activityPage, setActivityPage] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const ACTIVITY_DAYS_PER_PAGE = 5;
  const totalActivityPages = Math.max(1, Math.ceil(groupedActivity.length / ACTIVITY_DAYS_PER_PAGE));
  const pagedActivityDays = groupedActivity.slice(
    activityPage * ACTIVITY_DAYS_PER_PAGE,
    activityPage * ACTIVITY_DAYS_PER_PAGE + ACTIVITY_DAYS_PER_PAGE,
  );
  const toggleGroup = (key: string) =>
    setExpandedGroups((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });

  if (!member) return null;

  const daysLeft = activeMembership 
    ? differenceInDays(new Date(activeMembership.end_date), new Date())
    : 0;

  const getDaysLeftColor = (days: number) => {
    if (days <= 0) return 'text-destructive';
    if (days <= 7) return 'text-destructive';
    if (days <= 30) return 'text-warning';
    return 'text-success';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle className="h-4 w-4 text-success" />;
      case 'expired': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'frozen': return <Pause className="h-4 w-4 text-warning" />;
      default: return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getMemberStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-success/10 text-success',
      inactive: 'bg-muted text-muted-foreground',
      suspended: 'bg-destructive/10 text-destructive',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto overscroll-contain">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Member Profile
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Profile Header */}
          <div className="flex items-start gap-3">
            <Avatar className="h-14 w-14 sm:h-20 sm:w-20 shrink-0">
              <AvatarImage src={profile?.avatar_url} />
              <AvatarFallback className="text-lg">
                {profile?.full_name?.charAt(0) || 'M'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-nowrap">
                <h2 className="text-lg sm:text-xl font-semibold truncate min-w-0 flex-1">{profile?.full_name || 'N/A'}</h2>
                <Badge className={`${getMemberStatusColor(member.status)} shrink-0`}>{member.status}</Badge>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => setEditProfileOpen(true)}
                >
                  <Edit className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground font-mono">{member.member_code}</p>
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:gap-4 gap-1 mt-2 text-sm text-muted-foreground">
                {profile?.email && (
                  <span className="flex items-center gap-1 min-w-0">
                    <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{profile.email}</span>
                  </span>
                )}
                {profile?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3 shrink-0" /> {profile.phone}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <Card>
              <CardContent className="pt-4 text-center">
              {activeMembership ? (
                  activeMembership.status === 'frozen' ? (
                    <>
                      <div className="text-lg font-bold text-warning">FROZEN</div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {activeMembership.membership_plans?.name || 'Plan'}
                      </p>
                    </>
                  ) : daysLeft > 0 ? (
                    <>
                      <div className={`text-xl sm:text-2xl font-bold ${getDaysLeftColor(daysLeft)}`}>{daysLeft}</div>
                      <p className="text-xs text-muted-foreground truncate">
                        {activeMembership.membership_plans?.name || 'Days Left'}
                      </p>
                      {freeDaysTotal > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="mt-1 bg-amber-100 text-amber-700 border-amber-300 text-[10px] gap-1">
                              <Gift className="h-3 w-3" />
                              +{freeDaysTotal}d gift
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            Includes {freeDaysTotal} gifted day{freeDaysTotal === 1 ? '' : 's'} added to this plan
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-sm sm:text-lg font-bold text-destructive">EXPIRED</div>
                      <p className="text-xs text-muted-foreground truncate">
                        {activeMembership.membership_plans?.name || 'Plan Status'}
                      </p>
                    </>
                  )
                ) : (
                  <>
                    <div className="text-sm font-bold text-muted-foreground">No Plan</div>
                    <p className="text-xs text-muted-foreground">Days Left</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-primary">
                  {activePTPackage ? (
                    activePTPackage.sessions_total > 0
                      ? activePTPackage.sessions_remaining
                      : `${Math.max(0, Math.ceil((new Date(activePTPackage.expiry_date).getTime() - Date.now()) / 86400000))}d`
                  ) : 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {activePTPackage?.sessions_total > 0 ? 'PT Sessions' : activePTPackage ? 'PT Duration' : 'PT Sessions'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-xl sm:text-2xl font-bold">
                  {recentActivity.length}
                </div>
                <p className="text-xs text-muted-foreground">Recent Activity</p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions - Row 1 */}
          <div className="flex gap-2">
            <Button 
              variant={activeMembership && daysLeft > 0 ? 'outline' : 'default'} 
              className="flex-1 min-h-[44px] h-auto py-2 whitespace-normal"
              onClick={() => { onOpenChange(false); onPurchaseMembership(); }}
              disabled={activeMembership?.status === 'frozen'}
            >
              <CreditCard className="h-4 w-4 mr-2 shrink-0" />
              {activeMembership?.status === 'frozen' ? 'Frozen – Cannot Purchase' : activeMembership && daysLeft > 0 ? 'Upgrade Plan' : (activeMembership && daysLeft <= 0 ? 'Renew Plan' : 'Add Plan')}
            </Button>
            <Button 
              variant="outline" 
              className="flex-1 min-h-[44px]"
              onClick={() => { onOpenChange(false); onPurchasePT(); }}
              disabled={!activeMembership}
            >
              <Dumbbell className="h-4 w-4 mr-2 shrink-0" />
              Buy PT
            </Button>
          </div>

          {/* Quick Actions - Row 2 */}
          <div className="grid grid-cols-2 gap-2">
            {activeMembership?.status === 'active' && (
              <Button variant="outline" size="sm" onClick={() => setFreezeOpen(true)} className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left">
                <Snowflake className="h-4 w-4 mr-2 shrink-0" />
                Freeze Plan
              </Button>
            )}
            {activeMembership?.status === 'frozen' && (
              <Button variant="outline" size="sm" onClick={() => setUnfreezeOpen(true)} className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left">
                <Play className="h-4 w-4 mr-2 shrink-0" />
                Unfreeze Plan
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setAssignTrainerOpen(true)} className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left">
              <UserCog className="h-4 w-4 mr-2 shrink-0" />
              {member.assigned_trainer_id ? 'Change Trainer' : 'Assign Trainer'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMeasurementOpen(true)} className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left">
              <Ruler className="h-4 w-4 mr-2 shrink-0" />
              Record Body
            </Button>
            {activeMembership && (
              <Button variant="outline" size="sm" className="text-destructive justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => { setCancelTarget(activeMembership); setCancelOpen(true); }}>
                <XCircle className="h-4 w-4 mr-2 shrink-0" />
                Cancel Plan
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              className={`justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left ${member.status === 'active' ? 'text-destructive' : 'text-success'}`}
              onClick={toggleMemberStatus}
              disabled={isTogglingStatus}
            >
              {member.status === 'active' ? <UserMinus className="h-4 w-4 mr-2 shrink-0" /> : <UserCheck className="h-4 w-4 mr-2 shrink-0" />}
              {member.status === 'active' ? 'Deactivate' : 'Activate'}
            </Button>
            {isManagerOrAbove && (
              <Button variant="outline" size="sm" className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => setCompGiftOpen(true)}>
                <Gift className="h-4 w-4 mr-2 shrink-0" /> Comp/Gift
              </Button>
            )}
            {isManagerOrAbove && (
              <Button variant="outline" size="sm" className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => setTransferBranchOpen(true)}>
                <Building2 className="h-4 w-4 mr-2 shrink-0" /> Transfer Branch
              </Button>
            )}
            {isManagerOrAbove && activeMembership && activeMembership?.membership_plans?.is_transferable !== false && (
              <Button variant="outline" size="sm" className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => setTransferMembershipOpen(true)}>
                <Share2 className="h-4 w-4 mr-2 shrink-0" /> Transfer Plan
              </Button>
            )}
            {!isManagerOrAbove && (
              <Button variant="outline" size="sm" className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => setCompGiftOpen(true)}>
                <Gift className="h-4 w-4 mr-2 shrink-0" /> Request Comp
              </Button>
            )}
            {!isManagerOrAbove && (
              <Button variant="outline" size="sm" className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => setTransferBranchOpen(true)}>
                <Building2 className="h-4 w-4 mr-2 shrink-0" /> Request Transfer
              </Button>
            )}
            {!isManagerOrAbove && activeMembership && activeMembership?.membership_plans?.is_transferable !== false && (
              <Button variant="outline" size="sm" className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left" onClick={() => setTransferMembershipOpen(true)}>
                <Share2 className="h-4 w-4 mr-2 shrink-0" /> Request Plan Transfer
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="justify-start min-h-[44px] h-auto py-2 whitespace-normal text-left"
              onClick={() => setRegistrationFormOpen(true)}
              disabled={hasRegistrationForm}
            >
              <FileText className="h-4 w-4 mr-2 shrink-0" />
              {hasRegistrationForm ? 'Already Uploaded' : 'Registration Form'}
            </Button>
          </div>

          <Separator />

          <Tabs defaultValue="overview" className="w-full">
            <div className="relative flex items-center gap-1">
              <button
                onClick={() => scrollTabs('left')}
                className="flex-shrink-0 h-8 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                aria-label="Scroll tabs left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div
                ref={tabsScrollRef}
                className="flex-1 overflow-x-auto scrollbar-hide"
              >
                <TabsList className="inline-flex w-auto min-w-full h-auto p-1 gap-0.5">
                  <TabsTrigger value="overview" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <User className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Overview</span>
                  </TabsTrigger>
                  <TabsTrigger value="membership" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <CreditCard className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Plan</span>
                  </TabsTrigger>
                  <TabsTrigger value="benefits" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <Heart className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Benefits</span>
                  </TabsTrigger>
                  <TabsTrigger value="measurements" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <Ruler className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Body</span>
                  </TabsTrigger>
                  <TabsTrigger value="payments" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <IndianRupee className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Pay</span>
                  </TabsTrigger>
                  <TabsTrigger value="rewards" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <Award className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Rewards</span>
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Docs</span>
                  </TabsTrigger>
                  <TabsTrigger value="plans" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <Dumbbell className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Plans</span>
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="flex items-center gap-1.5 shrink-0 px-3 py-2">
                    <Activity className="h-3.5 w-3.5" />
                    <span className="text-xs whitespace-nowrap">Activity</span>
                  </TabsTrigger>
                </TabsList>
              </div>
              <button
                onClick={() => scrollTabs('right')}
                className="flex-shrink-0 h-8 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                aria-label="Scroll tabs right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <TabsContent value="overview" className="space-y-4 mt-4">
              {/* Personal Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-muted-foreground">Gender:</span>
                      <span className="ml-2 capitalize">{profile?.gender || 'Not specified'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">DOB:</span>
                      <span className="ml-2">
                        {profile?.date_of_birth ? format(new Date(profile.date_of_birth), 'dd MMM yyyy') : 'Not specified'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Address:</span>
                      <span className="ml-2">{profile?.address || 'Not provided'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Branch & Source Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Registration Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{memberDetails?.branch?.name || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>Joined: {format(new Date(member.joined_at), 'dd MMM yyyy')}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Source:</span>
                      <span className="ml-2 capitalize">{member.source || 'Walk-in'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created by:</span>
                      <span className="ml-2">{(memberDetails?.created_by_profile as any)?.full_name || 'System'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Referral Info */}
              {memberDetails?.referrer && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-primary">
                      <Gift className="h-4 w-4" />
                      <span className="font-medium">Referred by:</span>
                      <span>{referrerProfile?.full_name || (memberDetails?.referrer as any)?.member_code || 'Unknown'}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Assigned Trainer */}
              <Card className={assignedTrainerId ? 'border-primary/30 bg-primary/5' : ''}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Dumbbell className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">General Trainer:</span>
                      <span className="text-sm">
                        {assignedTrainerProfile?.full_name || (assignedTrainerId ? 'Loading...' : 'Not Assigned')}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setAssignTrainerOpen(true)} className="h-7 text-xs">
                      {assignedTrainerId ? 'Change' : 'Assign'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Wallet Balance */}
              {(Number(memberWallet?.balance) || 0) > 0 && (
                <Card className="border-success/30 bg-success/5">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <IndianRupee className="h-4 w-4 text-success" />
                      <span className="font-medium text-sm">Wallet Balance:</span>
                      <span className="text-sm font-bold text-success">₹{(Number(memberWallet?.balance) || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Emergency Contact */}
              {(profile?.emergency_contact_name || profile?.emergency_contact_phone) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Emergency Contact</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p>{profile.emergency_contact_name}</p>
                    <p className="text-muted-foreground">{profile.emergency_contact_phone}</p>
                  </CardContent>
                </Card>
              )}

              {/* Health & Goals — uses fully-loaded memberDetails so new fields show */}
              {(() => {
                type FitnessProfileFields = {
                  fitness_goals?: string | null;
                  health_conditions?: string | null;
                  dietary_preference?: string | null;
                  cuisine_preference?: string | null;
                  allergies?: string[] | null;
                  fitness_level?: string | null;
                  activity_level?: string | null;
                  equipment_availability?: string[] | null;
                  injuries_limitations?: string | null;
                };
                const m = (memberDetails ?? member) as FitnessProfileFields;
                const allergies: string[] = Array.isArray(m.allergies) ? m.allergies : [];
                const equipment: string[] = Array.isArray(m.equipment_availability) ? m.equipment_availability : [];
                const hasAny = m.fitness_goals || m.health_conditions || m.dietary_preference ||
                  m.cuisine_preference || allergies.length > 0 || m.fitness_level ||
                  m.activity_level || equipment.length > 0 || m.injuries_limitations;
                if (!hasAny) return null;
                const titleCase = (s: string) =>
                  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Fitness & Diet Profile</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {m.fitness_goals && (
                        <div>
                          <span className="text-muted-foreground">Goals:</span>
                          <span className="ml-2">{m.fitness_goals}</span>
                        </div>
                      )}
                      {m.dietary_preference && (
                        <div>
                          <span className="text-muted-foreground">Dietary Preference:</span>
                          <span className="ml-2">{titleCase(m.dietary_preference)}</span>
                        </div>
                      )}
                      {m.cuisine_preference && (
                        <div>
                          <span className="text-muted-foreground">Cuisine:</span>
                          <span className="ml-2">{titleCase(m.cuisine_preference)}</span>
                        </div>
                      )}
                      {allergies.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-muted-foreground">Allergies:</span>
                          {allergies.map((a) => (
                            <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                          ))}
                        </div>
                      )}
                      {m.fitness_level && (
                        <div>
                          <span className="text-muted-foreground">Fitness Level:</span>
                          <span className="ml-2">{titleCase(m.fitness_level)}</span>
                        </div>
                      )}
                      {m.activity_level && (
                        <div>
                          <span className="text-muted-foreground">Activity Level:</span>
                          <span className="ml-2">{titleCase(m.activity_level)}</span>
                        </div>
                      )}
                      {equipment.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-muted-foreground">Equipment:</span>
                          {equipment.map((e) => (
                            <Badge key={e} variant="secondary" className="text-xs">{titleCase(e)}</Badge>
                          ))}
                        </div>
                      )}
                      {m.injuries_limitations && (
                        <div>
                          <span className="text-muted-foreground">Injuries / Limitations:</span>
                          <span className="ml-2 text-destructive">{m.injuries_limitations}</span>
                        </div>
                      )}
                      {m.health_conditions && (
                        <div>
                          <span className="text-muted-foreground">Health Conditions:</span>
                          <span className="ml-2 text-destructive">{m.health_conditions}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}
            </TabsContent>

            <TabsContent value="membership" className="space-y-4 mt-4">
              {/* Active Membership */}
              {activeMembership ? (
                <Card className="border-success/30 bg-success/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        {getStatusIcon('active')}
                        Active Membership
                      </CardTitle>
                      <Badge className={getDaysLeftColor(daysLeft)}>
                        {daysLeft > 0 ? `${daysLeft} days left` : 'Expiring today'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="font-medium">{activeMembership.membership_plans?.name}</p>
                    <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                      <div>Start: {format(new Date(activeMembership.start_date), 'dd MMM yyyy')}</div>
                      <div>End: {format(new Date(activeMembership.end_date), 'dd MMM yyyy')}</div>
                      <div>Paid: ₹{activeMembership.price_paid}</div>
                      <div>By: N/A</div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="pt-4 text-center">
                    <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
                    <p className="font-medium">No Active Membership</p>
                    <p className="text-sm text-muted-foreground">Add a membership plan to activate</p>
                  </CardContent>
                </Card>
              )}

              {/* Active PT Package */}
              {activePTPackage && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Dumbbell className="h-4 w-4" />
                      PT Package
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="font-medium">{activePTPackage.pt_packages?.name}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>Sessions: {activePTPackage.sessions_remaining}/{activePTPackage.sessions_total}</div>
                      <div>Trainer: Assigned</div>
                      <div>Expires: {format(new Date(activePTPackage.expiry_date), 'dd MMM yyyy')}</div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Membership History */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Membership History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {memberDetails?.memberships?.length > 0 ? (
                    <div className="space-y-2">
                      {memberDetails.memberships.map((m: any) => {
                        const isPending = ['pending', 'scheduled', 'upcoming'].includes(String(m.status).toLowerCase());
                        return (
                          <div key={m.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{m.membership_plans?.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(m.start_date), 'dd MMM yy')} - {format(new Date(m.end_date), 'dd MMM yy')}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline" className="text-xs capitalize">
                                {m.status}
                              </Badge>
                              {isPending && isManagerOrAbove && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                                  onClick={() => { setCancelTarget(m); setCancelOpen(true); }}
                                >
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No membership history</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <BenefitsUsageTab memberId={member.id} activeMembership={activeMembership} branchId={member.branch_id} memberGender={(memberDetails?.profiles as any)?.gender} />

            <TabsContent value="payments" className="space-y-4 mt-4">
              {/* Pending / Partial Invoices */}
              <PendingInvoicesSection memberId={member.id} branchId={member.branch_id} />

              {/* Payment History */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Payment History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {payments.length > 0 ? (
                    <div className="space-y-2">
                      {payments.map((payment: any) => (
                        <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <div>
                            <p className="font-medium text-sm">₹{payment.amount}</p>
                            <p className="text-xs text-muted-foreground">
                              {payment.invoices?.invoice_number || 'No invoice'}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline" className="capitalize text-xs">
                              {payment.payment_method?.replace('_', ' ')}
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(payment.payment_date), 'dd MMM yyyy')}
                            </p>
                            {payment.received_by_name && (
                              <p className="text-xs text-muted-foreground">
                                By: {payment.received_by_name}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No payment history</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="measurements" className="space-y-4 mt-4">
              <MeasurementProgressView memberId={member.id} memberGender={profile?.gender} />
            </TabsContent>

            <TabsContent value="rewards" className="space-y-4 mt-4">
              {/* Rewards Wallet */}
              <RewardsWalletCard
                memberId={member.id}
                memberName={profile?.full_name || 'Member'}
                branchId={member.branch_id}
                rewardPoints={member.reward_points || 0}
              />

              {/* Referral Code Card */}
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Share2 className="h-4 w-4" />
                    Your Referral Code
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 bg-background rounded-lg px-4 py-3 font-mono text-lg font-bold">
                      {member.member_code}
                    </div>
                    <Button variant="outline" size="icon" onClick={copyReferralCode}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={shareViaWhatsApp}>
                      <MessageCircle className="h-4 w-4 mr-2" />
                      WhatsApp
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={shareViaEmail}>
                      <Mail className="h-4 w-4 mr-2" />
                      Email
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-primary">{referrals.length}</div>
                    <p className="text-xs text-muted-foreground">Total Referrals</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-success">
                      {rewards.filter((r: any) => !r.is_claimed).length}
                    </div>
                    <p className="text-xs text-muted-foreground">Unclaimed Rewards</p>
                  </CardContent>
                </Card>
              </div>

              {/* Rewards List */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Award className="h-4 w-4" />
                    Your Rewards
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rewards.length > 0 ? (
                    <div className="space-y-2">
                      {rewards.map((reward: any) => (
                        <div key={reward.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <div>
                            <div className="flex items-center gap-2">
                              <Gift className="h-4 w-4 text-primary" />
                              <span className="font-medium capitalize">
                                {reward.reward_type?.replace('_', ' ') || 'Reward'}
                              </span>
                            </div>
                            {reward.reward_value && (
                              <p className="text-sm text-muted-foreground mt-1">
                                Value: ₹{reward.reward_value}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            {reward.is_claimed ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                Claimed
                              </Badge>
                            ) : (
                              <Button 
                                size="sm" 
                                onClick={() => claimRewardMutation.mutate(reward.id)}
                                disabled={claimRewardMutation.isPending}
                              >
                                Claim
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground">
                      <Gift className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No rewards yet</p>
                      <p className="text-xs mt-1">Refer friends to earn rewards!</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Referrals */}
              {referrals.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Recent Referrals
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {referrals.slice(0, 5).map((ref: any) => (
                        <div key={ref.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{ref.referred_name || 'Member'}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(ref.created_at), 'dd MMM yyyy')}
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className="capitalize text-xs">
                            {ref.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="plans" className="space-y-4 mt-4">
              <MemberPlanProgressBlock memberId={member.id} />
            </TabsContent>

            <TabsContent value="activity" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recentActivity.length > 0 ? (
                    <div className="space-y-4">
                      {pagedActivityDays.map((day) => {
                        const today = new Date();
                        const isToday = format(today, 'yyyy-MM-dd') === day.dayKey;
                        const isYesterday =
                          format(new Date(today.getTime() - 86400000), 'yyyy-MM-dd') === day.dayKey;
                        const dayLabel = isToday
                          ? 'Today'
                          : isYesterday
                          ? 'Yesterday'
                          : format(day.date, 'EEE, dd MMM yyyy');
                        return (
                          <div key={day.dayKey} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                {dayLabel}
                              </p>
                              <span className="text-[10px] text-muted-foreground">
                                {day.items.length} {day.items.length === 1 ? 'event' : 'events'}
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {day.groups.map((g) => {
                                const groupKey = `${day.dayKey}::${g.badge}`;
                                const isCollapsed = g.items.length > 1 && !expandedGroups.has(groupKey);
                                const visible = isCollapsed ? g.items.slice(0, 1) : g.items;
                                return (
                                  <div key={groupKey} className="space-y-1">
                                    {visible.map((item) => (
                                      <div
                                        key={item.id}
                                        className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-muted/50"
                                      >
                                        <div className="min-w-0 space-y-0.5">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <Badge
                                              variant="outline"
                                              className="text-[10px] uppercase tracking-wide"
                                            >
                                              {item.badge}
                                            </Badge>
                                            <p className="text-sm font-medium truncate">{item.title}</p>
                                          </div>
                                          <p className="text-xs text-muted-foreground">
                                            {format(new Date(item.timestamp), 'HH:mm')}
                                            {item.subtitle ? ` · ${item.subtitle}` : ''}
                                          </p>
                                        </div>
                                        {typeof item.amount === 'number' && (
                                          <p className="text-sm font-medium whitespace-nowrap">
                                            ₹{item.amount.toLocaleString('en-IN')}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                    {g.items.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => toggleGroup(groupKey)}
                                        className="text-[11px] text-primary hover:underline pl-1"
                                      >
                                        {isCollapsed
                                          ? `Show ${g.items.length - 1} more ${g.badge.toLowerCase()} event${g.items.length - 1 === 1 ? '' : 's'}`
                                          : 'Show less'}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {totalActivityPages > 1 && (
                        <div className="flex items-center justify-between pt-2 border-t">
                          <p className="text-xs text-muted-foreground">
                            Page {activityPage + 1} of {totalActivityPages} · {recentActivity.length} total
                          </p>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              disabled={activityPage === 0}
                              onClick={() => setActivityPage((p) => Math.max(0, p - 1))}
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2"
                              disabled={activityPage >= totalActivityPages - 1}
                              onClick={() => setActivityPage((p) => Math.min(totalActivityPages - 1, p + 1))}
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recent activity</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <DocumentVaultTab memberId={member.id} />
          </Tabs>
        </div>

        {/* Drawer Components */}
        {activeMembership && (
          <>
            <FreezeMembershipDrawer
              open={freezeOpen}
              onOpenChange={setFreezeOpen}
              membership={activeMembership}
              memberName={profile?.full_name}
            />
            <UnfreezeMembershipDrawer
              open={unfreezeOpen}
              onOpenChange={setUnfreezeOpen}
              membership={activeMembership}
              memberName={profile?.full_name}
            />
          </>
        )}
        <CancelMembershipDrawer
          open={cancelOpen}
          onOpenChange={(o) => { setCancelOpen(o); if (!o) setCancelTarget(null); }}
          membership={cancelTarget || activeMembership}
          memberName={profile?.full_name}
        />
        <AssignTrainerDrawer
          open={assignTrainerOpen}
          onOpenChange={setAssignTrainerOpen}
          memberId={member.id}
          memberName={profile?.full_name}
          branchId={member.branch_id}
          currentTrainerId={member.assigned_trainer_id}
        />
        <RecordMeasurementDrawer
          open={measurementOpen}
          onOpenChange={setMeasurementOpen}
          memberId={member.id}
          memberName={profile?.full_name}
          memberGender={profile?.gender}
        />
        <EditProfileDrawer
          open={editProfileOpen}
          onOpenChange={setEditProfileOpen}
          member={memberDetails || member}
          profile={profile}
        />
        <CompGiftDrawer
          open={compGiftOpen}
          onOpenChange={setCompGiftOpen}
          memberId={member.id}
          memberName={profile?.full_name}
          membershipId={activeMembership?.id}
          branchId={member.branch_id}
        />
        <MemberRegistrationFormDrawer
          open={registrationFormOpen}
          onOpenChange={setRegistrationFormOpen}
          data={{
            memberName: profile?.full_name || 'N/A',
            memberCode: member.member_code,
            email: profile?.email,
            phone: profile?.phone,
            gender: profile?.gender,
            dateOfBirth: profile?.date_of_birth,
            address: profile?.address,
            city: profile?.city,
            state: profile?.state,
            emergencyContactName: profile?.emergency_contact_name,
            emergencyContactPhone: profile?.emergency_contact_phone,
            planName: activeMembership?.membership_plans?.name,
            startDate: activeMembership?.start_date,
            endDate: activeMembership?.end_date,
            pricePaid: activeMembership?.price_paid,
            branchName: memberDetails?.branch?.name,
            memberId: member.id,
            fitnessGoals: (member as any).fitness_goals,
            medicalConditions: (member as any).health_conditions || (member as any).injuries_limitations,
            governmentIdType: (profile as any)?.government_id_type,
            governmentIdNumber: (profile as any)?.government_id_number,
          }}
        />
        <TransferBranchDrawer
          open={transferBranchOpen}
          onOpenChange={setTransferBranchOpen}
          memberId={member.id}
          memberName={profile?.full_name}
          currentBranchId={member.branch_id}
          currentBranchName={memberDetails?.branch?.name}
        />
        {activeMembership && (
          <TransferMembershipDrawer
            open={transferMembershipOpen}
            onOpenChange={setTransferMembershipOpen}
            memberId={member.id}
            memberName={profile?.full_name}
            membershipId={activeMembership.id}
            branchId={member.branch_id}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}