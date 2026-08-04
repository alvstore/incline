import type { QueryClient } from '@tanstack/react-query';

/**
 * Every query key that depends on complimentary gifts or benefit credits.
 * Granting / amending / revoking a gift must invalidate all of them so staff
 * and member surfaces update without a manual page refresh.
 */
export const BENEFIT_QUERY_KEYS = [
  // gifts
  'member-comps',
  'member-comps-profile',
  'member-comps-tracking',
  // credits
  'member-benefit-credits',
  'dashboard-benefit-credits',
  'my-benefit-credits',
  'eligible-addons-credits',
  'benefit-balances',
  'benefit-usage',
  // booking surfaces
  'concierge-facilities',
  'concierge-slots',
  'all-benefit-bookings',
  'my-benefit-bookings',
  'member-bookable-benefits',
  // member header data
  'member-details',
] as const;

export function invalidateBenefitData(queryClient: QueryClient) {
  BENEFIT_QUERY_KEYS.forEach((key) =>
    queryClient.invalidateQueries({ queryKey: [key] }),
  );
}
