export type ReferralStatusFilter = 'all' | 'new' | 'pending' | 'converted' | 'expired';
export type RewardStatusFilter = 'all' | 'available' | 'pending_approval' | 'credited' | 'rejected';

export interface ReferralFilterRow {
  referral_code: string;
  referred_name: string | null;
  referred_phone: string | null;
  referred_email?: string | null;
  status: string;
  referrer?: { member_code: string; profiles: { full_name: string | null } | null } | null;
}

export interface RewardFilterRow {
  is_claimed: boolean;
  claim_status?: string | null;
  members?: { member_code: string; profiles: { full_name: string | null } | null } | null;
  referrals?: { referral_code: string } | null;
}

export function referralMatches(row: ReferralFilterRow, search: string, status: ReferralStatusFilter) {
  const normalized = search.trim().toLowerCase();
  const statusMatches = status === 'all' || row.status === status;
  if (!statusMatches) return false;
  if (!normalized) return true;
  return [
    row.referral_code,
    row.referred_name,
    row.referred_phone,
    row.referred_email,
    row.referrer?.member_code,
    row.referrer?.profiles?.full_name,
  ].some((value) => value?.toLowerCase().includes(normalized));
}

export function rewardDisplayStatus(row: RewardFilterRow): Exclude<RewardStatusFilter, 'all'> {
  if (row.is_claimed) return 'credited';
  if (row.claim_status === 'pending_approval') return 'pending_approval';
  if (row.claim_status === 'rejected') return 'rejected';
  return 'available';
}

export function rewardMatches(row: RewardFilterRow, search: string, status: RewardStatusFilter) {
  const normalized = search.trim().toLowerCase();
  if (status !== 'all' && rewardDisplayStatus(row) !== status) return false;
  if (!normalized) return true;
  return [row.members?.profiles?.full_name, row.members?.member_code, row.referrals?.referral_code]
    .some((value) => value?.toLowerCase().includes(normalized));
}

export function conversionRate(total: number, converted: number) {
  return total <= 0 ? 0 : Math.round((converted / total) * 1000) / 10;
}
