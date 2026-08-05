import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Loader2, IndianRupee, Calendar, Sparkles, Dumbbell, CheckCircle, Plus, ShieldAlert, CalendarCheck,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';
import { useTrainers } from '@/hooks/useTrainers';
import { initializePayment, openRazorpayCheckout, verifyRazorpayPayment } from '@/services/paymentService';


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
  /** Preselect a specific benefit package when the drawer opens (upsell deep-links). */
  defaultPackageId?: string | null;
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
  tax_rate: number | null;
  tax_inclusive: boolean | null;
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

type BenefitTypeSafety = {
  id: string;
  name: string;
  safety_notes: string | null;
  terms: string | null;
};

const BENEFIT_GROUP_LABELS: Record<string, string> = {
  sauna: 'Sauna',
  sauna_access: 'Sauna',
  sauna_session: 'Sauna',
  steam: 'Steam',
  steam_access: 'Steam',
  spa: 'Spa',
  spa_access: 'Spa',
  ice_bath: 'Ice Bath',
  recovery: 'Recovery',
  pool: 'Pool',
  pool_access: 'Pool',
  body_scan: '3D Body Scan',
  posture_scan: 'Posture Scan',
  other: 'Other Services',
};

function toLines(value: string | null | undefined): string[] {
  return (value || '')
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean);
}

