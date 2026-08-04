import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatCard } from '@/components/ui/stat-card';
import { Search, Users, Activity, Clock, BarChart3, Gift, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBenefitBalances, useBenefitUsageHistory } from '@/hooks/useBenefits';
import { BenefitBalancesGrid } from '@/components/benefits/BenefitBalanceCard';
import { RecordBenefitUsageDrawer } from '@/components/benefits/RecordBenefitUsageDrawer';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';
import { CompGiftDrawer } from '@/components/members/CompGiftDrawer';
import { CompAmendActions } from '@/components/members/CompAmendActions';


import { benefitTypeLabels, frequencyLabels } from '@/services/benefitService';
import { format } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';

type BenefitType = Database['public']['Enums']['benefit_type'];

interface MemberSearchResult {
  id: string;
  member_code: string;
  branch_name?: string | null;
  branch_code?: string | null;
  profiles: {
    full_name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

function initials(name?: string | null) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}


export default function BenefitTracking() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOnOpen, setAddOnOpen] = useState(false);
  const [preselectedBenefit, setPreselectedBenefit] = useState<BenefitType | undefined>();
  const [giftOpen, setGiftOpen] = useState(false);


  const { data: selectedMemberMeta } = useQuery({
    queryKey: ['benefit-tracking-member-meta', selectedMember?.id],
    enabled: !!selectedMember?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, branch_id')
        .eq('id', selectedMember!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Search members using the search_members function
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['member-search', searchQuery],
    queryFn: async () => {
      if (searchQuery.length < 2) return [];
      
      // Use the search_members function for comprehensive search
      const { data, error } = await supabase
        .rpc('search_members', {
          search_term: searchQuery.trim(),
          p_branch_id: null,
          p_limit: 10
        });

      if (error) {
        console.error('Search error:', error);
        return [];
      }

      // Transform the result to match expected format
      return (data || [])
        .filter((row: any) => row.member_status === 'active') // Only active members (using new RPC field)
        .map((row: any) => ({
          id: row.id,
          member_code: row.member_code,
          branch_name: row.branch_name ?? null,
          branch_code: row.branch_code ?? null,
          profiles: {
            full_name: row.full_name,
            email: row.email,
            phone: row.phone
          }
        }));
    },
    enabled: searchQuery.length >= 2,
  });

  // Get benefit data for selected member
  const { membership, balances, isLoading: isLoadingBenefits } = useBenefitBalances(selectedMember?.id || '');
  
  // Get usage history
  const { data: usageHistory } = useBenefitUsageHistory(membership?.id || '');

  const queryClient = useQueryClient();

  // Fetch comps (gifts) granted to the member
  const { data: comps = [] } = useQuery({
    queryKey: ['member-comps-tracking', selectedMember?.id],
    enabled: !!selectedMember?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_comps')
        .select('id, comp_sessions, used_sessions, reason, created_at, benefit_type_id, benefit_types(name, code)')
        .eq('member_id', selectedMember!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Realtime: keep balances, history, and comps in sync as they change
  useEffect(() => {
    if (!selectedMember?.id) return;
    const channel = supabase
      .channel(`benefit-tracking-${selectedMember.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_comps', filter: `member_id=eq.${selectedMember.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['member-comps-tracking', selectedMember.id] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'benefit_usage' }, () => {
        if (membership?.id) {
          queryClient.invalidateQueries({ queryKey: ['benefit-usage', membership.id] });
          queryClient.invalidateQueries({ queryKey: ['benefit-usage-history', membership.id] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedMember?.id, membership?.id, queryClient]);

  const activeComps = comps.filter((c: any) => c.used_sessions < c.comp_sessions);
  const totalGiftSessions = activeComps.reduce((sum: number, c: any) => sum + (c.comp_sessions - c.used_sessions), 0);

  // Aggregate comps by benefit_type_id for merging into balances
  const compMap: Record<string, { total: number; used: number; remaining: number; name?: string }> = {};
  comps.forEach((c: any) => {
    if (!c.benefit_type_id) return;
    const m = compMap[c.benefit_type_id] || { total: 0, used: 0, remaining: 0, name: c.benefit_types?.name };
    m.total += c.comp_sessions || 0;
    m.used += c.used_sessions || 0;
    m.remaining += Math.max(0, (c.comp_sessions || 0) - (c.used_sessions || 0));
    m.name = m.name || c.benefit_types?.name;
    compMap[c.benefit_type_id] = m;
  });

  // Merge plan balances + comps; append gift-only entries
  const mergedBalanceIds = new Set<string>();
  const combinedBalances = balances.map((b) => {
    if (b.benefit_type_id && compMap[b.benefit_type_id]) {
      mergedBalanceIds.add(b.benefit_type_id);
      const c = compMap[b.benefit_type_id];
      return { ...b, compTotal: c.total, compUsed: c.used, compRemaining: c.remaining };
    }
    return b;
  });
  Object.entries(compMap).forEach(([btId, c]) => {
    if (mergedBalanceIds.has(btId)) return;
    combinedBalances.push({
      benefit_type: 'other' as any,
      benefit_type_id: btId,
      label: c.name || 'Gift Benefit',
      frequency: 'per_membership' as any,
      limit_count: 0,
      description: 'Complimentary sessions',
      used: 0,
      remaining: 0,
      isUnlimited: false,
      compTotal: c.total,
      compUsed: c.used,
      compRemaining: c.remaining,
      isGiftOnly: true,
    });
  });

  // Stats — combine plan balance + active gift sessions
  const totalBenefits = combinedBalances.length;
  const exhaustedBenefits = combinedBalances.filter((b: any) => !b.isUnlimited && (b.remaining || 0) + (b.compRemaining || 0) === 0).length;
  const todayUsage = usageHistory?.filter(u => u.usage_date === new Date().toISOString().split('T')[0]).length || 0;

  const handleRecordUsage = (benefitType?: BenefitType, benefitTypeId?: string | null) => {
    // For custom types, use benefit_type_id as preselection; for standard enums, use the enum value
    setPreselectedBenefit((benefitTypeId || benefitType) as BenefitType | undefined);
    setDrawerOpen(true);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Benefit Tracking</h1>
          <p className="text-muted-foreground">
            Record and track member benefit usage (sauna, ice bath, etc.)
          </p>
        </div>

        {/* Search Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Find Member</CardTitle>
            <CardDescription>
              Search by name, email, phone, or member code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Search Results */}
            {searchQuery.length >= 2 && searchResults && searchResults.length > 0 && (
              <div className="mt-3 border rounded-md divide-y">
                {searchResults.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => {
                      setSelectedMember(member);
                      setSearchQuery('');
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-muted transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">
                        {member.profiles?.full_name || member.member_code}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {member.profiles?.email || member.profiles?.phone || member.member_code}
                      </div>
                    </div>
                    <Badge variant="outline">{member.member_code}</Badge>
                  </button>
                ))}
              </div>
            )}

            {searchQuery.length >= 2 && isSearching && (
              <div className="mt-3 text-center text-muted-foreground">Searching...</div>
            )}

            {searchQuery.length >= 2 && !isSearching && searchResults?.length === 0 && (
              <div className="mt-3 text-center text-muted-foreground">No members found</div>
            )}
          </CardContent>
        </Card>

        {/* Selected Member Section */}
        {selectedMember && (
          <>
            {/* Member Header */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">
                        {selectedMember.profiles?.full_name || selectedMember.member_code}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedMember.member_code} • {selectedMember.profiles?.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setAddOnOpen(true)} disabled={!selectedMemberMeta?.branch_id || !membership}>
                      Sell Add-On
                    </Button>
                    <Button onClick={() => handleRecordUsage()}>
                      Record Usage
                    </Button>
                  </div>
                </div>

                {membership && (
                  <div className="mt-4 p-3 bg-muted rounded-md">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Current Plan:</span>
                      <span className="font-medium">{membership.plan.name}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Valid Until:</span>
                      <span className="font-medium">{format(new Date(membership.end_date), 'dd MMM yyyy')}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Total Benefits"
                value={totalBenefits}
                icon={Activity}
              />
              <StatCard
                title="Exhausted"
                value={exhaustedBenefits}
                icon={BarChart3}
                className={exhaustedBenefits > 0 ? 'border-destructive/50' : ''}
              />
              <StatCard
                title="Used Today"
                value={todayUsage}
                icon={Clock}
              />
              <StatCard
                title="Gift Sessions"
                value={totalGiftSessions}
                icon={Gift}
                className={totalGiftSessions > 0 ? 'border-warning/50' : ''}
              />
            </div>

            {/* Tabs for Benefits & History */}
            <Tabs defaultValue="benefits" className="space-y-4">
              <TabsList>
                <TabsTrigger value="benefits">Benefit Balances</TabsTrigger>
                <TabsTrigger value="gifts" className="gap-1.5">
                  <Gift className="h-3.5 w-3.5" /> Gifts
                  {activeComps.length > 0 && (
                    <Badge className="ml-1 h-4 px-1.5 text-[10px] bg-warning/15 text-warning border-warning/30">
                      {activeComps.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="history">Usage History</TabsTrigger>
              </TabsList>

              <TabsContent value="benefits">
                {isLoadingBenefits ? (
                  <div className="text-center py-8 text-muted-foreground">Loading benefits...</div>
                ) : !membership ? (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      No active membership found
                    </CardContent>
                  </Card>
                ) : (
                  <BenefitBalancesGrid
                    balances={combinedBalances}
                    showRecordButtons
                    onRecordUsage={handleRecordUsage}
                  />
                )}
              </TabsContent>

              <TabsContent value="gifts">
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Gift className="h-5 w-5 text-warning" />
                        Gifts & Complimentary Sessions
                      </CardTitle>
                      <CardDescription>
                        Comp sessions granted to this member. These are consumed before plan benefits.
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      className="cursor-pointer shrink-0"
                      onClick={() => setGiftOpen(true)}
                      disabled={!selectedMemberMeta?.branch_id}
                    >
                      <Gift className="h-4 w-4 mr-2" /> Grant Gift
                    </Button>
                  </CardHeader>

                  <CardContent>
                    {comps.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No gifts granted yet
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Granted</TableHead>
                            <TableHead>Benefit</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Used</TableHead>
                            <TableHead>Remaining</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>

                        </TableHeader>
                        <TableBody>
                          {comps.map((c: any) => {
                            const remaining = c.comp_sessions - c.used_sessions;
                            const exhausted = remaining <= 0;
                            return (
                              <TableRow key={c.id} className={exhausted ? 'opacity-60' : ''}>
                                <TableCell>{format(new Date(c.created_at), 'dd MMM yyyy')}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="gap-1">
                                    <Sparkles className="h-3 w-3 text-warning" />
                                    {c.benefit_types?.name || 'Benefit'}
                                  </Badge>
                                </TableCell>
                                <TableCell>{c.comp_sessions}</TableCell>
                                <TableCell>{c.used_sessions}</TableCell>
                                <TableCell>
                                  {exhausted ? (
                                    <Badge variant="secondary" className="text-[10px]">Exhausted</Badge>
                                  ) : (
                                    <Badge className="bg-warning/10 text-warning border-warning/30">
                                      {remaining} left
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground max-w-[240px] truncate">
                                  {c.reason || '-'}
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end">
                                    <CompAmendActions comp={c} />
                                  </div>
                                </TableCell>
                              </TableRow>

                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Usage History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!usageHistory || usageHistory.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No usage recorded yet
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Benefit</TableHead>
                            <TableHead>Count</TableHead>
                            <TableHead>Recorded By</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usageHistory.map((usage) => (
                            <TableRow key={usage.id}>
                              <TableCell>
                                {format(new Date(usage.usage_date), 'dd MMM yyyy')}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {(usage as any).benefit_types?.name || benefitTypeLabels[usage.benefit_type] || usage.benefit_type}
                                </Badge>
                              </TableCell>
                              <TableCell>{usage.usage_count}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {usage.recorded_by_name || 'System'}
                              </TableCell>
                              <TableCell className="text-muted-foreground max-w-[200px] truncate">
                                {usage.notes || '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Record Usage Drawer */}
            {membership && (
              <RecordBenefitUsageDrawer
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                membershipId={membership.id}
                memberId={selectedMember.id}
                memberName={selectedMember.profiles?.full_name || selectedMember.member_code}
                availableBenefits={balances}
                preselectedBenefit={preselectedBenefit}
              />
            )}

            {selectedMemberMeta?.branch_id && membership && (
              <PurchaseAddOnDrawer
                open={addOnOpen}
                onOpenChange={setAddOnOpen}
                memberId={selectedMember.id}
                memberName={selectedMember.profiles?.full_name || selectedMember.member_code}
                membershipId={membership.id}
                branchId={selectedMemberMeta.branch_id}
                mode="staff"
              />
            )}

            {selectedMemberMeta?.branch_id && (
              <CompGiftDrawer
                open={giftOpen}
                onOpenChange={setGiftOpen}
                memberId={selectedMember.id}
                memberName={selectedMember.profiles?.full_name || selectedMember.member_code}
                membershipId={membership?.id}
                branchId={selectedMemberMeta.branch_id}
              />
            )}

          </>
        )}
      </div>
    </AppLayout>
  );
}
