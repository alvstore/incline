import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gift, Users, Wallet, Copy, Check, Plus, Download, ArrowRightLeft, AlertCircle, IndianRupee, ExternalLink } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { claimReward } from '@/services/referralService';
import { exportToCSV } from '@/lib/csvExport';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberProfile {
  full_name: string | null;
}

interface ReferralMember {
  id: string;
  member_code: string;
  user_id: string | null;
  branch_id: string | null;
  profiles: MemberProfile | null;
}

interface Referral {
  id: string;
  referral_code: string;
  referrer_member_id: string;
  referred_member_id: string | null;
  referred_name: string | null;
  referred_phone: string | null;
  branch_id: string | null;
  status: 'new' | 'pending' | 'converted' | 'expired';
  created_at: string;
  converted_at: string | null;
  referrer: ReferralMember | null;
  referred: ReferralMember | null;
}

interface Reward {
  id: string;
  referral_id: string | null;
  member_id: string;
  reward_type: string;
  reward_value: number;
  description: string | null;
  is_claimed: boolean;
  claimed_at: string | null;
  created_at: string;
  members: { id: string; member_code: string; profiles: MemberProfile | null } | null;
  referrals: { referral_code: string } | null;
}

interface ReferralSettings {
  id: string;
  branch_id: string | null;
  is_active: boolean;
  reward_mode: 'fixed' | 'percentage';
  referrer_reward_value: number;
  referred_reward_value: number;
  min_membership_value: number;
  referrer_reward_type: string;
  referred_reward_type: string;
}

