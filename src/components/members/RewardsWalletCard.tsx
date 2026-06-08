import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Award, ArrowUp, ArrowDown, Gift, Wallet, History, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchWallet } from '@/services/walletService';
import { format } from 'date-fns';
import { RedeemPointsDrawer } from './RedeemPointsDrawer';
import { CreditMemberDrawer } from './CreditMemberDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';

interface RewardsWalletCardProps {
  memberId: string;
  memberName: string;
  branchId: string;
  rewardPoints: number;
}

export function RewardsWalletCard({ memberId, memberName, branchId, rewardPoints }: RewardsWalletCardProps) {
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('points');
  const { roles } = useAuth();
  const canCredit = can.creditMember(roles.map((r) => r.role));

  const { data: walletData } = useQuery({
    queryKey: ['member-wallet', memberId],
    queryFn: () => fetchWallet(memberId),
    enabled: !!memberId,
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ['rewards-ledger', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rewards_ledger' as any)
        .select('*')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!memberId,
  });

  const { data: walletTxns = [] } = useQuery({
    queryKey: ['wallet-transactions', memberId],
    queryFn: async () => {
      if (!walletData?.id) return [];
      const { data, error } = await supabase
        .from('wallet_transactions' as any)
        .select('*')
        .eq('wallet_id', walletData.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!memberId && !!walletData?.id,
  });

  return (
    <>
      {/* Unified Balance Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Award className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Reward Points</p>
                <p className="text-2xl font-bold text-primary">{rewardPoints || 0}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-3 text-xs"
              onClick={() => setRedeemOpen(true)}
              disabled={(rewardPoints || 0) <= 0}
            >
              <Gift className="h-3.5 w-3.5 mr-1.5" />
              Redeem
            </Button>
          </CardContent>
        </Card>

        <Card className="border-success/30 bg-gradient-to-br from-success/5 to-success/10">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-success/10">
                <Wallet className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Wallet Balance</p>
                <p className="text-2xl font-bold text-success">₹{(Number(walletData?.balance) || 0).toLocaleString()}</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              Credited: ₹{(Number(walletData?.total_credited) || 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {canCredit && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setCreditOpen(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Credit Member (Wallet / Points)
        </Button>
      )}

      {/* Combined Transaction History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full mb-3">
              <TabsTrigger value="points" className="flex-1 gap-1 text-xs">
                <Award className="h-3.5 w-3.5" />
                Points ({ledger.length})
              </TabsTrigger>
              <TabsTrigger value="wallet" className="flex-1 gap-1 text-xs">
                <Wallet className="h-3.5 w-3.5" />
                Wallet ({walletTxns.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="points">
              {ledger.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {ledger.map((entry: any) => (
                    <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-full ${entry.points > 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                          {entry.points > 0 ? (
                            <ArrowUp className="h-3 w-3 text-success" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-destructive" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{entry.reason}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(entry.created_at), 'dd MMM yyyy, hh:mm a')}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className={entry.points > 0 ? 'text-success border-success/20' : 'text-destructive border-destructive/20'}>
                        {entry.points > 0 ? '+' : ''}{entry.points}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Award className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No points history</p>
                  <p className="text-xs mt-1">Points will appear here when earned</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="wallet">
              {walletTxns.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {walletTxns.map((txn: any) => (
                    <div key={txn.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-full ${txn.amount > 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                          {txn.amount > 0 ? (
                            <ArrowUp className="h-3 w-3 text-success" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-destructive" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{txn.description || txn.type || 'Transaction'}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(txn.created_at), 'dd MMM yyyy, hh:mm a')}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className={txn.amount > 0 ? 'text-success border-success/20' : 'text-destructive border-destructive/20'}>
                        {txn.amount > 0 ? '+' : ''}₹{Math.abs(txn.amount).toLocaleString()}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Wallet className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No wallet transactions</p>
                  <p className="text-xs mt-1">Transactions will appear here</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <RedeemPointsDrawer
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        memberId={memberId}
        memberName={memberName}
        branchId={branchId}
        currentPoints={rewardPoints || 0}
      />

      <CreditMemberDrawer
        open={creditOpen}
        onOpenChange={setCreditOpen}
        memberId={memberId}
        memberName={memberName}
        branchId={branchId}
      />
    </>
  );
}
