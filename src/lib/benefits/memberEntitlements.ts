import { supabase } from '@/integrations/supabase/client';

export interface MemberEntitlement {
  id: string;
  benefitTypeId: string;
  name: string;
  code: string;
  icon: string;
  frequency: string;
  periodLabel: string;
  planTotal: number | null;
  planUsed: number;
  giftTotal: number;
  giftRemaining: number;
  addOnTotal: number;
  addOnRemaining: number;
  total: number | null;
  remaining: number | null;
  expiresAt: string | null;
  isGiftOnly: boolean;
  isScannerAssessment: boolean;
  canBookRecovery: boolean;
}

export interface PlanBenefitInput {
  id: string;
  benefit_type_id: string | null;
  frequency: string | null;
  limit_count: number | null;
  benefit_types: {
    name: string | null;
    code: string | null;
    icon: string | null;
    is_bookable: boolean | null;
  } | null;
}

export interface BenefitUsageInput {
  benefit_type_id: string | null;
  usage_count: number | null;
}

export interface GiftInput {
  id: string;
  benefit_type_id: string;
  comp_sessions: number;
  used_sessions: number;
  expires_at: string | null;
  benefit_types: {
    name: string | null;
    code: string | null;
    icon: string | null;
    is_bookable: boolean | null;
  } | null;
}

export interface CreditInput {
  id: string;
  benefit_type_id: string | null;
  credits_total: number;
  credits_remaining: number;
  expires_at: string | null;
  benefit_type: {
    name: string | null;
    code: string | null;
    icon: string | null;
    is_bookable: boolean | null;
  } | null;
}

function periodLabel(frequency: string): string {
  if (frequency === 'daily') return 'Per day';
  if (frequency === 'weekly') return 'Per week';
  if (frequency === 'monthly') return 'Per month';
  if (frequency === 'per_membership') return 'Total for membership';
  return 'Included';
}

function isScanner(code: string, name: string): boolean {
  return /3d_body_scanning|howbody_posture|body_scan|posture_scan/i.test(code)
    || /body composition|posture scan|body scan|bmi/i.test(name);
}

function isRecovery(code: string, name: string, isBookable: boolean): boolean {
  return isBookable && !isScanner(code, name)
    && /steam|sauna|ice|pool|spa|recovery|plunge/i.test(`${code} ${name}`);
}

export function mergeMemberEntitlements(
  planBenefits: PlanBenefitInput[],
  usage: BenefitUsageInput[],
  gifts: GiftInput[],
  credits: CreditInput[],
  now = new Date(),
): MemberEntitlement[] {
  const activeGift = gifts.filter((gift) =>
    gift.used_sessions < gift.comp_sessions
    && (!gift.expires_at || new Date(gift.expires_at).getTime() > now.getTime()),
  );
  const activeCredits = credits.filter((credit) =>
    credit.credits_remaining > 0
    && (!credit.expires_at || new Date(credit.expires_at).getTime() > now.getTime()),
  );
  const ids = new Set<string>();
  planBenefits.forEach((benefit) => benefit.benefit_type_id && ids.add(benefit.benefit_type_id));
  activeGift.forEach((gift) => ids.add(gift.benefit_type_id));
  activeCredits.forEach((credit) => credit.benefit_type_id && ids.add(credit.benefit_type_id));

  return Array.from(ids).map((benefitTypeId) => {
    const plan = planBenefits.find((benefit) => benefit.benefit_type_id === benefitTypeId);
    const type = plan?.benefit_types
      ?? activeGift.find((gift) => gift.benefit_type_id === benefitTypeId)?.benefit_types
      ?? activeCredits.find((credit) => credit.benefit_type_id === benefitTypeId)?.benefit_type
      ?? null;
    const matchingGifts = activeGift.filter((gift) => gift.benefit_type_id === benefitTypeId);
    const matchingCredits = activeCredits.filter((credit) => credit.benefit_type_id === benefitTypeId);
    const planUsed = usage
      .filter((entry) => entry.benefit_type_id === benefitTypeId)
      .reduce((sum, entry) => sum + (entry.usage_count ?? 1), 0);
    const unlimited = plan?.frequency === 'unlimited' || (Boolean(plan) && plan?.limit_count === null);
    const planTotal = unlimited ? null : Math.max(0, plan?.limit_count ?? 0);
    const planRemaining = planTotal === null ? null : Math.max(0, planTotal - planUsed);
    const giftTotal = matchingGifts.reduce((sum, gift) => sum + gift.comp_sessions, 0);
    const giftRemaining = matchingGifts.reduce(
      (sum, gift) => sum + Math.max(0, gift.comp_sessions - gift.used_sessions),
      0,
    );
    const addOnTotal = matchingCredits.reduce((sum, credit) => sum + credit.credits_total, 0);
    const addOnRemaining = matchingCredits.reduce((sum, credit) => sum + credit.credits_remaining, 0);
    const expiries = [...matchingGifts, ...matchingCredits]
      .map((item) => item.expires_at)
      .filter((value): value is string => Boolean(value))
      .sort();
    const name = type?.name || 'Benefit';
    const code = type?.code || 'other';

    return {
      id: plan?.id || matchingGifts[0]?.id || matchingCredits[0]?.id || benefitTypeId,
      benefitTypeId,
      name,
      code,
      icon: type?.icon || 'sparkles',
      frequency: plan?.frequency || 'per_membership',
      periodLabel: periodLabel(plan?.frequency || 'per_membership'),
      planTotal,
      planUsed,
      giftTotal,
      giftRemaining,
      addOnTotal,
      addOnRemaining,
      total: planTotal === null ? null : planTotal + giftTotal + addOnTotal,
      remaining: planRemaining === null ? null : planRemaining + giftRemaining + addOnRemaining,
      expiresAt: expiries[0] || null,
      isGiftOnly: !plan && giftRemaining > 0 && addOnRemaining === 0,
      isScannerAssessment: isScanner(code, name),
      canBookRecovery: isRecovery(code, name, type?.is_bookable === true),
    };
  });
}

export async function fetchMemberEntitlements(params: {
  memberId: string;
  membershipId: string;
  planId: string;
}): Promise<MemberEntitlement[]> {
  const nowIso = new Date().toISOString();
  const [planResult, usageResult, giftResult, creditResult] = await Promise.all([
    supabase
      .from('plan_benefits')
      .select('id, benefit_type_id, frequency, limit_count, benefit_types:benefit_type_id(name, code, icon, is_bookable)')
      .eq('plan_id', params.planId),
    supabase
      .from('benefit_usage')
      .select('benefit_type_id, usage_count')
      .eq('membership_id', params.membershipId),
    supabase
      .from('member_comps')
      .select('id, benefit_type_id, comp_sessions, used_sessions, expires_at, benefit_types:benefit_type_id(name, code, icon, is_bookable)')
      .eq('member_id', params.memberId)
      .eq('membership_id', params.membershipId)
      .gt('comp_sessions', 0),
    supabase
      .from('member_benefit_credits')
      .select('id, benefit_type_id, credits_total, credits_remaining, expires_at, benefit_type:benefit_types(id, name, code, icon, is_bookable)')
      .eq('member_id', params.memberId)
      .gt('credits_remaining', 0)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
  ]);

  const error = planResult.error || usageResult.error || giftResult.error || creditResult.error;
  if (error) throw error;

  return mergeMemberEntitlements(
    (planResult.data ?? []) as unknown as PlanBenefitInput[],
    (usageResult.data ?? []) as BenefitUsageInput[],
    (giftResult.data ?? []) as unknown as GiftInput[],
    (creditResult.data ?? []) as unknown as CreditInput[],
  );
}