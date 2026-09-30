import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useMemberData } from '@/hooks/useMemberData';
import { createTask } from '@/services/taskService';
import type {
  ConciergeInvoiceSummary,
  ConciergePlanOption,
  ConciergePtOption,
  ConciergeSelection,
} from '@/types/concierge';

interface PlanBenefitRow {
  limit_count: number | null;
  frequency: string | null;
  benefit_types: { name: string | null } | null;
}

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  discounted_price: number | null;
  duration_days: number;
  gst_rate: number | null;
  is_gst_inclusive: boolean | null;
  is_visible_to_members: boolean | null;
  display_order: number | null;
  plan_benefits: PlanBenefitRow[] | null;
}

interface PtPackageRow {
  id: string;
  name: string;
  price: number;
  total_sessions: number | null;
  validity_days: number;
  gst_percentage: number | null;
  gst_inclusive: boolean | null;
}

function perksOf(plan: PlanRow): string[] {
  return (plan.plan_benefits ?? [])
    .map((b) => {
      const name = b.benefit_types?.name?.trim();
      if (!name) return null;
      if (b.limit_count && b.limit_count > 0) {
        const period = b.frequency && b.frequency !== 'one_time' ? ` / ${b.frequency.replace(/_/g, ' ')}` : '';
        return `${name} · ${b.limit_count}${period}`;
      }
      return name;
    })
    .filter((x): x is string => Boolean(x))
    .slice(0, 5);
}

/**
 * Everything the Renewal Concierge needs: who the member is, what they are on,
 * what they can renew or top up, and any invoice already waiting for payment.
 */
export function useMemberConcierge() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const {
    member,
    activeMembership,
    ptPackages,
    pendingInvoices,
    daysRemaining,
    isLoading: memberLoading,
  } = useMemberData();

  const branchId: string | null = (member as { branch_id?: string } | null)?.branch_id ?? null;
  const currentPlanId: string | null =
    (activeMembership as { plan_id?: string } | null)?.plan_id ?? null;

  const plansQuery = useQuery({
    queryKey: ['concierge-plans', branchId],
    enabled: Boolean(branchId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PlanRow[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select(
          'id, name, description, price, discounted_price, duration_days, gst_rate, is_gst_inclusive, is_visible_to_members, display_order, plan_benefits(limit_count, frequency, benefit_types:benefit_type_id(name))',
        )
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PlanRow[];
    },
  });

  const ptQuery = useQuery({
    queryKey: ['concierge-pt-packages', branchId],
    enabled: Boolean(branchId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PtPackageRow[]> => {
      const { data, error } = await supabase
        .from('pt_packages')
        .select('id, name, price, total_sessions, validity_days, gst_percentage, gst_inclusive')
        .eq('is_active', true)
        .eq('branch_id', branchId!)
        .order('total_sessions', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PtPackageRow[];
    },
  });

  const plans: ConciergePlanOption[] = useMemo(() => {
    const rows = (plansQuery.data ?? []).filter(
      (p) => p.is_visible_to_members !== false || p.id === currentPlanId,
    );
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.discounted_price ?? p.price) || Number(p.price) || 0,
      durationDays: Number(p.duration_days) || 0,
      gstRate: p.gst_rate,
      gstInclusive: p.is_gst_inclusive !== false,
      perks: perksOf(p),
      isCurrent: p.id === currentPlanId,
    }));
  }, [plansQuery.data, currentPlanId]);

  const currentPlan = plans.find((p) => p.isCurrent) ?? null;

  /** Upsell: the next plan up in value that the member is not already on. */
  const upgradePlan = useMemo(() => {
    const others = plans.filter((p) => !p.isCurrent);
    if (others.length === 0) return null;
    const floor = currentPlan?.price ?? 0;
    const dearer = others.filter((p) => p.price > floor).sort((a, b) => a.price - b.price);
    return dearer[0] ?? others.sort((a, b) => b.price - a.price)[0] ?? null;
  }, [plans, currentPlan]);

  const ptOptions: ConciergePtOption[] = useMemo(
    () =>
      (ptQuery.data ?? [])
        .filter((p) => (p.total_sessions ?? 0) > 0)
        .map((p) => ({
          id: p.id,
          name: p.name,
          sessions: Number(p.total_sessions) || 0,
          price: Number(p.price) || 0,
          validityDays: Number(p.validity_days) || 0,
          gstRate: p.gst_percentage,
          gstInclusive: p.gst_inclusive !== false,
        })),
    [ptQuery.data],
  );

  /** Live PT balance across active packages. */
  const ptBalance = useMemo(() => {
    const active = (ptPackages as Array<Record<string, unknown>>).filter(
      (p) => String(p.status) === 'active',
    );
    const remaining = active.reduce((sum, p) => sum + (Number(p.sessions_remaining) || 0), 0);
    const total = active.reduce((sum, p) => sum + (Number(p.sessions_total) || 0), 0);
    const trainer = active
      .map((p) => (p.trainer as { profile?: { full_name?: string } } | null)?.profile?.full_name)
      .find((n): n is string => Boolean(n)) ?? null;
    return { remaining, total, trainer, hasPackage: active.length > 0 };
  }, [ptPackages]);

  /** An invoice already raised for this member and still payable. */
  const payableInvoice: ConciergeInvoiceSummary | null = useMemo(() => {
    const rows = (pendingInvoices as Array<Record<string, unknown>>) ?? [];
    const first = rows.find((inv) => Number(inv.total_amount) - Number(inv.amount_paid ?? 0) > 0);
    if (!first) return null;
    const total = Number(first.total_amount) || 0;
    const paid = Number(first.amount_paid) || 0;
    return {
      id: String(first.id),
      invoiceNumber: String(first.invoice_number ?? ''),
      totalAmount: total,
      amountPaid: paid,
      balance: total - paid,
      status: String(first.status ?? 'pending'),
      dueDate: (first.due_date as string | null) ?? null,
    };
  }, [pendingInvoices]);

  /**
   * Members cannot issue their own membership invoices — the front desk does,
   * so a confirmed selection is recorded as a high-priority desk task.
   */
  const requestCheckout = useMutation({
    mutationFn: async (selection: ConciergeSelection) => {
      if (!member || !branchId) throw new Error('Your membership profile is not linked yet.');
      const memberName =
        (profile as { full_name?: string } | null)?.full_name ??
        (member as { member_code?: string }).member_code ??
        'Member';
      const kindLabel = selection.kind === 'membership' ? 'Membership renewal' : 'PT top-up';
      await createTask({
        branchId,
        title: `${kindLabel} request from ${memberName}`,
        description: `${memberName} requested ${selection.name} (${selection.detail}) from the Renewal Concierge. Raise the invoice and send the payment link.`,
        priority: 'high',
        slaHours: 4,
        memberCreated: true,
        assignedBy: user?.id,
        linkedEntityType: 'member',
        linkedEntityId: (member as { id: string }).id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-plan-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
    },
  });

  return {
    member,
    memberName:
      (profile as { full_name?: string } | null)?.full_name ??
      (member as { member_code?: string } | null)?.member_code ??
      'there',
    activeMembership,
    daysRemaining,
    currentPlan,
    upgradePlan,
    plans,
    ptOptions,
    ptBalance,
    payableInvoice,
    requestCheckout,
    isLoading: memberLoading || plansQuery.isLoading || ptQuery.isLoading,
    isError: plansQuery.isError || ptQuery.isError,
    refetch: () => {
      plansQuery.refetch();
      ptQuery.refetch();
    },
  };
}
