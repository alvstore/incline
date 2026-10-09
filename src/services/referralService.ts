import { supabase } from '@/integrations/supabase/client';

async function checkAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function fetchMemberReferrals(memberId: string) {
  const user = await checkAuth();
  if (!user) return [];

  const { data, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_member_id', memberId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function fetchAllReferrals() {
  const user = await checkAuth();
  if (!user) return [];

  const { data, error } = await supabase
    .from('referrals')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function fetchMemberRewards(memberId: string) {
  const user = await checkAuth();
  if (!user) return [];

  const { data, error } = await supabase
    .from('referral_rewards')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Ask to add a referral reward to the wallet. Nothing is credited here —
 * the branch manager must approve it under Approvals first.
 */
export async function claimReward(rewardId: string, _memberId?: string) {
  const user = await checkAuth();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase.rpc('request_referral_reward_claim', { p_reward_id: rewardId });
  if (error) throw error;
  const result = data as { success?: boolean; error?: string; pending?: boolean } | null;
  if (!result?.success) throw new Error(result?.error || 'Failed to request reward');
  return result;
}
