import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { usePlans } from '@/hooks/usePlans';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BenefitPackagesPanel } from '@/components/plans/BenefitPackagesPanel';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddPlanDrawer } from '@/components/plans/AddPlanDrawer';
import { EditPlanDrawer } from '@/components/plans/EditPlanDrawer';
import {
  Plus, Clock, Users, Snowflake, ArrowRightLeft, Edit2, Crown, TrendingUp, Star,
  IndianRupee, Sparkles, Check, Dumbbell, ChevronRight, Tag, Search, X, Eye, EyeOff,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useUpdatePlan } from '@/hooks/usePlans';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { MembershipPlanWithBenefits } from '@/types/membership';
import { useBranchContext } from '@/contexts/BranchContext';
import { format } from 'date-fns';

const accentColors = [
  { border: 'border-l-primary', gradient: 'from-primary to-primary', bg: 'bg-primary' },
  { border: 'border-l-success', gradient: 'from-success to-success', bg: 'bg-success' },
  { border: 'border-l-warning', gradient: 'from-warning to-warning', bg: 'bg-warning' },
  { border: 'border-l-destructive', gradient: 'from-destructive to-destructive', bg: 'bg-destructive' },
  { border: 'border-l-info', gradient: 'from-info to-info', bg: 'bg-info' },
  { border: 'border-l-primary', gradient: 'from-primary to-primary', bg: 'bg-primary' },
];

interface PlanListItemProps {
  plan: MembershipPlanWithBenefits;
  index: number;
  isPopular: boolean;
  memberCount: number;
  isSelected: boolean;
  formatPrice: (price: number) => string;
  getDurationLabel: (days: number) => string;
  onClick: () => void;
  animationDelay: number;
  onToggleVisibility: (plan: MembershipPlanWithBenefits, value: boolean) => void;
  isTogglingVisibility: boolean;
}