// Compute actual rupee reward value from settings
function computeRewardValue(
  mode: 'fixed' | 'percentage',
  settingValue: number,
  membershipValue: number
): number {
  if (mode === 'percentage') {
    return Math.round((membershipValue * settingValue) / 100);
  }
  return settingValue;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReferralsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [createReferralOpen, setCreateReferralOpen] = useState(false);
  const [newReferral, setNewReferral] = useState({
    referrerMemberId: '',
    referredName: '',
    referredPhone: '',
    referredEmail: '',
  });

  // Convert drawer state
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertingReferral, setConvertingReferral] = useState<Referral | null>(null);
  const [convertMemberId, setConvertMemberId] = useState('');

  const queryClient = useQueryClient();

  // All members for referrer/convert selects
  const { data: members = [] } = useQuery({
    queryKey: ['referral-members'],
    enabled: !!user,
    queryFn: async (): Promise<ReferralMember[]> => {
      const { data, error } = await supabase
        .from('members')
        .select('id, member_code, user_id, branch_id')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = data || [];
      const userIds = rows.map(m => m.user_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));
      return rows.map(m => ({
        ...m,
        profiles: profileMap.get(m.user_id ?? '') ?? null,
      }));
    },
  });

  // Branch-aware referral settings — fetched when convert drawer opens.
  // Resolves branch from: referral.branch_id → referrer's member record → global fallback.
  const { data: convertSettings, isLoading: convertSettingsLoading } = useQuery({
    queryKey: ['convert-referral-settings', convertingReferral?.id],
    enabled: convertOpen && !!convertingReferral,
    queryFn: async (): Promise<ReferralSettings | null> => {
      let branchId: string | null = convertingReferral!.branch_id;

      if (!branchId && convertingReferral!.referrer_member_id) {
        const fromList = members.find(m => m.id === convertingReferral!.referrer_member_id);
        branchId = fromList?.branch_id ?? null;

        if (!branchId) {
          const { data: referrerRow } = await supabase
            .from('members')
            .select('branch_id')
            .eq('id', convertingReferral!.referrer_member_id)
            .maybeSingle();
          branchId = referrerRow?.branch_id ?? null;
        }
      }

      const filterExpr = branchId
        ? `branch_id.eq.${branchId},branch_id.is.null`
        : 'branch_id.is.null';

      const { data, error } = await supabase
        .from('referral_settings')
        .select('*')
        .eq('is_active', true)
        .or(filterExpr)
        .order('branch_id', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ReferralSettings | null;
    },
  });

  // Look up the selected member's active membership value — needed for percentage reward computation.
  const { data: convertMemberMembership } = useQuery({
    queryKey: ['convert-member-membership', convertMemberId],
    enabled: convertOpen && !!convertMemberId,
    queryFn: async (): Promise<{ price_paid: number } | null> => {
      const { data } = await supabase
        .from('memberships')
        .select('price_paid')
        .eq('member_id', convertMemberId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { price_paid: number } | null;
    },
  });

  const createReferralMutation = useMutation({
    mutationFn: async () => {
      const member = members.find(m => m.id === newReferral.referrerMemberId);
      if (!member) throw new Error('Select a referrer member');
      const code = `REF-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase.from('referrals').insert({
        referrer_member_id: newReferral.referrerMemberId,
        referral_code: code,
        referred_name: newReferral.referredName || 'Unknown',
        referred_phone: newReferral.referredPhone || 'N/A',
        status: 'new' as const,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Referral created');
      queryClient.invalidateQueries({ queryKey: ['all-referrals'] });
      setCreateReferralOpen(false);
      setNewReferral({ referrerMemberId: '', referredName: '', referredPhone: '', referredEmail: '' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Convert referral: create rewards FIRST (safer ordering), then update referral status.
  // If reward creation fails → referral stays in new/pending so admin can retry.
  // If status update fails → rewards exist but referral still shows pending (harmless retry).
  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!convertingReferral) throw new Error('No referral selected');
      if (!convertMemberId) throw new Error('Select the member who joined');

      const settings = convertSettings;
      const membershipValue = convertMemberMembership?.price_paid ?? 0;

      const referrerValue = settings
        ? computeRewardValue(settings.reward_mode, settings.referrer_reward_value, membershipValue)
        : 0;
      const referredValue = settings
        ? computeRewardValue(settings.reward_mode, settings.referred_reward_value, membershipValue)
        : 0;

      // Authoritative, atomic, idempotent backend conversion.
      const idem = `convert-${convertingReferral.id}-${convertMemberId}`;
      const { data, error } = await supabase.rpc('convert_referral', {
        p_referral_id: convertingReferral.id,
        p_referred_member_id: convertMemberId,
        p_referrer_reward_type: settings?.referrer_reward_type ?? 'wallet_credit',
        p_referrer_reward_value: referrerValue,
        p_referred_reward_type: settings?.referred_reward_type ?? 'wallet_credit',
        p_referred_reward_value: referredValue,
        p_idempotency_key: idem,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Failed to convert referral');
    },
    onSuccess: () => {
      toast.success('Referral converted and rewards issued!');
      queryClient.invalidateQueries({ queryKey: ['all-referrals'] });
      queryClient.invalidateQueries({ queryKey: ['all-rewards'] });
      setConvertOpen(false);
      setConvertingReferral(null);
      setConvertMemberId('');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to convert referral'),
  });

  const { data: referrals = [], isLoading: referralsLoading } = useQuery({
    queryKey: ['all-referrals'],
    enabled: !!user,
    queryFn: async (): Promise<Referral[]> => {
      const { data, error } = await supabase
        .from('referrals')
        .select(`
          *,
          referrer:referrer_member_id(id, member_code, user_id, branch_id, profiles:user_id(full_name)),
          referred:referred_member_id(id, member_code, user_id, profiles:user_id(full_name))
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Referral[];
    },
  });

  const { data: rewards = [], isLoading: rewardsLoading } = useQuery({
    queryKey: ['all-rewards'],
    enabled: !!user,
    queryFn: async (): Promise<Reward[]> => {
      const { data, error } = await supabase
        .from('referral_rewards')
        .select(`
          *,
          members(id, member_code, profiles:user_id(full_name)),
          referrals(referral_code)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Reward[];
    },
  });

  const claimMutation = useMutation({
    mutationFn: ({ rewardId, memberId }: { rewardId: string; memberId: string }) =>
      claimReward(rewardId, memberId),
    onSuccess: () => {
      toast.success('Reward claimed and credited to wallet!');
      queryClient.invalidateQueries({ queryKey: ['all-rewards'] });
    },
    onError: (error: Error) => {
      toast.error('Failed to claim reward: ' + error.message);
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success('Referral code copied!');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const openConvertDrawer = (referral: Referral) => {
    setConvertingReferral(referral);
    setConvertMemberId('');
    setConvertOpen(true);
  };

  const stats = {
    total: referrals.length,
    converted: referrals.filter(r => r.status === 'converted').length,
    pending: referrals.filter(r => r.status === 'pending' || r.status === 'new').length,
    totalRewards: rewards.reduce((sum, r) => sum + (r.reward_value || 0), 0),
    claimedRewards: rewards.filter(r => r.is_claimed).reduce((sum, r) => sum + (r.reward_value || 0), 0),
  };

  // Reward preview amounts for the convert drawer (uses actual membership value if available)
  const membershipValueForPreview = convertMemberMembership?.price_paid ?? 0;
  const previewReferrerAmount = convertSettings
    ? computeRewardValue(convertSettings.reward_mode, convertSettings.referrer_reward_value, membershipValueForPreview)
    : null;
  const previewReferredAmount = convertSettings
    ? computeRewardValue(convertSettings.reward_mode, convertSettings.referred_reward_value, membershipValueForPreview)
    : null;

  const getStatusClass = (status: string) => {
    if (status === 'converted') return 'bg-success/10 text-success';
    if (status === 'expired') return 'bg-destructive/10 text-destructive';
    return 'bg-warning/10 text-warning';
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Referrals & Rewards</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const rows = referrals.map(r => ({
                  Code: r.referral_code || '',
                  Referrer: r.referrer?.profiles?.full_name || '',
                  'Referred Name': r.referred_name || '',
                  'Referred Phone': r.referred_phone || '',
                  Status: r.status || '',
                }));
                exportToCSV(rows, 'referrals');
              }}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button
              onClick={() => setCreateReferralOpen(true)}
              className="bg-accent hover:bg-accent/90"
              data-testid="button-create-referral"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Referral
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Referrals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-referrals">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Converted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success" data-testid="text-converted-referrals">{stats.converted}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning" data-testid="text-pending-referrals">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Rewards</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">₹{stats.totalRewards.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">₹{stats.claimedRewards.toLocaleString()} claimed</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="referrals">
          <TabsList>
            <TabsTrigger value="referrals">Referrals</TabsTrigger>
            <TabsTrigger value="rewards">
              Rewards
              {rewards.filter(r => !r.is_claimed).length > 0 && (
                <Badge className="ml-2 h-5 min-w-[20px] bg-warning/10 text-warning text-[10px]">
                  {rewards.filter(r => !r.is_claimed).length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="referrals" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All Referrals</CardTitle>
              </CardHeader>
              <CardContent>
                {referralsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Referrer</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Referred</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {referrals.map(referral => (
                        <TableRow key={referral.id} data-testid={`row-referral-${referral.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              {referral.referrer?.profiles?.full_name || referral.referrer?.member_code}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted px-2 py-1 rounded text-sm">{referral.referral_code}</code>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => copyCode(referral.referral_code)}
                                data-testid={`button-copy-code-${referral.id}`}
                              >
                                {copiedCode === referral.referral_code ? (
                                  <Check className="h-3 w-3 text-success" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            {referral.referred?.id ? (
                              <button
                                className="flex items-center gap-1 text-primary hover:underline text-sm font-medium"
                                onClick={() => navigate(`/members?search=${referral.referred!.member_code || ''}`)}
                                data-testid={`link-referred-member-${referral.id}`}
                              >
                                {referral.referred.profiles?.full_name || referral.referred.member_code}
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-sm">
                                {referral.referred_name || '—'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusClass(referral.status)}>
                              {referral.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(referral.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {(referral.status === 'new' || referral.status === 'pending') && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs"
                                onClick={() => openConvertDrawer(referral)}
                                data-testid={`button-convert-referral-${referral.id}`}
                              >
                                <ArrowRightLeft className="h-3 w-3" />
                                Convert
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {referrals.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            <Gift className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            No referrals yet
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rewards" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Reward History</CardTitle>
              </CardHeader>
              <CardContent>
                {rewardsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Referral Code</TableHead>
                        <TableHead>Reward Type</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rewards.map(reward => (
                        <TableRow key={reward.id} data-testid={`row-reward-${reward.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                              {reward.members?.profiles?.full_name || reward.members?.member_code || '—'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <code className="bg-muted px-2 py-1 rounded text-xs">
                              {reward.referrals?.referral_code || '—'}
                            </code>
                          </TableCell>
                          <TableCell className="capitalize">
                            {(reward.reward_type || '').replace('_', ' ')}
                          </TableCell>
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-1">
                              <IndianRupee className="h-3 w-3" />
                              {reward.reward_value || 0}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge className={reward.is_claimed ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
                              {reward.is_claimed ? 'Claimed' : 'Pending'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {!reward.is_claimed ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => claimMutation.mutate({ rewardId: reward.id, memberId: reward.member_id })}
                                disabled={claimMutation.isPending}
                                data-testid={`button-claim-reward-${reward.id}`}
                              >
                                Claim & Credit Wallet
                              </Button>
                            ) : reward.claimed_at ? (
                              <span className="text-xs text-muted-foreground">
                                {new Date(reward.claimed_at).toLocaleDateString()}
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                      {rewards.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            <Gift className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            No rewards yet. Convert a referral to issue rewards.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Referral Drawer */}
      <Sheet open={createReferralOpen} onOpenChange={setCreateReferralOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Create Referral</SheetTitle>
            <SheetDescription>Manually log a referral from a walk-in or phone inquiry</SheetDescription>
          </SheetHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); createReferralMutation.mutate(); }}
            className="space-y-4 py-4"
          >
            <div className="space-y-2">
              <Label>Referrer Member *</Label>
              <Select
                value={newReferral.referrerMemberId}
                onValueChange={(v) => setNewReferral({ ...newReferral, referrerMemberId: v })}
              >
                <SelectTrigger data-testid="select-referrer-member">
                  <SelectValue placeholder="Select member who referred" />
                </SelectTrigger>
                <SelectContent>
                  {members.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.profiles?.full_name || m.member_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Referred Person Name</Label>
              <Input
                value={newReferral.referredName}
                onChange={(e) => setNewReferral({ ...newReferral, referredName: e.target.value })}
                placeholder="Name of the referred person"
                data-testid="input-referred-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={newReferral.referredPhone}
                onChange={(e) => setNewReferral({ ...newReferral, referredPhone: e.target.value })}
                placeholder="Phone number"
                data-testid="input-referred-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newReferral.referredEmail}
                onChange={(e) => setNewReferral({ ...newReferral, referredEmail: e.target.value })}
                placeholder="Email address"
                data-testid="input-referred-email"
              />
            </div>
            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setCreateReferralOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createReferralMutation.isPending || !newReferral.referrerMemberId}
                data-testid="button-submit-create-referral"
              >
                {createReferralMutation.isPending ? 'Creating...' : 'Create Referral'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Convert Referral Drawer */}
      <Sheet
        open={convertOpen}
        onOpenChange={(open) => {
          setConvertOpen(open);
          if (!open) { setConvertingReferral(null); setConvertMemberId(''); }
        }}
      >
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Convert Referral
            </SheetTitle>
            <SheetDescription>
              Mark this referral as converted by linking it to the member who joined.
              Rewards will be issued automatically based on your branch referral settings.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 py-4">
            {/* Referral summary */}
            {convertingReferral && (
              <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
                <p className="font-medium text-foreground">Referral Details</p>
                <div className="grid grid-cols-2 gap-y-1 text-muted-foreground">
                  <span>Referred by:</span>
                  <span className="text-foreground font-medium">
                    {convertingReferral.referrer?.profiles?.full_name || convertingReferral.referrer?.member_code || '—'}
                  </span>
                  <span>Referred name:</span>
                  <span className="text-foreground">{convertingReferral.referred_name || '—'}</span>
                  <span>Phone:</span>
                  <span className="text-foreground">{convertingReferral.referred_phone || '—'}</span>
                  <span>Code:</span>
                  <code className="text-foreground bg-muted px-1 rounded">{convertingReferral.referral_code}</code>
                </div>
              </div>
            )}

            {/* Member select */}
            <div className="space-y-2">
              <Label>Member Who Joined *</Label>
              <Select value={convertMemberId} onValueChange={setConvertMemberId}>
                <SelectTrigger data-testid="select-convert-member">
                  <SelectValue placeholder="Select the joined member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.profiles?.full_name || m.member_code} — {m.member_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select the existing member record for the person who joined via this referral.
              </p>
            </div>

            {/* Reward preview */}
            {convertSettingsLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
              </div>
            ) : convertSettings ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Gift className="h-4 w-4 text-primary" />
                  Rewards that will be issued
                </p>
                {convertSettings.reward_mode === 'percentage' && !convertMemberId && (
                  <p className="text-xs text-muted-foreground italic">
                    Select the joined member above to preview exact amounts (percentage mode).
                  </p>
                )}
                <div className="space-y-2 text-sm">
                  {(convertSettings.referrer_reward_value || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Referrer ({convertingReferral?.referrer?.profiles?.full_name || 'referrer'})
                      </span>
                      <span className="font-semibold text-primary">
                        {convertMemberId && previewReferrerAmount !== null
                          ? `₹${previewReferrerAmount}`
                          : convertSettings.reward_mode === 'percentage'
                            ? `${convertSettings.referrer_reward_value}% of membership`
                            : `₹${convertSettings.referrer_reward_value}`}
                      </span>
                    </div>
                  )}
                  {(convertSettings.referred_reward_value || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">New member (joined)</span>
                      <span className="font-semibold text-primary">
                        {convertMemberId && previewReferredAmount !== null
                          ? `₹${previewReferredAmount}`
                          : convertSettings.reward_mode === 'percentage'
                            ? `${convertSettings.referred_reward_value}% of membership`
                            : `₹${convertSettings.referred_reward_value}`}
                      </span>
                    </div>
                  )}
                  {(convertSettings.referrer_reward_value || 0) === 0 && (convertSettings.referred_reward_value || 0) === 0 && (
                    <p className="text-muted-foreground text-xs">
                      Both reward values are 0 — no rewards will be created.
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Reward type:{' '}
                  <span className="capitalize">
                    {(convertSettings.referrer_reward_type || 'wallet_credit').replace('_', ' ')}
                  </span>. Rewards are unclaimed until admin clicks "Claim & Credit Wallet" in the Rewards tab.
                </p>
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No active referral settings found for this branch. The referral will be marked as converted
                  but no rewards will be issued. Configure settings in Settings → Referral Program first.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending || !convertMemberId || convertSettingsLoading}
              data-testid="button-confirm-convert"
            >
              {convertMutation.isPending ? 'Converting...' : 'Confirm Conversion'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
