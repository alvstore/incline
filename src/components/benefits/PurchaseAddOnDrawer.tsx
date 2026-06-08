import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, IndianRupee, Calendar, Sparkles, Dumbbell, CheckCircle, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';
import { useTrainers } from '@/hooks/useTrainers';

interface PurchaseAddOnDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName?: string;
  membershipId: string | null;
  branchId: string;
  /** 'staff' allows cash/card/upi; 'member' restricts to wallet/online (creates pending invoice). */
  mode?: 'staff' | 'member';
  defaultTab?: 'benefits' | 'pt';
}

type BenefitPackage = {
  id: string;
  name: string;
  description: string | null;
  benefit_type: string;
  benefit_type_id: string | null;
  quantity: number;
  price: number;
  validity_days: number;
  branch_id: string | null;
};

type PtPackage = {
  id: string;
  name: string;
  description: string | null;
  total_sessions: number;
  price: number;
  validity_days: number;
  session_type: string | null;
  package_type: string | null;
  branch_id: string | null;
};

const BENEFIT_GROUP_LABELS: Record<string, string> = {
  sauna: 'Sauna',
  steam: 'Steam',
  spa: 'Spa',
  ice_bath: 'Ice Bath',
  recovery: 'Recovery',
  pool: 'Pool',
  other: 'Other Services',
};

