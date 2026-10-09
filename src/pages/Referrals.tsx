import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowRightLeft, Check, Copy, Download, ExternalLink, Gift, Loader2, Plus, RefreshCw, Search, Settings2, Users, Wallet } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { claimReward } from '@/services/referralService';
import { exportToCSV } from '@/lib/csvExport';
import { CreateReferralDrawer, type NewReferralValues, type ReferralMemberOption } from '@/components/referrals/CreateReferralDrawer';
import { ReferralOverview, type ReferralWorkspaceSummary } from '@/components/referrals/ReferralOverview';
import { ReferralStatusBadge, RewardStatusBadge } from '@/components/referrals/ReferralStatusBadge';
import { referralMatches, rewardMatches, type ReferralStatusFilter, type RewardStatusFilter } from '@/components/referrals/referralWorkspaceUtils';

interface MemberProfile { full_name: string | null }
interface ReferralMember extends ReferralMemberOption { user_id: string | null }
interface Referral {
  id: string; referral_code: string; referrer_member_id: string; referred_member_id: string | null;
  referred_name: string | null; referred_phone: string | null; referred_email: string | null;
  status: 'new' | 'pending' | 'converted' | 'expired'; lifecycle_status: string | null;
  created_at: string; converted_at: string | null;
  referrer: ReferralMember | null;
  referred: { id: string; member_code: string; profiles: MemberProfile | null } | null;
}
interface Reward {
  id: string; referral_id: string | null; member_id: string; reward_type: string; reward_value: number;
  description: string | null; is_claimed: boolean; claimed_at: string | null; created_at: string;
  claim_status: string | null; claim_requested_at: string | null; claim_review_note: string | null;
  members: { id: string; member_code: string; profiles: MemberProfile | null } | null;
  referrals: { referral_code: string } | null;
}
interface ReferralSettings {
  id: string; is_active: boolean; reward_mode: 'fixed' | 'percentage'; referrer_reward_value: number;
  referred_reward_value: number; min_membership_value: number; referrer_reward_type: string; referred_reward_type: string;
}

const PAGE_SIZE = 8;
const referralFilters: Array<{ value: ReferralStatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'new', label: 'New' }, { value: 'pending', label: 'Pending' },
  { value: 'converted', label: 'Converted' }, { value: 'expired', label: 'Expired' },
];
const rewardFilters: Array<{ value: RewardStatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'available', label: 'Ready to claim' },
  { value: 'pending_approval', label: 'Awaiting approval' }, { value: 'credited', label: 'Credited' }, { value: 'rejected', label: 'Rejected' },
];

function computeRewardValue(mode: 'fixed' | 'percentage', settingValue: number, membershipValue: number) {
  return mode === 'percentage' ? Math.round((membershipValue * settingValue) / 100) : settingValue;
}

function QueryState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center"><AlertCircle className="h-9 w-9 text-destructive" /><div><p className="font-semibold">{message}</p><p className="text-sm text-muted-foreground">No records were changed.</p></div><Button variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></div>;
}

function EmptyState({ title, description, onCreate, canCreate }: { title: string; description: string; onCreate?: () => void; canCreate?: boolean }) {
  return <div className="flex min-h-56 flex-col items-center justify-center p-6 text-center"><span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Gift className="h-6 w-6" /></span><p className="font-semibold">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{canCreate && onCreate && <Button className="mt-4" onClick={onCreate}><Plus className="mr-2 h-4 w-4" />Create referral</Button>}</div>;
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  return <div className="flex items-center justify-between border-t border-border px-4 py-3"><p className="text-xs text-muted-foreground">Page {page} of {pages}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</Button></div></div>;
}

