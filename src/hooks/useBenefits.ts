import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMembershipWithBenefits,
  fetchBenefitUsage,
  fetchBenefitUsageHistory,
  recordBenefitUsage,
  recordBenefitUsageAtomic,
  validateBenefitUsage,
  calculateBenefitBalances,
  type MembershipWithBenefits,
  type MemberBenefitBalance,
} from '@/services/benefitService';
import { invalidateBenefitData } from '@/lib/benefits/invalidateBenefitData';

import type { Database } from '@/integrations/supabase/types';

type BenefitType = Database['public']['Enums']['benefit_type'];

// Fetch member's active membership with benefits
export function useMembershipBenefits(memberId: string) {
  return useQuery({
    queryKey: ['membership-benefits', memberId],
    queryFn: () => fetchMembershipWithBenefits(memberId),
    enabled: !!memberId,
  });
}

// Fetch benefit usage for a membership
export function useBenefitUsage(membershipId: string) {
  return useQuery({
    queryKey: ['benefit-usage', membershipId],
    queryFn: () => fetchBenefitUsage(membershipId),
    enabled: !!membershipId,
  });
}

// Combined hook for benefit balances
export function useBenefitBalances(memberId: string): {
  membership: MembershipWithBenefits | null | undefined;
  balances: MemberBenefitBalance[];
  isLoading: boolean;
  error: Error | null;
} {
  const membershipQuery = useMembershipBenefits(memberId);
  const membershipId = membershipQuery.data?.id || '';
  
  const usageQuery = useBenefitUsage(membershipId);

  const balances = membershipQuery.data && usageQuery.data
    ? calculateBenefitBalances(
        membershipQuery.data.plan.benefits,
        usageQuery.data,
        membershipQuery.data.start_date
      )
    : [];

  return {
    membership: membershipQuery.data,
    balances,
    isLoading: membershipQuery.isLoading || usageQuery.isLoading,
    error: (membershipQuery.error || usageQuery.error) as Error | null,
  };
}

// Fetch benefit usage history
export function useBenefitUsageHistory(membershipId: string, benefitType?: BenefitType) {
  return useQuery({
    queryKey: ['benefit-usage-history', membershipId, benefitType],
    queryFn: () => fetchBenefitUsageHistory(membershipId, benefitType),
    enabled: !!membershipId,
  });
}

// Record benefit usage mutation (atomic: plan -> gifts -> purchased credits)
export function useRecordBenefitUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      membershipId,
      memberId,
      benefitType,
      usageCount,
      notes,
      benefitTypeId,
      usageDate,
      usageTime,
    }: {
      membershipId: string;
      memberId: string;
      benefitType: BenefitType;
      usageCount?: number;
      notes?: string;
      benefitTypeId?: string;
      usageDate?: string | null;
      usageTime?: string | null;
    }) =>
      recordBenefitUsageAtomic({
        membershipId,
        memberId,
        benefitType,
        benefitTypeId,
        usageCount,
        notes,
        usageDate,
        usageTime,
      }),

    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['benefit-usage', variables.membershipId] });
      queryClient.invalidateQueries({ queryKey: ['benefit-usage-history', variables.membershipId] });
      invalidateBenefitData(queryClient);
    },
  });
}


// Validate benefit usage
export function useValidateBenefitUsage() {
  return useMutation({
    mutationFn: ({
      membershipId,
      benefitType,
    }: {
      membershipId: string;
      benefitType: BenefitType;
    }) => validateBenefitUsage(membershipId, benefitType),
  });
}
