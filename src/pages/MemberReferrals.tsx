import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { useMemberData } from '@/hooks/useMemberData';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchMemberReferrals, fetchMemberRewards, claimReward } from '@/services/referralService';
import { Gift, Copy, Share2, Users, CheckCircle, Clock, AlertCircle, Loader2, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ReferralLifecycleTimeline } from '@/components/referrals/ReferralLifecycleTimeline';

export default function MemberReferrals() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { member, isLoading: memberLoading } = useMemberData();

  // Generate referral code from member_code or name
  const referralCode = member?.member_code || 
    `${(profile?.full_name || 'MEMBER').split(' ')[0].toUpperCase()}-${new Date().getFullYear()}`;

  const appUrl = window.location.origin;
  const referralLink = `${appUrl}/auth?ref=${referralCode}`;

  const { data: referrals = [], isLoading: referralsLoading } = useQuery({
    queryKey: ['my-referrals', member?.id],
    enabled: !!member,
    queryFn: () => fetchMemberReferrals(member!.id),
  });

  const { data: rewards = [], isLoading: rewardsLoading } = useQuery({
    queryKey: ['my-referral-rewards', member?.id],
    enabled: !!member,
    queryFn: () => fetchMemberRewards(member!.id),
  });

  const claimRewardMutation = useMutation({
    mutationFn: ({ rewardId, memberId }: { rewardId: string; memberId: string }) => 
      claimReward(rewardId, memberId),
    onSuccess: () => {
      toast.success('Sent to branch manager for approval');
      queryClient.invalidateQueries({ queryKey: ['my-referral-rewards'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to claim reward'),
  });

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success('Referral link copied!');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleShareWhatsApp = () => {
    const message = encodeURIComponent(
      `Hey! Join me at my gym and get rewarded! Sign up with my referral code: ${referralCode}\n\n${referralLink}`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (memberLoading) {
    return <AppLayout><div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div></AppLayout>;
  }

  if (!member) {
    return <AppLayout><div className="flex flex-col items-center justify-center min-h-[50vh] gap-4"><AlertCircle className="h-12 w-12 text-warning" /><h2 className="text-xl font-semibold">No Member Profile Found</h2></div></AppLayout>;
  }

  const convertedCount = referrals.filter((r: any) => r.status === 'converted').length;
  const totalRewardsValue = rewards.reduce((sum: number, r: any) => sum + (r.reward_value || 0), 0);
  const claimedRewardsValue = rewards.filter((r: any) => r.is_claimed).reduce((sum: number, r: any) => sum + (r.reward_value || 0), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'converted': return <Badge variant="default" className="bg-success">Converted</Badge>;
      case 'pending': return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'expired': return <Badge variant="destructive">Expired</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Refer & Earn</h1>
          <p className="text-muted-foreground">Invite friends and earn rewards</p>
        </div>

        {/* Referral Code & Share */}
        <Card className="border-border/50 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary" />Your Referral Code</CardTitle>
            <CardDescription>Share this code with friends to earn rewards</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-lg font-bold tracking-wider text-center">
                {referralCode}
              </div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" variant="outline" onClick={handleCopyLink}>
                <Copy className="h-4 w-4 mr-2" />Copy Link
              </Button>
              <Button className="flex-1" variant="outline" onClick={handleShareWhatsApp}>
                <MessageSquare className="h-4 w-4 mr-2" />Share on WhatsApp
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid gap-4 grid-cols-3">
          <StatCard
            title="Referrals Sent"
            value={referrals.length}
            icon={Share2}
            variant="default"
          />
          <StatCard
            title="Successful Signups"
            value={convertedCount}
            icon={Users}
            variant="success"
          />
          <StatCard
            title="Rewards Available"
            value={`₹${totalRewardsValue.toLocaleString()}`}
            icon={Gift}
            variant="accent"
          />
        </div>

        {/* Rewards */}
        {rewards.length > 0 && (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">My Rewards</CardTitle>
              {claimedRewardsValue > 0 && (
                <p className="text-sm text-muted-foreground">₹{claimedRewardsValue.toLocaleString()} credited to your wallet</p>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {rewards.map((reward: any) => (
                  <div key={reward.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Gift className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">{reward.reward_type === 'wallet_credit' ? `₹${reward.reward_value} Wallet Credit` : reward.reward_type}</p>
                        <p className="text-sm text-muted-foreground">{format(new Date(reward.created_at), 'dd MMM yyyy')}</p>
                      </div>
                    </div>
                    {reward.is_claimed ? (
                      <Badge variant="default" className="bg-success"><CheckCircle className="h-3 w-3 mr-1" />Claimed</Badge>
                    ) : reward.claim_status === 'pending_approval' ? (
                      <Badge variant="outline" className="text-warning border-warning/30">Awaiting approval</Badge>
                    ) : (
                      <Button size="sm" onClick={() => claimRewardMutation.mutate({ rewardId: reward.id, memberId: member.id })} disabled={claimRewardMutation.isPending}>
                        Claim
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Referral History — lifecycle timeline */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Referral Lifecycle</CardTitle>
            <CardDescription>Pending → Eligible → Reward Issued → Claimed → Wallet Credited</CardDescription>
          </CardHeader>
          <CardContent>
            {referralsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : referrals.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No referrals yet. Share your code to get started!</p>
              </div>
            ) : (
              <ReferralLifecycleTimeline
                referrals={(referrals as any[]).map((r) => ({
                  ...r,
                  reward: (rewards as any[]).find((w) => w.referral_id === r.id) || null,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