export default function ReferralsPage() {
  const { user } = useAuth();
  const { selectedBranch, branchFilter, effectiveBranchId, currentBranchName } = useBranchContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertingReferral, setConvertingReferral] = useState<Referral | null>(null);
  const [convertMemberId, setConvertMemberId] = useState('');
  const [referralSearch, setReferralSearch] = useState('');
  const [referralStatus, setReferralStatus] = useState<ReferralStatusFilter>('all');
  const [rewardSearch, setRewardSearch] = useState('');
  const [rewardStatus, setRewardStatus] = useState<RewardStatusFilter>('all');
  const [referralPage, setReferralPage] = useState(1);
  const [rewardPage, setRewardPage] = useState(1);

  const branchKey = selectedBranch === 'all' ? 'all' : effectiveBranchId;

  const membersQuery = useQuery({
    queryKey: ['referral-members', branchKey], enabled: !!user,
    queryFn: async (): Promise<ReferralMember[]> => {
      let query = supabase.from('members').select('id, member_code, user_id, branch_id').order('created_at', { ascending: false }).limit(500);
      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const userIds = rows.flatMap((member) => member.user_id ? [member.user_id] : []);
      const { data: profiles, error: profileError } = userIds.length ? await supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [], error: null };
      if (profileError) throw profileError;
      const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
      return rows.map((member) => ({ ...member, profiles: profileMap.get(member.user_id ?? '') ?? null }));
    },
  });

  const referralsQuery = useQuery({
    queryKey: ['all-referrals', branchKey], enabled: !!user,
    queryFn: async (): Promise<Referral[]> => {
      let query = supabase.from('referrals').select(`*, referrer:referrer_member_id!inner(id, member_code, user_id, branch_id, profiles:user_id(full_name)), referred:referred_member_id(id, member_code, profiles:user_id(full_name))`).order('created_at', { ascending: false });
      if (branchFilter) query = query.eq('referrer.branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Referral[];
    },
  });

  const rewardsQuery = useQuery({
    queryKey: ['all-rewards', branchKey], enabled: !!user,
    queryFn: async (): Promise<Reward[]> => {
      let query = supabase.from('referral_rewards').select(`*, members(id, member_code, profiles:user_id(full_name)), referrals!inner(referral_code, referrer:referrer_member_id!inner(branch_id))`).order('created_at', { ascending: false });
      if (branchFilter) query = query.eq('referrals.referrer.branch_id', branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, referrals: row.referrals ? { referral_code: row.referrals.referral_code } : null })) as unknown as Reward[];
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['referral-workspace-settings', effectiveBranchId], enabled: !!effectiveBranchId,
    queryFn: async (): Promise<ReferralSettings | null> => {
      const { data, error } = await supabase.from('referral_settings').select('*').or(`branch_id.eq.${effectiveBranchId},branch_id.is.null`).order('branch_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as ReferralSettings | null;
    },
  });

  const summaryQuery = useQuery({
    queryKey: ['referral-workspace-summary', branchKey], enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('referral_workspace_summary', { p_branch_id: branchFilter ?? null });
      if (error) throw error;
      return data as unknown as ReferralWorkspaceSummary;
    },
  });

  const convertMemberMembershipQuery = useQuery({
    queryKey: ['convert-member-membership', convertMemberId], enabled: convertOpen && !!convertMemberId,
    queryFn: async () => {
      const { data, error } = await supabase.from('memberships').select('price_paid').eq('member_id', convertMemberId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as { price_paid: number } | null;
    },
  });

  const invalidateAll = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['all-referrals'] }), queryClient.invalidateQueries({ queryKey: ['all-rewards'] }),
    queryClient.invalidateQueries({ queryKey: ['referral-workspace-summary'] }), queryClient.invalidateQueries({ queryKey: ['my-referrals'] }),
    queryClient.invalidateQueries({ queryKey: ['my-referral-rewards'] }),
  ]);

  const createMutation = useMutation({
    mutationFn: async (values: NewReferralValues) => {
      const member = membersQuery.data?.find((row) => row.id === values.referrerMemberId);
      if (!member) throw new Error('Select a referrer member');
      if (!settingsQuery.data?.is_active) throw new Error('Referral program is currently off');
      const { error } = await supabase.from('referrals').insert({
        referrer_member_id: member.id, referral_code: `REF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        referred_name: values.referredName.trim(), referred_phone: `+91${values.referredPhone}`,
        referred_email: values.referredEmail.trim() || null, status: 'new', lifecycle_status: 'invited',
      });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success('Referral created'); await invalidateAll(); setCreateOpen(false); },
    onError: (error: Error) => toast.error(error.message),
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!convertingReferral || !convertMemberId || !settingsQuery.data?.is_active) throw new Error('Referral conversion is unavailable');
      const settings = settingsQuery.data;
      const membershipValue = convertMemberMembershipQuery.data?.price_paid ?? 0;
      const { data, error } = await supabase.rpc('convert_referral', {
        p_referral_id: convertingReferral.id, p_referred_member_id: convertMemberId,
        p_referrer_reward_type: settings.referrer_reward_type,
        p_referrer_reward_value: computeRewardValue(settings.reward_mode, settings.referrer_reward_value, membershipValue),
        p_referred_reward_type: settings.referred_reward_type,
        p_referred_reward_value: computeRewardValue(settings.reward_mode, settings.referred_reward_value, membershipValue),
        p_idempotency_key: `convert-${convertingReferral.id}-${convertMemberId}`,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Failed to convert referral');
    },
    onSuccess: async () => { toast.success('Referral converted and rewards issued'); await invalidateAll(); setConvertOpen(false); setConvertingReferral(null); setConvertMemberId(''); },
    onError: (error: Error) => toast.error(error.message),
  });

  const claimMutation = useMutation({
    mutationFn: ({ rewardId, memberId }: { rewardId: string; memberId: string }) => claimReward(rewardId, memberId),
    onSuccess: async () => { toast.success('Sent to branch manager for approval'); await invalidateAll(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const referrals = referralsQuery.data ?? [];
  const rewards = rewardsQuery.data ?? [];
  const filteredReferrals = useMemo(() => referrals.filter((row) => referralMatches(row, referralSearch, referralStatus)), [referrals, referralSearch, referralStatus]);
  const filteredRewards = useMemo(() => rewards.filter((row) => rewardMatches(row, rewardSearch, rewardStatus)), [rewards, rewardSearch, rewardStatus]);
  const pagedReferrals = filteredReferrals.slice((referralPage - 1) * PAGE_SIZE, referralPage * PAGE_SIZE);
  const pagedRewards = filteredRewards.slice((rewardPage - 1) * PAGE_SIZE, rewardPage * PAGE_SIZE);
  const programActive = settingsQuery.data?.is_active === true;

  const copyCode = async (code: string) => { await navigator.clipboard.writeText(code); setCopiedCode(code); toast.success('Referral code copied'); window.setTimeout(() => setCopiedCode(null), 1800); };
  const openConvert = (referral: Referral) => { setConvertingReferral(referral); setConvertMemberId(''); setConvertOpen(true); };

  return <AppLayout><div className="space-y-5 pb-safe">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">Referrals & rewards</h1><Badge variant="outline">{currentBranchName || 'Branch'}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Track introductions, conversions, approvals, and wallet credits.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => exportToCSV(filteredReferrals.map((row) => ({ Code: row.referral_code, Referrer: row.referrer?.profiles?.full_name || row.referrer?.member_code || '', Referred: row.referred_name || '', Phone: row.referred_phone || '', Email: row.referred_email || '', Status: row.status })), 'referrals')} disabled={!filteredReferrals.length}><Download className="mr-2 h-4 w-4" />Export</Button><Button onClick={() => setCreateOpen(true)} disabled={!programActive || settingsQuery.isLoading}><Plus className="mr-2 h-4 w-4" />Create referral</Button></div></div>

    {!settingsQuery.isLoading && !programActive && <Alert className="rounded-xl border-warning/20 bg-warning/5"><AlertCircle className="h-4 w-4 text-warning" /><AlertDescription className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><span><strong>Referral program is off.</strong> Existing records remain available, but new referrals, conversions, and claims stay paused.</span><Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=referrals')}><Settings2 className="mr-2 h-4 w-4" />Referral settings</Button></AlertDescription></Alert>}

    <ReferralOverview summary={summaryQuery.data} isLoading={summaryQuery.isLoading} isError={summaryQuery.isError} onRetry={() => summaryQuery.refetch()} />

    <Tabs defaultValue="referrals" className="space-y-4"><TabsList className="h-11 rounded-xl bg-muted/70 p-1"><TabsTrigger value="referrals" className="min-h-9 rounded-lg">Referrals <Badge variant="secondary" className="ml-2">{referrals.length}</Badge></TabsTrigger><TabsTrigger value="rewards" className="min-h-9 rounded-lg">Rewards & approvals {summaryQuery.data?.awaiting_approval ? <Badge className="ml-2 bg-warning/10 text-warning">{summaryQuery.data.awaiting_approval}</Badge> : null}</TabsTrigger></TabsList>
      <TabsContent value="referrals"><Card className="overflow-hidden rounded-2xl border-0 shadow-lg shadow-primary/5"><CardHeader className="border-b border-border"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Referral records</CardTitle><p className="mt-1 text-xs text-muted-foreground">Showing {filteredReferrals.length} of {referrals.length} results</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search referrals" value={referralSearch} onChange={(event) => { setReferralSearch(event.target.value); setReferralPage(1); }} className="min-h-10 pl-9 sm:w-64" placeholder="Search name, phone or code" /></div></div></div><div className="flex gap-2 overflow-x-auto pb-1">{referralFilters.map((filter) => <Button key={filter.value} size="sm" variant={referralStatus === filter.value ? 'default' : 'outline'} className="shrink-0" onClick={() => { setReferralStatus(filter.value); setReferralPage(1); }}>{filter.label}</Button>)}</div></CardHeader><CardContent className="p-0">
        {referralsQuery.isLoading ? <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-xl" />)}</div> : referralsQuery.isError ? <QueryState message="Could not load referrals" onRetry={() => referralsQuery.refetch()} /> : !filteredReferrals.length ? <EmptyState title={referrals.length ? 'No matching referrals' : 'No referrals yet'} description={referrals.length ? 'Try a different search or status.' : programActive ? 'Create the first verified referral for this branch.' : 'Records will appear here when the referral program is enabled and used.'} onCreate={() => setCreateOpen(true)} canCreate={programActive && !referrals.length} /> : <><div className="hidden max-h-[520px] overflow-auto md:block"><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Referrer</TableHead><TableHead>Code</TableHead><TableHead>Referred</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{pagedReferrals.map((row) => <TableRow key={row.id} className="hover:bg-muted/50"><TableCell><p className="font-medium">{row.referrer?.profiles?.full_name || 'Member'}</p><p className="text-xs text-muted-foreground">{row.referrer?.member_code}</p></TableCell><TableCell><div className="flex items-center gap-1"><code className="rounded bg-muted px-2 py-1 text-xs">{row.referral_code}</code><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Copy ${row.referral_code}`} onClick={() => copyCode(row.referral_code)}>{copiedCode === row.referral_code ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}</Button></div></TableCell><TableCell>{row.referred?.id ? <Button variant="link" className="h-auto p-0" onClick={() => navigate(`/members?search=${encodeURIComponent(row.referred?.member_code || '')}`)}>{row.referred.profiles?.full_name || row.referred.member_code}<ExternalLink className="ml-1 h-3 w-3" /></Button> : <div><p>{row.referred_name || '—'}</p><p className="text-xs text-muted-foreground">{row.referred_phone || row.referred_email || 'No contact'}</p></div>}</TableCell><TableCell><ReferralStatusBadge status={row.status} /></TableCell><TableCell className="text-muted-foreground">{new Date(row.created_at).toLocaleDateString('en-IN')}</TableCell><TableCell className="text-right">{(row.status === 'new' || row.status === 'pending') && <Button size="sm" variant="outline" disabled={!programActive} onClick={() => openConvert(row)}><ArrowRightLeft className="mr-2 h-3.5 w-3.5" />Convert</Button>}</TableCell></TableRow>)}</TableBody></Table></div><div className="space-y-3 p-4 md:hidden">{pagedReferrals.map((row) => <article key={row.id} className="rounded-xl bg-muted/40 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{row.referred?.profiles?.full_name || row.referred_name || 'Referred person'}</p><p className="text-xs text-muted-foreground">from {row.referrer?.profiles?.full_name || row.referrer?.member_code}</p></div><ReferralStatusBadge status={row.status} /></div><div className="mt-4 flex items-center justify-between"><code className="rounded bg-background px-2 py-1 text-xs">{row.referral_code}</code>{(row.status === 'new' || row.status === 'pending') && <Button size="sm" variant="outline" disabled={!programActive} onClick={() => openConvert(row)}>Convert</Button>}</div></article>)}</div><Pager page={referralPage} total={filteredReferrals.length} onChange={setReferralPage} /></>}
      </CardContent></Card></TabsContent>

      <TabsContent value="rewards"><Card className="overflow-hidden rounded-2xl border-0 shadow-lg shadow-primary/5"><CardHeader className="border-b border-border"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Rewards & approvals</CardTitle><p className="mt-1 text-xs text-muted-foreground">Showing {filteredRewards.length} of {rewards.length} results</p></div><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search rewards" value={rewardSearch} onChange={(event) => { setRewardSearch(event.target.value); setRewardPage(1); }} className="min-h-10 pl-9 sm:w-64" placeholder="Search member or code" /></div></div><div className="flex gap-2 overflow-x-auto pb-1">{rewardFilters.map((filter) => <Button key={filter.value} size="sm" variant={rewardStatus === filter.value ? 'default' : 'outline'} className="shrink-0" onClick={() => { setRewardStatus(filter.value); setRewardPage(1); }}>{filter.label}</Button>)}</div></CardHeader><CardContent className="p-0">
        {rewardsQuery.isLoading ? <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-xl" />)}</div> : rewardsQuery.isError ? <QueryState message="Could not load rewards" onRetry={() => rewardsQuery.refetch()} /> : !filteredRewards.length ? <EmptyState title={rewards.length ? 'No matching rewards' : 'No rewards yet'} description="Rewards appear after a referral is verified and converted." /> : <><div className="hidden max-h-[520px] overflow-auto md:block"><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Member</TableHead><TableHead>Referral</TableHead><TableHead>Reward</TableHead><TableHead>Status</TableHead><TableHead>Requested</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{pagedRewards.map((row) => <TableRow key={row.id} className="hover:bg-muted/50"><TableCell><p className="font-medium">{row.members?.profiles?.full_name || 'Member'}</p><p className="text-xs text-muted-foreground">{row.members?.member_code}</p></TableCell><TableCell><code className="rounded bg-muted px-2 py-1 text-xs">{row.referrals?.referral_code || '—'}</code></TableCell><TableCell><p className="font-semibold">₹{Number(row.reward_value || 0).toLocaleString()}</p><p className="text-xs capitalize text-muted-foreground">{row.reward_type.replaceAll('_', ' ')}</p></TableCell><TableCell><RewardStatusBadge reward={row} />{row.claim_review_note && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{row.claim_review_note}</p>}</TableCell><TableCell className="text-muted-foreground">{row.claim_requested_at ? new Date(row.claim_requested_at).toLocaleDateString('en-IN') : '—'}</TableCell><TableCell className="text-right">{!row.is_claimed && row.claim_status !== 'pending_approval' && <Button size="sm" variant="outline" disabled={!programActive || claimMutation.isPending} onClick={() => claimMutation.mutate({ rewardId: row.id, memberId: row.member_id })}>Request approval</Button>}</TableCell></TableRow>)}</TableBody></Table></div><div className="space-y-3 p-4 md:hidden">{pagedRewards.map((row) => <article key={row.id} className="rounded-xl bg-muted/40 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{row.members?.profiles?.full_name || row.members?.member_code}</p><p className="mt-1 text-xl font-bold">₹{Number(row.reward_value || 0).toLocaleString()}</p></div><RewardStatusBadge reward={row} /></div>{!row.is_claimed && row.claim_status !== 'pending_approval' && <Button className="mt-4 w-full" variant="outline" disabled={!programActive || claimMutation.isPending} onClick={() => claimMutation.mutate({ rewardId: row.id, memberId: row.member_id })}>Request approval</Button>}</article>)}</div><Pager page={rewardPage} total={filteredRewards.length} onChange={setRewardPage} /></>}
      </CardContent></Card></TabsContent>
    </Tabs>
  </div>

  <CreateReferralDrawer open={createOpen} onOpenChange={setCreateOpen} members={membersQuery.data ?? []} branchName={currentBranchName} isPending={createMutation.isPending} onSubmit={(values) => createMutation.mutate(values)} />

  <Sheet open={convertOpen} onOpenChange={(open) => { setConvertOpen(open); if (!open) { setConvertingReferral(null); setConvertMemberId(''); } }}><SheetContent className="flex h-[100dvh] w-full flex-col overflow-hidden p-0 sm:max-w-lg"><SheetHeader className="border-b border-border px-6 py-5 pr-14"><SheetTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-primary" />Convert referral</SheetTitle><SheetDescription>Link this introduction to the member who joined. Rewards still require a claim and branch-manager approval.</SheetDescription></SheetHeader><div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">{convertingReferral && <div className="rounded-xl bg-muted/50 p-4"><p className="font-semibold">{convertingReferral.referred_name || 'Referred person'}</p><p className="mt-1 text-sm text-muted-foreground">Referred by {convertingReferral.referrer?.profiles?.full_name || convertingReferral.referrer?.member_code}</p><code className="mt-3 inline-block rounded bg-background px-2 py-1 text-xs">{convertingReferral.referral_code}</code></div>}<div className="space-y-2"><label className="text-sm font-medium" htmlFor="joined-member">Member who joined</label><Select value={convertMemberId} onValueChange={setConvertMemberId}><SelectTrigger id="joined-member" className="min-h-11"><SelectValue placeholder="Select existing member" /></SelectTrigger><SelectContent>{(membersQuery.data ?? []).map((member) => <SelectItem key={member.id} value={member.id}>{member.profiles?.full_name || 'Member'} · {member.member_code}</SelectItem>)}</SelectContent></Select></div>{settingsQuery.data && <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="font-medium">Reward preview</p><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Referrer</span><strong>{settingsQuery.data.reward_mode === 'percentage' && !convertMemberId ? `${settingsQuery.data.referrer_reward_value}%` : `₹${computeRewardValue(settingsQuery.data.reward_mode, settingsQuery.data.referrer_reward_value, convertMemberMembershipQuery.data?.price_paid ?? 0).toLocaleString()}`}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">New member</span><strong>{settingsQuery.data.reward_mode === 'percentage' && !convertMemberId ? `${settingsQuery.data.referred_reward_value}%` : `₹${computeRewardValue(settingsQuery.data.reward_mode, settingsQuery.data.referred_reward_value, convertMemberMembershipQuery.data?.price_paid ?? 0).toLocaleString()}`}</strong></div></div></div>}</div><SheetFooter className="border-t border-border px-6 py-4"><Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button><Button onClick={() => convertMutation.mutate()} disabled={!convertMemberId || convertMutation.isPending || convertMemberMembershipQuery.isLoading}>{convertMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{convertMutation.isPending ? 'Converting…' : 'Confirm conversion'}</Button></SheetFooter></SheetContent></Sheet>
  </AppLayout>;
}
