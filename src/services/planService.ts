import { supabase } from '@/integrations/supabase/client';
import type { MembershipPlanWithBenefits, PlanBenefit, BenefitType, FrequencyType } from '@/types/membership';

export async function fetchPlans(branchId?: string, includeInactive = false) {
  let query = supabase
    .from('membership_plans')
    .select('*, plan_benefits(*, benefit_types:benefit_type_id(id, name, code, icon))')
    .order('display_order', { ascending: true });

  if (branchId) {
    query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);
  }

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as MembershipPlanWithBenefits[];
}

export async function fetchPlan(planId: string) {
  const { data, error } = await supabase
    .from('membership_plans')
    .select('*, plan_benefits(*, benefit_types:benefit_type_id(id, name, code, icon))')
    .eq('id', planId)
    .single();

  if (error) throw error;
  return data as MembershipPlanWithBenefits;
}

export async function createPlan(plan: {
  name: string;
  description?: string;
  duration_days: number;
  price: number;
  discounted_price?: number;
  admission_fee?: number;
  max_freeze_days?: number;
  is_transferable?: boolean;
  branch_id?: string;
  benefits?: { benefit_type: BenefitType; frequency: FrequencyType; limit_count?: number; description?: string }[];
}) {
  const { benefits, ...planData } = plan;

  const { data: newPlan, error: planError } = await supabase
    .from('membership_plans')
    .insert(planData)
    .select()
    .single();

  if (planError) throw planError;

  if (benefits && benefits.length > 0) {
    const { error: benefitsError } = await supabase
      .from('plan_benefits')
      .insert(benefits.map(b => ({ ...b, plan_id: newPlan.id })));

    if (benefitsError) throw benefitsError;
  }

  return fetchPlan(newPlan.id);
}

export async function updatePlan(
  planId: string,
  plan: Partial<{
    name: string;
    description: string;
    duration_days: number;
    price: number;
    discounted_price: number;
    admission_fee: number;
    max_freeze_days: number;
    is_transferable: boolean;
    is_active: boolean;
    includes_free_locker: boolean;
    free_locker_size: string | null;
    is_visible_to_members: boolean;
  }>

) {
  const { data, error } = await supabase
    .from('membership_plans')
    .update(plan)
    .eq('id', planId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePlanBenefits(
  planId: string,
  benefits: { benefit_type: BenefitType; frequency: FrequencyType; limit_count?: number; description?: string }[]
) {
  // Delete existing benefits
  await supabase.from('plan_benefits').delete().eq('plan_id', planId);

  // Insert new benefits
  if (benefits.length > 0) {
    const { error } = await supabase
      .from('plan_benefits')
      .insert(benefits.map(b => ({ ...b, plan_id: planId })));

    if (error) throw error;
  }

  return fetchPlan(planId);
}

export async function deletePlan(planId: string) {
  // Soft delete by marking inactive
  const { error } = await supabase
    .from('membership_plans')
    .update({ is_active: false })
    .eq('id', planId);

  if (error) throw error;
}