function PlanListItem({
  plan,
  index,
  isPopular,
  memberCount,
  isSelected,
  formatPrice,
  getDurationLabel,
  onClick,
  animationDelay,
  onToggleVisibility,
  isTogglingVisibility,
}: PlanListItemProps) {
  const [visible, setVisible] = useState(false);
  const accent = accentColors[index % accentColors.length];

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), animationDelay);
    return () => clearTimeout(t);
  }, [animationDelay]);

  return (
    <div
      data-testid={`plan-list-item-${plan.id}`}
      onClick={onClick}
      className={`
        relative flex items-center gap-3 px-4 py-3.5 cursor-pointer border-l-4 transition-all duration-150
        ${accent.border}
        ${isSelected
          ? 'bg-gradient-to-r from-primary/10 to-transparent shadow-md scale-[1.01]'
          : 'hover:bg-muted/50 hover:shadow-md hover:scale-[1.01]'
        }
        ${!visible ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}
        ${!plan.is_active ? 'opacity-60' : ''}
        transition-all duration-300
      `}
    >
      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full" />
      )}

      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${accent.gradient} flex items-center justify-center text-primary-foreground shrink-0`}>
        <Crown className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-sm text-foreground truncate">{plan.name}</span>
          {isPopular && (
            <Badge className="bg-warning text-primary-foreground border-0 gap-1 text-[10px] px-1.5 py-0 shrink-0" data-testid={`badge-popular-${plan.id}`}>
              <Star className="h-2.5 w-2.5 fill-current" />
              ⭐ Popular Choice
            </Badge>
          )}
          {!plan.is_active && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0" data-testid={`badge-inactive-${plan.id}`}>Inactive</Badge>
          )}
          {(plan as any).is_visible_to_members === false && (
            <Badge
              variant="outline"
              className="gap-1 text-[10px] px-1.5 py-0 shrink-0 border-muted-foreground/30 text-muted-foreground"
              data-testid={`badge-hidden-${plan.id}`}
            >
              <EyeOff className="h-2.5 w-2.5" />
              Hidden from members
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs font-bold text-foreground">
            {formatPrice(plan.discounted_price ?? plan.price)}
          </span>
          {plan.discounted_price && (
            <span className="text-[10px] text-muted-foreground line-through">{formatPrice(plan.price)}</span>
          )}
          <span className="text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <Clock className="h-3 w-3" />
            {getDurationLabel(plan.duration_days)}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <Users className="h-3 w-3" />
            {memberCount}
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
        title={(plan as any).is_visible_to_members === false ? 'Hidden from the member portal' : 'Visible in the member portal'}
      >
        {(plan as any).is_visible_to_members === false ? (
          <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Switch
          checked={(plan as any).is_visible_to_members !== false}
          disabled={isTogglingVisibility}
          onCheckedChange={(value) => onToggleVisibility(plan, value)}
          aria-label={`Toggle member portal visibility for ${plan.name}`}
          data-testid={`switch-visible-${plan.id}`}
        />
      </div>

      <ChevronRight className={`h-4 w-4 shrink-0 transition-colors ${isSelected ? 'text-primary' : 'text-muted-foreground/50'}`} />
    </div>
  );
}

interface PlanDetailPanelProps {
  plan: MembershipPlanWithBenefits;
  planIndex: number;
  memberCount: number;
  formatPrice: (price: number) => string;
  getDurationLabel: (days: number) => string;
  onEdit: (plan: MembershipPlanWithBenefits) => void;
  onMemberCountClick: (planId: string, planName: string) => void;
}

function PlanDetailPanel({
  plan,
  planIndex,
  memberCount,
  formatPrice,
  getDurationLabel,
  onEdit,
  onMemberCountClick,
}: PlanDetailPanelProps) {
  const [animIn, setAnimIn] = useState(false);
  const accent = accentColors[planIndex % accentColors.length];

  useEffect(() => {
    setAnimIn(false);
    const t = setTimeout(() => setAnimIn(true), 20);
    return () => clearTimeout(t);
  }, [plan.id]);

  const discountPct = plan.discounted_price
    ? Math.round(((plan.price - plan.discounted_price) / plan.price) * 100)
    : 0;

  const benefits = plan.plan_benefits || [];

  return (
    <div
      data-testid={`plan-detail-${plan.id}`}
      className={`h-full flex flex-col transition-all duration-200 ${animIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {/* Hero banner */}
      <div className={`relative bg-gradient-to-br ${accent.gradient} rounded-2xl p-6 text-primary-foreground overflow-hidden mb-6`}>
        <div className="absolute top-0 right-0 w-40 h-40 bg-card/10 rounded-full -translate-y-16 translate-x-16" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-card/5 rounded-full translate-y-8 -translate-x-8" />
        <div className="relative z-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-primary-foreground/70 text-sm font-medium uppercase tracking-wider mb-1">Membership Plan</p>
              <h2 className="text-2xl font-bold leading-tight">{plan.name}</h2>
              {plan.description && (
                <p className="text-primary-foreground/80 text-sm mt-1.5 max-w-xs">{plan.description}</p>
              )}
            </div>
            <div className="flex flex-col gap-1 items-end">
              {!plan.is_active && (
                <Badge className="bg-card/20 text-primary-foreground border-primary-foreground/30 shrink-0">Inactive</Badge>
              )}
              {benefits.some((b: any) => ['3d_body_scanning', 'howbody_posture'].includes(b.benefit_types?.code)) && (
                <Badge className="bg-card/20 text-primary-foreground border-primary-foreground/30 shrink-0 text-[10px]">
                  Body Scan
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-4">
            <span className="text-4xl font-extrabold tracking-tight">
              {formatPrice(plan.discounted_price ?? plan.price)}
            </span>
            {plan.discounted_price && (
              <span className="text-primary-foreground/60 text-lg line-through">{formatPrice(plan.price)}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="flex items-center gap-1 text-primary-foreground/80 text-sm">
              <Clock className="h-4 w-4" />
              {getDurationLabel(plan.duration_days)}
            </span>
            {discountPct > 0 && (
              <Badge className="bg-card/20 text-primary-foreground border-0">
                <Tag className="h-3 w-3 mr-1" />
                {discountPct}% OFF
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-center">
          <button
            data-testid={`btn-members-${plan.id}`}
            onClick={() => onMemberCountClick(plan.id, plan.name)}
            className={`w-full transition-colors ${memberCount > 0 ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className={`text-2xl font-bold ${memberCount > 0 ? 'text-primary' : 'text-foreground'}`}>
              {memberCount}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
              <Users className="h-3 w-3" />
              Members
            </div>
          </button>
        </div>
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-foreground">{plan.max_freeze_days ?? '—'}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <Snowflake className="h-3 w-3" />
            Freeze Days
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-foreground">{plan.is_transferable ? 'Yes' : 'No'}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
            <ArrowRightLeft className="h-3 w-3" />
            Transfer
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div className="flex-1 mb-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Plan Benefits
        </h3>
        {benefits.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No benefits configured for this plan.</p>
        ) : (
          <div className={`grid gap-2 ${benefits.length > 4 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {benefits.map((b) => (
              <div
                key={b.id}
                data-testid={`benefit-${b.id}`}
                className="flex items-start gap-2 rounded-xl bg-success/10 dark:bg-success/10 px-3 py-2"
              >
                <div className="mt-0.5 shrink-0">
                  <Check className="h-4 w-4 text-success dark:text-success" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {b.benefit_types?.name || b.benefit_type}
                  </p>
                  {b.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{b.description}</p>
                  )}
                  {b.limit_count != null && (
                    <p className="text-xs text-muted-foreground">
                      {b.limit_count}× / {b.frequency}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t border-border/40">
        <Button
          data-testid={`btn-edit-plan-${plan.id}`}
          onClick={() => onEdit(plan)}
          className="flex-1 gap-2 rounded-xl"
        >
          <Edit2 className="h-4 w-4" />
          Edit Plan
        </Button>
        {memberCount > 0 && (
          <Button
            data-testid={`btn-view-members-${plan.id}`}
            variant="outline"
            onClick={() => onMemberCountClick(plan.id, plan.name)}
            className="flex-1 gap-2 rounded-xl"
          >
            <Users className="h-4 w-4" />
            View Members
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyDetailState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-5 animate-pulse">
        <Dumbbell className="h-10 w-10 text-primary/60" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">Select a plan</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Click any plan on the left to view its full details, benefits, and quick actions.
      </p>
    </div>
  );
}

export default function PlansPage() {
  const { effectiveBranchId, branchFilter } = useBranchContext();
  const { data: plans, isLoading } = usePlans(branchFilter, true);
  const defaultBranchId = effectiveBranchId || '';
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [editPlanOpen, setEditPlanOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<MembershipPlanWithBenefits | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(0);
  const [memberListPlanId, setMemberListPlanId] = useState<string | null>(null);
  const [memberListPlanName, setMemberListPlanName] = useState('');
  const [planSearch, setPlanSearch] = useState('');

  const { data: memberCounts = {} } = useQuery({
    queryKey: ['plan-member-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('plan_id')
        .eq('status', 'active');
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach(m => { counts[m.plan_id] = (counts[m.plan_id] || 0) + 1; });
      return counts;
    },
  });

  const { data: planMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ['plan-members', memberListPlanId],
    queryFn: async () => {
      if (!memberListPlanId) return [];
      const { data, error } = await supabase
        .from('memberships')
        .select('id, start_date, end_date, member_id, members!inner(id, member_code, user_id)')
        .eq('plan_id', memberListPlanId)
        .eq('status', 'active');
      if (error) throw error;

      const userIds = data?.map((m: any) => m.members?.user_id).filter(Boolean) || [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, avatar_url')
        .in('id', userIds);

      const profileMap: Record<string, any> = {};
      profiles?.forEach(p => { profileMap[p.id] = p; });

      return data?.map((m: any) => ({
        ...m,
        profile: profileMap[m.members?.user_id] || {},
        member_code: m.members?.member_code,
      })) || [];
    },
    enabled: !!memberListPlanId,
  });

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(price);

  const getDurationLabel = (days: number) => {
    if (days === 1) return '1 Day';
    if (days === 7) return '1 Week';
    if (days === 30) return '1 Month';
    if (days === 90) return '3 Months';
    if (days === 180) return '6 Months';
    if (days === 365) return '1 Year';
    return `${days} Days`;
  };

  const handleEditPlan = (plan: MembershipPlanWithBenefits) => {
    setEditPlan(plan);
    setEditPlanOpen(true);
  };

  const handleMemberCountClick = (planId: string, planName: string) => {
    if ((memberCounts[planId] || 0) > 0) {
      setMemberListPlanId(planId);
      setMemberListPlanName(planName);
    }
  };

  const handleSelectPlan = (plan: MembershipPlanWithBenefits, globalIndex: number) => {
    setSelectedPlanId(plan.id);
    setSelectedPlanIndex(globalIndex);
  };

  const updatePlanMutation = useUpdatePlan();
  const [togglingPlanId, setTogglingPlanId] = useState<string | null>(null);

  const handleToggleVisibility = (plan: MembershipPlanWithBenefits, value: boolean) => {
    setTogglingPlanId(plan.id);
    updatePlanMutation.mutate(
      { planId: plan.id, data: { is_visible_to_members: value } },
      {
        onSuccess: () =>
          toast.success(value ? `${plan.name} is now visible to members` : `${plan.name} is hidden from members`),
        onError: (err: any) => toast.error(err?.message || 'Could not update plan visibility'),
        onSettled: () => setTogglingPlanId(null),
      },
    );
  };

  const searchLower = planSearch.toLowerCase();
  const activePlans = (plans?.filter(p => p.is_active) || []).filter(
    p => !planSearch || p.name.toLowerCase().includes(searchLower)
  );
  const inactivePlans = (plans?.filter(p => !p.is_active) || []).filter(
    p => !planSearch || p.name.toLowerCase().includes(searchLower)
  );
  const selectedPlan = plans?.find(p => p.id === selectedPlanId) ?? null;
  const totalMembers = Object.values(memberCounts).reduce((a, b) => a + b, 0);
  const mostPopularPlan = plans?.reduce((max, plan) =>
    (memberCounts[plan.id] || 0) > (memberCounts[max?.id || ''] || 0) ? plan : max,
    plans?.[0]
  );
  const avgPrice = plans?.length
    ? Math.round(plans.reduce((sum, p) => sum + p.price, 0) / plans.length)
    : 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
                <Crown className="h-6 w-6" />
              </div>
              Membership Plans
            </h1>
            <p className="text-muted-foreground mt-1">Design, manage, and optimize your membership tiers</p>
          </div>
          <Button
            data-testid="btn-create-plan"
            onClick={() => setAddPlanOpen(true)}
            className="gap-2 h-11 rounded-xl shadow-lg shadow-primary/20"
          >
            <Plus className="h-4 w-4" />
            Create Plan
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Card className="bg-gradient-to-br from-primary to-primary text-primary-foreground border-0 shadow-lg shadow-primary/20 rounded-2xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-card/10 rounded-full -translate-y-6 translate-x-6" />
            <CardContent className="pt-6 pb-5 relative z-10">
              <Crown className="h-5 w-5 opacity-80 mb-2" />
              <div className="text-3xl font-bold" data-testid="stat-active-plans">{activePlans.length}</div>
              <p className="text-sm opacity-80 mt-0.5">Active Plans</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success to-success text-primary-foreground border-0 shadow-lg shadow-success/20 rounded-2xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-card/10 rounded-full -translate-y-6 translate-x-6" />
            <CardContent className="pt-6 pb-5 relative z-10">
              <Users className="h-5 w-5 opacity-80 mb-2" />
              <div className="text-3xl font-bold" data-testid="stat-total-members">{totalMembers}</div>
              <p className="text-sm opacity-80 mt-0.5">Active Members</p>
            </CardContent>
          </Card>
          <Card className="bg-card border border-border/50 shadow-lg shadow/50 rounded-2xl">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-warning/10 dark:bg-warning/10">
                  <TrendingUp className="h-4 w-4 text-warning" />
                </div>
              </div>
              <div className="text-2xl font-bold text-foreground truncate" data-testid="stat-popular-plan">{mostPopularPlan?.name || 'N/A'}</div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {mostPopularPlan ? `${memberCounts[mostPopularPlan.id] || 0} members` : 'Most Popular'}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border border-border/50 shadow-lg shadow/50 rounded-2xl">
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <IndianRupee className="h-4 w-4 text-primary" />
                </div>
              </div>
              <div className="text-2xl font-bold text-foreground" data-testid="stat-avg-price">{formatPrice(avgPrice)}</div>
              <p className="text-sm text-muted-foreground mt-0.5">Avg Plan Price</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs: Membership Plans vs Add-On Packages */}
        <Tabs defaultValue="membership" className="w-full">
          <TabsList className="rounded-xl">
            <TabsTrigger value="membership" className="rounded-lg">Membership Plans</TabsTrigger>
            <TabsTrigger value="addons" className="rounded-lg">Add-On Packages</TabsTrigger>
          </TabsList>

          <TabsContent value="addons" className="mt-5">
            <BenefitPackagesPanel branchId={defaultBranchId || undefined} />
          </TabsContent>

          <TabsContent value="membership" className="mt-5 space-y-6">
        {/* Two-panel area */}
        {isLoading ? (
          <div className="bg-card/60 dark:bg-foreground/60 backdrop-blur-xl ring-1 ring-white/20 shadow-2xl rounded-3xl overflow-hidden">
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ) : plans?.length === 0 ? (
          <div className="bg-card/60 dark:bg-foreground/60 backdrop-blur-xl ring-1 ring-white/20 shadow-2xl rounded-3xl overflow-hidden">
            <div className="py-20 text-center px-8">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6">
                <Sparkles className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Plans Yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">Create your first membership plan to start selling memberships</p>
              <Button onClick={() => setAddPlanOpen(true)} className="gap-2 rounded-xl" data-testid="btn-create-first-plan">
                <Plus className="h-4 w-4" />
                Create Your First Plan
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-card/60 dark:bg-foreground/60 backdrop-blur-xl ring-1 ring-white/20 shadow-2xl rounded-3xl overflow-hidden flex min-h-[520px]">
            {/* Left panel — plan list (35%) */}
            <div className="w-[35%] bg-muted/30 flex flex-col overflow-y-auto border-r border-border/40">
              {/* Search */}
              <div className="p-3 border-b border-border/40 sticky top-0 bg-muted/30 backdrop-blur-sm z-10">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    data-testid="input-plan-search"
                    value={planSearch}
                    onChange={e => setPlanSearch(e.target.value)}
                    placeholder="Search plans..."
                    className="pl-8 h-8 text-sm rounded-lg"
                  />
                  {planSearch && (
                    <button
                      onClick={() => setPlanSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {/* Plan list */}
              <div className="divide-y divide-border/40 flex-1">
              {/* Active plans */}
              {activePlans.map((plan, index) => (
                <PlanListItem
                  key={plan.id}
                  plan={plan}
                  index={index}
                  isPopular={mostPopularPlan?.id === plan.id && (memberCounts[plan.id] || 0) > 0}
                  memberCount={memberCounts[plan.id] || 0}
                  isSelected={selectedPlan?.id === plan.id}
                  formatPrice={formatPrice}
                  getDurationLabel={getDurationLabel}
                  onClick={() => handleSelectPlan(plan, index)}
                  animationDelay={index * 50}
                />
              ))}

              {/* Inactive plans section */}
              {inactivePlans.length > 0 && (
                <>
                  <div className="px-4 py-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/50">
                    <div className="h-px flex-1 bg-border/60" />
                    Inactive Plans
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                  {inactivePlans.map((plan, index) => {
                    const globalIndex = activePlans.length + index;
                    return (
                      <PlanListItem
                        key={plan.id}
                        plan={plan}
                        index={globalIndex}
                        isPopular={false}
                        memberCount={memberCounts[plan.id] || 0}
                        isSelected={selectedPlan?.id === plan.id}
                        formatPrice={formatPrice}
                        getDurationLabel={getDurationLabel}
                        onClick={() => handleSelectPlan(plan, globalIndex)}
                        animationDelay={globalIndex * 50}
                      />
                    );
                  })}
                </>
              )}
              {activePlans.length === 0 && inactivePlans.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">No plans match your search.</div>
              )}
              </div>
            </div>

            {/* Right panel — detail (65%) */}
            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 p-6">
              {selectedPlan ? (
                <PlanDetailPanel
                  key={selectedPlan.id}
                  plan={selectedPlan}
                  planIndex={selectedPlanIndex}
                  memberCount={memberCounts[selectedPlan.id] || 0}
                  formatPrice={formatPrice}
                  getDurationLabel={getDurationLabel}
                  onEdit={handleEditPlan}
                  onMemberCountClick={handleMemberCountClick}
                />
              ) : (
                <EmptyDetailState />
              )}
              </div>
            </div>
          </div>
        )}
          </TabsContent>
        </Tabs>

        <AddPlanDrawer open={addPlanOpen} onOpenChange={setAddPlanOpen} branchId={defaultBranchId} />
        <EditPlanDrawer
          open={editPlanOpen}
          onOpenChange={setEditPlanOpen}
          plan={editPlan}
          branchId={defaultBranchId}
        />

        {/* Member List Drawer */}
        <Sheet open={!!memberListPlanId} onOpenChange={(open) => { if (!open) setMemberListPlanId(null); }}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                {memberListPlanName} — Active Members
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              {membersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                </div>
              ) : planMembers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No active members on this plan</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planMembers.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={m.profile?.avatar_url} />
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {(m.profile?.full_name || '?')[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">{m.profile?.full_name || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{m.profile?.phone || m.profile?.email || ''}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{m.member_code}</TableCell>
                        <TableCell className="text-sm">{m.end_date ? format(new Date(m.end_date), 'MMM dd, yyyy') : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </AppLayout>
  );
}
