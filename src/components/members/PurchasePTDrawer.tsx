import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { usePTPackages, usePurchasePTPackage } from '@/hooks/usePTPackages';
import { useTrainers } from '@/hooks/useTrainers';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dumbbell, Calendar, IndianRupee, FileText, CheckCircle, Percent, Tag, CreditCard } from 'lucide-react';
import { createNotification } from '@/services/notificationService';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { validateCoupon, redeemCoupon, couponReasonLabel } from '@/services/couponService';
import { formatINR } from '@/lib/payments/ptCheckout';

interface PurchasePTDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  branchId: string;
}

type DiscountMode = 'none' | 'percent' | 'fixed' | 'coupon';
type PaymentMethod = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'pending';

export function PurchasePTDrawer({ open, onOpenChange, memberId, memberName, branchId }: PurchasePTDrawerProps) {
  const { data: packages = [] } = usePTPackages(branchId);
  const { data: trainers = [] } = useTrainers(branchId, true);
  const purchasePT = usePurchasePTPackage();
  const queryClient = useQueryClient();

  const [selectedPackage, setSelectedPackage] = useState<string>('');
  const [selectedTrainer, setSelectedTrainer] = useState<string>('');
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [couponCode, setCouponCode] = useState<string>('');
  const [couponValidated, setCouponValidated] = useState<{ discount: number; codeId: string } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountPaidInput, setAmountPaidInput] = useState<string>('');
  const [purchaseResult, setPurchaseResult] = useState<{ success: boolean; invoiceId?: string } | null>(null);
  const [processing, setProcessing] = useState(false);

  const activePackages = packages.filter(p => p.is_active);
  const activeTrainers = trainers.filter(t => t.is_active);
  const selectedPkg = activePackages.find(p => p.id === selectedPackage);
  const selectedTrainerObj = activeTrainers.find(t => t.id === selectedTrainer);

  // Compute discount + final price
  const { discountAmount, finalPrice } = useMemo(() => {
    const basePrice = selectedPkg?.price ?? 0;
    let d = 0;
    if (discountMode === 'percent') {
      const pct = Math.max(0, Math.min(100, Number(discountValue) || 0));
      d = Math.round((basePrice * pct) / 100);
    } else if (discountMode === 'fixed') {
      d = Math.max(0, Math.min(basePrice, Number(discountValue) || 0));
    } else if (discountMode === 'coupon' && couponValidated) {
      d = Math.max(0, Math.min(basePrice, couponValidated.discount));
    }
    return { discountAmount: d, finalPrice: Math.max(0, basePrice - d) };
  }, [selectedPkg, discountMode, discountValue, couponValidated]);

  const amountPaid = paymentMethod === 'pending' ? 0 : (amountPaidInput === '' ? finalPrice : Math.max(0, Math.min(finalPrice, Number(amountPaidInput) || 0)));

  const handleValidateCoupon = async () => {
    if (!couponCode.trim() || !selectedPkg) {
      toast.error('Enter a coupon code and pick a package first');
      return;
    }
    setValidatingCoupon(true);
    try {
      const res = await validateCoupon({
        code: couponCode.trim(),
        branchId,
        subtotal: selectedPkg.price,
      });
      if (res.success) {
        setCouponValidated({ discount: res.discount_amount, codeId: res.code_id });
        toast.success(`Coupon applied — ${formatINR(res.discount_amount)} off`);
      } else {
        setCouponValidated(null);
        toast.error(couponReasonLabel(res.reason));
      }
    } catch (e: any) {
      toast.error(e?.message || 'Coupon validation failed');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedPackage || !selectedTrainer || !selectedPkg) {
      toast.error('Please select a package and trainer');
      return;
    }

    setProcessing(true);
    try {
      const result = await purchasePT.mutateAsync({
        memberId,
        packageId: selectedPackage,
        trainerId: selectedTrainer,
        branchId,
        pricePaid: finalPrice,
        paymentMethod: paymentMethod === 'pending' ? 'cash' : paymentMethod,
        idempotencyKey: `pt-${memberId}-${selectedPackage}-${selectedTrainer}-${finalPrice}-${discountAmount}`,
      });

      const invoiceId = (result as any)?.invoice_id as string | undefined;

      // If coupon used, mark redemption against invoice
      if (discountMode === 'coupon' && couponValidated && invoiceId) {
        try {
          await redeemCoupon({
            code: couponCode.trim(),
            branchId,
            memberId,
            subtotal: selectedPkg.price,
            referenceType: 'invoice',
            referenceId: invoiceId,
            idempotencyKey: `pt-coupon-${invoiceId}`,
          });
        } catch (err) {
          console.warn('Coupon redemption failed:', err);
        }
      }

      // Record payment if amount was actually collected upfront and we have an invoice
      if (invoiceId && amountPaid > 0 && paymentMethod !== 'pending') {
        const { error: payErr } = await supabase.rpc('record_payment', {
          p_branch_id: branchId,
          p_invoice_id: invoiceId,
          p_member_id: memberId,
          p_amount: amountPaid,
          p_payment_method: paymentMethod,
          p_notes: `PT package: ${selectedPkg.name}`,
        } as any);
        if (payErr) console.warn('record_payment failed:', payErr);
      }

      // Auto-link trainer as general trainer if not already assigned
      const { data: member } = await supabase
        .from('members')
        .select('assigned_trainer_id')
        .eq('id', memberId)
        .maybeSingle();

      if (member && !member.assigned_trainer_id) {
        await supabase
          .from('members')
          .update({ assigned_trainer_id: selectedTrainer })
          .eq('id', memberId);
      }

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['finance-income'] });
      queryClient.invalidateQueries({ queryKey: ['trainers-utilization'] });
      invalidateMembersData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
      queryClient.invalidateQueries({ queryKey: ['active-membership'] });
      queryClient.invalidateQueries({ queryKey: ['member-pending-invoices'] });

      // Send notifications
      try {
        const { data: memberData } = await supabase
          .from('members')
          .select('user_id')
          .eq('id', memberId)
          .maybeSingle();

        if (memberData?.user_id) {
          await createNotification({
            user_id: memberData.user_id,
            branch_id: branchId,
            title: 'PT Package Purchased',
            message: `Your personal training package "${selectedPkg.name}" has been activated.`,
            type: 'success',
            category: 'pt',
            action_url: null,
            metadata: null,
          });
        }

        const { data: adminUsers } = await supabase
          .from('user_roles')
          .select('user_id')
          .in('role', ['owner', 'admin']);

        for (const admin of adminUsers || []) {
          await createNotification({
            user_id: admin.user_id,
            branch_id: branchId,
            title: 'New PT Package Sale',
            message: `${memberName} purchased "${selectedPkg.name}" for ${formatINR(finalPrice)}${discountAmount > 0 ? ` (discount ${formatINR(discountAmount)})` : ''}`,
            type: 'info',
            category: 'pt',
            action_url: null,
            metadata: null,
          });
        }
      } catch (notifError) {
        console.warn('Failed to send PT purchase notifications:', notifError);
      }

      setPurchaseResult({ success: true, invoiceId });
      toast.success('PT Package purchased successfully! Invoice created.');
    } catch (error: any) {
      console.error('Error purchasing PT package:', error);
      toast.error(error.message || 'Failed to purchase PT package');
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedPackage('');
    setSelectedTrainer('');
    setDiscountMode('none');
    setDiscountValue('');
    setCouponCode('');
    setCouponValidated(null);
    setPaymentMethod('cash');
    setAmountPaidInput('');
    setPurchaseResult(null);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Purchase PT Package</SheetTitle>
          <SheetDescription>Add a personal training package for {memberName}</SheetDescription>
        </SheetHeader>

        {purchaseResult?.success ? (
          <div className="py-12 space-y-6 text-center">
            <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">Purchase Complete!</h3>
              <p className="text-sm text-muted-foreground mb-4">
                PT package has been assigned to {memberName}
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>Invoice has been created automatically</span>
              </div>
            </div>
            <Button onClick={handleClose} className="w-full">Done</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            {/* Package */}
            <div className="space-y-2">
              <Label>Select Package *</Label>
              <Select value={selectedPackage} onValueChange={setSelectedPackage}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a PT package" />
                </SelectTrigger>
                <SelectContent>
                  {activePackages.map((pkg) => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      <div className="flex items-center gap-2">
                        <span>{pkg.name}</span>
                        <Badge variant="secondary" className="text-xs">{pkg.total_sessions} sessions</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPkg && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="font-medium">{selectedPkg.name}</h4>
                {selectedPkg.description && (
                  <p className="text-sm text-muted-foreground">{selectedPkg.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Dumbbell className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedPkg.total_sessions} sessions</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedPkg.validity_days} days validity</span>
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <IndianRupee className="h-4 w-4" />
                  <span className="text-lg font-bold">{selectedPkg.price.toLocaleString('en-IN')}</span>
                  <span className="text-xs text-muted-foreground">list price</span>
                </div>
              </div>
            )}

            {/* Trainer */}
            <div className="space-y-2">
              <Label>Assign Trainer *</Label>
              <Select value={selectedTrainer} onValueChange={setSelectedTrainer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a trainer" />
                </SelectTrigger>
                <SelectContent>
                  {activeTrainers.map((trainer) => (
                    <SelectItem key={trainer.id} value={trainer.id}>
                      <div className="flex items-center gap-2">
                        <span>{trainer.profile_name || trainer.profile_email}</span>
                        {trainer.specializations && trainer.specializations.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({trainer.specializations.slice(0, 2).join(', ')})
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Discount */}
            {selectedPkg && (
              <div className="space-y-3 rounded-lg border p-4">
                <Label className="flex items-center gap-2"><Tag className="h-4 w-4" /> Discount</Label>
                <Select value={discountMode} onValueChange={(v) => { setDiscountMode(v as DiscountMode); setCouponValidated(null); setDiscountValue(''); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No discount</SelectItem>
                    <SelectItem value="percent">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Flat amount (₹)</SelectItem>
                    <SelectItem value="coupon">Coupon code</SelectItem>
                  </SelectContent>
                </Select>

                {(discountMode === 'percent' || discountMode === 'fixed') && (
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder={discountMode === 'percent' ? 'e.g. 10' : 'e.g. 500'}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                  />
                )}

                {discountMode === 'coupon' && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Coupon code"
                      value={couponCode}
                      onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponValidated(null); }}
                    />
                    <Button type="button" variant="outline" onClick={handleValidateCoupon} disabled={validatingCoupon}>
                      {validatingCoupon ? 'Checking…' : 'Apply'}
                    </Button>
                  </div>
                )}

                {discountAmount > 0 && (
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">
                    You save {formatINR(discountAmount)}
                  </div>
                )}
              </div>
            )}

            {/* Payment */}
            {selectedPkg && (
              <div className="space-y-3 rounded-lg border p-4">
                <Label className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payment</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="pending">Pay later (invoice only)</SelectItem>
                  </SelectContent>
                </Select>

                {paymentMethod !== 'pending' && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Amount collected now</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={finalPrice}
                      placeholder={String(finalPrice)}
                      value={amountPaidInput}
                      onChange={(e) => setAmountPaidInput(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Leave blank to collect the full amount ({formatINR(finalPrice)}).
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Summary */}
            {selectedPkg && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span>List price</span><span>{formatINR(selectedPkg.price)}</span></div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                      <span>Discount</span><span>− {formatINR(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-1 border-t">
                    <span>Total payable</span><span>{formatINR(finalPrice)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Collecting now</span><span>{formatINR(amountPaid)}</span>
                  </div>
                  {finalPrice - amountPaid > 0 && (
                    <div className="flex justify-between text-amber-700 dark:text-amber-400">
                      <span>Pending dues</span><span>{formatINR(finalPrice - amountPaid)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Trainer commission */}
            {selectedTrainerObj && (
              <Card className="border-info/20 bg-info/5">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Percent className="h-4 w-4 text-info" />
                    <span className="text-muted-foreground">
                      Trainer Commission: <strong className="text-foreground">
                        {(selectedTrainerObj as any).pt_share_percentage || 0}%
                      </strong>
                      {' '}
                      ({formatINR(Math.round(finalPrice * ((selectedTrainerObj as any).pt_share_percentage || 0) / 100))})
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={processing || !selectedPackage || !selectedTrainer}>
                {processing ? 'Processing...' : 'Purchase Package'}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