export function PurchaseAddOnDrawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  membershipId,
  branchId,
  mode = 'staff',
  defaultTab = 'benefits',
  defaultPackageId = null,
}: PurchaseAddOnDrawerProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'benefits' | 'pt'>(defaultTab);
  const [selectedBenefitPkg, setSelectedBenefitPkg] = useState<string | null>(null);
  const [selectedPtPkg, setSelectedPtPkg] = useState<string | null>(null);
  const [selectedTrainer, setSelectedTrainer] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>(mode === 'member' ? 'pending' : 'cash');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [lastPurchase, setLastPurchase] = useState<{ credits: number; validityDays: number } | null>(null);

  // Upsell deep-link: preselect the package the member tapped on.
  useEffect(() => {
    if (open && defaultPackageId) {
      setTab('benefits');
      setSelectedBenefitPkg(defaultPackageId);
    }
  }, [open, defaultPackageId]);



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
        .select('id, name, description, benefit_type, benefit_type_id, quantity, price, validity_days, branch_id, tax_rate, tax_inclusive')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data || []) as BenefitPackage[];
    },
  });

  const { data: benefitTypeSafety = [] } = useQuery({
    queryKey: ['addon-benefit-type-safety', branchId],
    enabled: open && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_types')
        .select('id, name, safety_notes, terms')
        .eq('branch_id', branchId);
      if (error) throw error;
      return (data || []) as BenefitTypeSafety[];
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

  const selectedPackage = useMemo(
    () => benefitPackages.find((p) => p.id === selectedBenefitPkg) || null,
    [benefitPackages, selectedBenefitPkg],
  );

  const selectedSafety = useMemo(() => {
    if (!selectedPackage?.benefit_type_id) return null;
    return benefitTypeSafety.find((t) => t.id === selectedPackage.benefit_type_id) || null;
  }, [benefitTypeSafety, selectedPackage]);

  const precautions = toLines(selectedSafety?.safety_notes);
  const termsLines = toLines(selectedSafety?.terms);
  const needsAcknowledgement = precautions.length > 0 || termsLines.length > 0;

  // Any change of selection resets the acknowledgement.
  useEffect(() => {
    setAcknowledged(false);
  }, [selectedBenefitPkg]);

  const priceBreakdown = useMemo(() => {
    if (!selectedPackage) return null;
    const price = Number(selectedPackage.price) || 0;
    const rate = Number(selectedPackage.tax_rate ?? 0) / 100;
    const inclusive = selectedPackage.tax_inclusive ?? true;
    const base = inclusive ? price / (1 + rate) : price;
    const tax = inclusive ? price - base : price * rate;
    const total = inclusive ? price : price + tax;
    return { base, tax, total, rate: Number(selectedPackage.tax_rate ?? 0) };
  }, [selectedPackage]);

  const remainingForType = (type: string) =>
    liveCredits
      .filter((c: any) => (c.benefit_type || '').toLowerCase() === type.toLowerCase())
      .reduce((s: number, c: any) => s + (c.credits_remaining || 0), 0);

  const reset = () => {
    setSelectedBenefitPkg(null);
    setSelectedPtPkg(null);
    setSelectedTrainer('');
    setAcknowledged(false);
    setDone(false);
    setLastPurchase(null);
    setPaymentMethod(mode === 'member' ? 'pending' : 'cash');
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const buyBenefit = async () => {
    if (!selectedBenefitPkg || !selectedPackage) return;
    if (!membershipId) {
      toast.error('Active membership required to add benefit credits');
      return;
    }
    if (needsAcknowledgement && !acknowledged) {
      toast.error('Please confirm the precautions and terms first');
      return;
    }
    setSubmitting(true);
    try {
      const online = paymentMethod === 'online';
      const { data, error } = await supabase.rpc('purchase_benefit_credits', {
        p_member_id: memberId,
        p_membership_id: membershipId,
        p_package_id: selectedBenefitPkg,
        p_branch_id: branchId,
        p_payment_method: online ? 'upi' : paymentMethod,
        p_idempotency_key: benefitIdemKey,
        p_defer_settlement: online,
      } as any);
      if (error) throw error;
      const result = data as { success?: boolean; error?: string; invoice_id?: string } | null;
      if (!result?.success) throw new Error(result?.error || 'Purchase failed');

      if (online && result.invoice_id) {
        const order = await initializePayment(result.invoice_id, branchId);
        await new Promise<void>((resolve, reject) => {
          openRazorpayCheckout(
            order,
            { name: memberName || 'Member', email: '', phone: '' },
            async (response) => {
              try {
                await verifyRazorpayPayment({
                  invoiceId: result.invoice_id!,
                  branchId,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                });
                await supabase.rpc('activate_benefit_credits_for_invoice' as any, {
                  _invoice_id: result.invoice_id,
                });
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            (err) => reject(err instanceof Error ? err : new Error('Payment cancelled')),
          );
        });
      }

      toast.success(online ? 'Payment successful — credits added' : 'Add-on credits added');

      setLastPurchase({ credits: selectedPackage.quantity, validityDays: selectedPackage.validity_days });
      queryClient.invalidateQueries({ queryKey: ['member-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['my-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['member-benefit-usage-summary'] });
      queryClient.invalidateQueries({ queryKey: ['member-live-benefit-credits'] });
      queryClient.invalidateQueries({ queryKey: ['store-addons-credits'] });
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
        className={`cursor-pointer transition-all duration-200 rounded-xl ${
          selected ? 'border-primary ring-2 ring-primary/30 shadow-lg shadow-primary/20' : 'border-border/60 hover:border-primary/40'
        }`}
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{p.name}</p>
              {p.description && (
                <p className={`text-xs text-muted-foreground whitespace-pre-line ${selected ? '' : 'line-clamp-2'}`}>
                  {p.description}
                </p>
              )}
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {p.quantity} session{p.quantity > 1 ? 's' : ''}
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
        className={`cursor-pointer transition-all duration-200 rounded-xl ${
          selected ? 'border-primary ring-2 ring-primary/30 shadow-lg shadow-primary/20' : 'border-border/60 hover:border-primary/40'
        }`}
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{p.name}</p>
              {p.description && (
                <p className={`text-xs text-muted-foreground whitespace-pre-line ${selected ? '' : 'line-clamp-2'}`}>
                  {p.description}
                </p>
              )}
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">
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

  const isMember = mode === 'member';

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(o) : handleClose())}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {isMember ? 'Buy an add-on' : `Sell Add-On ${memberName ? `to ${memberName}` : ''}`}
          </SheetTitle>
          <SheetDescription>
            {isMember
              ? 'Top up recovery sessions or personal training. Your invoice is created instantly.'
              : 'Add extra benefit credits or a PT package. Invoice and payment are recorded atomically.'}
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
                {lastPurchase
                  ? `${lastPurchase.credits} credit${lastPurchase.credits > 1 ? 's' : ''} added — valid for ${lastPurchase.validityDays} days. Your invoice is in Invoices.`
                  : 'Invoice has been generated and credits are live.'}
              </p>
            </div>
            <div className="flex gap-2">
              {isMember ? (
                <>
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={handleClose}>Done</Button>
                  <Button
                    className="flex-1 rounded-xl"
                    onClick={() => { handleClose(); navigate('/book?type=recovery'); }}
                  >
                    <CalendarCheck className="h-4 w-4 mr-2" /> Book a slot
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="flex-1" onClick={() => { reset(); }}>
                    Sell another
                  </Button>
                  <Button className="flex-1" onClick={handleClose}>Done</Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'benefits' | 'pt')} className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="benefits">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {isMember ? 'Recovery' : 'Benefit Credits'}
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
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {BENEFIT_GROUP_LABELS[type] || type.replace(/_/g, ' ')}
                    </h4>
                    <div className="grid gap-2">{pkgs.map(renderBenefitCard)}</div>
                  </div>
                ))
              )}

              {selectedPackage && priceBreakdown && (
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base amount</span>
                    <span className="font-medium">₹{priceBreakdown.base.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST ({priceBreakdown.rate}%)</span>
                    <span className="font-medium">₹{priceBreakdown.tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border/60 pt-1 mt-1">
                    <span className="font-semibold">Total payable</span>
                    <span className="font-bold">₹{priceBreakdown.total.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {selectedPackage && needsAcknowledgement && (
                <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
                    <p className="text-sm font-semibold">Before you go — {selectedSafety?.name}</p>
                  </div>
                  {precautions.length > 0 && (
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                      {precautions.map((line, i) => <li key={`p-${i}`}>{line}</li>)}
                    </ul>
                  )}
                  {termsLines.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Terms</p>
                      <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                        {termsLines.map((line, i) => <li key={`t-${i}`}>{line}</li>)}
                      </ul>
                    </div>
                  )}
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(v) => setAcknowledged(v === true)}
                      aria-label="Acknowledge precautions and terms"
                      className="mt-0.5"
                    />
                    <span className="text-xs text-foreground">
                      I have read the precautions and accept the terms for this service.
                    </span>
                  </label>
                </div>
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
                      <Label htmlFor="addon-trainer">Trainer</Label>
                      <Select value={selectedTrainer} onValueChange={setSelectedTrainer}>
                        <SelectTrigger id="addon-trainer">
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
                <Label htmlFor="addon-payment">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="addon-payment">
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
                  disabled={
                    submitting ||
                    !selectedBenefitPkg ||
                    !membershipId ||
                    (needsAcknowledgement && !acknowledged)
                  }
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