export function PurchaseAddOnDrawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  membershipId,
  branchId,
  mode = 'staff',
  defaultTab = 'benefits',
}: PurchaseAddOnDrawerProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'benefits' | 'pt'>(defaultTab);
  const [selectedBenefitPkg, setSelectedBenefitPkg] = useState<string | null>(null);
  const [selectedPtPkg, setSelectedPtPkg] = useState<string | null>(null);
  const [selectedTrainer, setSelectedTrainer] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>(mode === 'member' ? 'pending' : 'cash');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Stable idempotency keys per selected package — same selection retries reuse key.
  const benefitIdemKey = useStableIdempotencyKey(memberId, 'addon_benefit', selectedBenefitPkg ?? null);
  const ptIdemKey = useStableIdempotencyKey(
    memberId,
    'addon_pt',
    selectedPtPkg && selectedTrainer ? `${selectedPtPkg}:${selectedTrainer}` : null,
  );

  const { data: benefitPackages = [], isLoading: loadingBenefit } = useQuery({
    queryKey: ['addon-benefit-packages', branchId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_packages')
        .select('id, name, description, benefit_type, benefit_type_id, quantity, price, validity_days, branch_id')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data || []) as BenefitPackage[];
    },
  });

  const { data: ptPackages = [], isLoading: loadingPt } = useQuery({
    queryKey: ['addon-pt-packages', branchId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_packages')
        .select('id, name, description, total_sessions, price, validity_days, session_type, package_type, branch_id')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('price', { ascending: true });
      if (error) throw error;
      return (data || []) as PtPackage[];
    },
  });

  // Live credits to show "already owns" badges
  const { data: liveCredits = [] } = useQuery({
    queryKey: ['member-live-benefit-credits', memberId],
    enabled: open && !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_benefit_credits')
        .select('benefit_type, credits_remaining, expires_at')
        .eq('member_id', memberId)
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      return data || [];
    },
  });

  const { data: trainers = [] } = useTrainers(branchId, true);

  const grouped = useMemo(() => {
    const out: Record<string, BenefitPackage[]> = {};
    for (const p of benefitPackages) {
      const key = (p.benefit_type || 'other').toLowerCase();
      (out[key] ||= []).push(p);
    }
    return out;
  }, [benefitPackages]);

  const remainingForType = (type: string) =>
    liveCredits
      .filter((c: any) => (c.benefit_type || '').toLowerCase() === type.toLowerCase())
      .reduce((s: number, c: any) => s + (c.credits_remaining || 0), 0);

  const reset = () => {
    setSelectedBenefitPkg(null);
    setSelectedPtPkg(null);
    setSelectedTrainer('');
    setDone(false);
    setPaymentMethod(mode === 'member' ? 'pending' : 'cash');
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const buyBenefit = async () => {
    if (!selectedBenefitPkg) return;
    if (!membershipId) {
      toast.error('Active membership required to add benefit credits');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('purchase_benefit_credits', {
        p_member_id: memberId,
        p_membership_id: membershipId,
        p_package_id: selectedBenefitPkg,
        p_branch_id: branchId,
        p_payment_method: paymentMethod,
        p_idempotency_key: benefitIdemKey,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Purchase failed');
      toast.success('Add-on credits added');
      queryClient.invalidateQueries({ queryKey: ['member-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['my-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['member-benefit-usage-summary'] });
      queryClient.invalidateQueries({ queryKey: ['member-live-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['member-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['my-pending-invoices'] });
      setDone(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to purchase add-on');
    } finally {
      setSubmitting(false);
    }
  };

  const buyPT = async () => {
    if (!selectedPtPkg || !selectedTrainer) {
      toast.error('Pick a package and a trainer');
      return;
    }
    const pkg = ptPackages.find((p) => p.id === selectedPtPkg);
    if (!pkg) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('purchase_pt_package', {
        _member_id: memberId,
        _package_id: selectedPtPkg,
        _trainer_id: selectedTrainer,
        _branch_id: branchId,
        _price_paid: pkg.price,
        _payment_method: paymentMethod,
        _idempotency_key: ptIdemKey,
      });
      if (error) throw error;
      toast.success('PT package activated');
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['member-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['my-pending-invoices'] });
      setDone(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to purchase PT package');
    } finally {
      setSubmitting(false);
    }
  };

  const renderBenefitCard = (p: BenefitPackage) => {
    const owned = remainingForType(p.benefit_type);
    const selected = selectedBenefitPkg === p.id;
    return (
      <Card
        key={p.id}
        onClick={() => setSelectedBenefitPkg(p.id)}
        className={`cursor-pointer transition-all rounded-xl ${
          selected ? 'border-primary ring-2 ring-primary/30 shadow-lg shadow-primary/20' : 'border-border/60 hover:border-primary/40'
        }`}
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{p.name}</p>
              {p.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
              )}
            </div>
            <Badge variant="outline" className="text-[10px]">
              {p.quantity} sessions
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {p.validity_days}d
              </span>
              {owned > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  Owns {owned}
                </Badge>
              )}
            </div>
            <span className="text-base font-bold text-primary flex items-center">
              <IndianRupee className="h-3.5 w-3.5" />
              {Number(p.price).toLocaleString('en-IN')}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPtCard = (p: PtPackage) => {
    const selected = selectedPtPkg === p.id;
    return (
      <Card
        key={p.id}
        onClick={() => setSelectedPtPkg(p.id)}
        className={`cursor-pointer transition-all rounded-xl ${
          selected ? 'border-primary ring-2 ring-primary/30 shadow-lg shadow-primary/20' : 'border-border/60 hover:border-primary/40'
        }`}
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{p.name}</p>
              {p.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
              )}
            </div>
            <Badge variant="outline" className="text-[10px]">
              {p.total_sessions} sessions
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {p.validity_days}d
              </span>
              {p.session_type && (
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {p.session_type}
                </Badge>
              )}
            </div>
            <span className="text-base font-bold text-primary flex items-center">
              <IndianRupee className="h-3.5 w-3.5" />
              {Number(p.price).toLocaleString('en-IN')}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleClose())}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Sell Add-On {memberName ? `to ${memberName}` : ''}
          </SheetTitle>
          <SheetDescription>
            Add extra benefit credits or a PT package. Invoice and payment are recorded atomically.
          </SheetDescription>
        </SheetHeader>

        {done ? (
          <div className="py-12 space-y-6 text-center">
            <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Add-on activated</h3>
              <p className="text-sm text-muted-foreground">
                Invoice has been generated and credits are live.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { reset(); }}>
                Sell another
              </Button>
              <Button className="flex-1" onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'benefits' | 'pt')} className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="benefits">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Benefit Credits
              </TabsTrigger>
              <TabsTrigger value="pt">
                <Dumbbell className="h-3.5 w-3.5 mr-1.5" />
                PT Packages
              </TabsTrigger>
            </TabsList>

            <TabsContent value="benefits" className="space-y-4 mt-4">
              {loadingBenefit ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : benefitPackages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No benefit add-on packages configured for this branch.
                </p>
              ) : (
                Object.entries(grouped).map(([type, pkgs]) => (
                  <div key={type} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {BENEFIT_GROUP_LABELS[type] || type}
                    </h4>
                    <div className="grid gap-2">{pkgs.map(renderBenefitCard)}</div>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="pt" className="space-y-4 mt-4">
              {loadingPt ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : ptPackages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No PT packages configured for this branch.
                </p>
              ) : (
                <>
                  <div className="grid gap-2">{ptPackages.map(renderPtCard)}</div>
                  {selectedPtPkg && (
                    <div className="space-y-2 pt-2">
                      <Label>Trainer</Label>
                      <Select value={selectedTrainer} onValueChange={setSelectedTrainer}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a trainer" />
                        </SelectTrigger>
                        <SelectContent>
                          {trainers.filter((t: any) => t.is_active).map((t: any) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.profile_name || t.profile_email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {((tab === 'benefits' && selectedBenefitPkg) || (tab === 'pt' && selectedPtPkg)) && (
              <div className="space-y-2 pt-4">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mode === 'staff' ? (
                      <>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="pending">Pending (invoice only)</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="pending">Pay at front desk</SelectItem>
                        <SelectItem value="online">Pay online</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <SheetFooter className="pt-6 gap-2">
              <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancel</Button>
              {tab === 'benefits' ? (
                <Button
                  onClick={buyBenefit}
                  disabled={submitting || !selectedBenefitPkg || !membershipId}
                >
                  {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Confirm Purchase
                </Button>
              ) : (
                <Button
                  onClick={buyPT}
                  disabled={submitting || !selectedPtPkg || !selectedTrainer}
                >
                  {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Confirm Purchase
                </Button>
              )}
            </SheetFooter>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
