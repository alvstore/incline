import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays, differenceInDays } from 'date-fns';
import { membershipEndDateISO } from '@/lib/memberships/duration';

import { usePlans } from '@/hooks/usePlans';
import { CreditCard, IndianRupee, Calendar, Gift, AlertTriangle, CheckCircle, Lock, Wallet } from 'lucide-react';
import { useGstRates } from '@/hooks/useGstRates';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { normalizePaymentMethod } from '@/lib/payments/normalizePaymentMethod';
import { MemberIdentityHeader } from '@/components/members/MemberIdentityHeader';

/** Quick presets for the remaining-balance due date, counted from today. */
const DUE_DATE_PRESETS = [
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '10 days', days: 10 },
  { label: '15 days', days: 15 },
];

interface PurchaseMembershipDrawerProps {

  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  branchId: string;
  /** Pre-selected plan id (used when launched from a specific plan card). */
  presetPlanId?: string;
  /** When true and the member has an outstanding balance after purchase,
   *  redirect to /member/pay?invoice=<id> for embedded checkout. */
  redirectToCheckout?: boolean;
  /** 'staff' (default) shows full back-office controls (GST, discount, partial
   *  payment, locker, payment-method picker). 'member' hides everything except
   *  plan + start date and forces an online (Razorpay) payment link. */
  mode?: 'staff' | 'member';
}

export function PurchaseMembershipDrawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  branchId,
  presetPlanId,
  redirectToCheckout = false,
  mode = 'staff',
}: PurchaseMembershipDrawerProps) {
  const isMemberMode = mode === 'member';
  const navigate = useNavigate();
  const [selectedPlanId, setSelectedPlanId] = useState(presetPlanId ?? '');

  // Sync preset plan whenever the drawer opens with a new preset.
  useEffect(() => {
    if (open && presetPlanId) {
      setSelectedPlanId(presetPlanId);
    }
  }, [open, presetPlanId]);

  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [advanceBooking, setAdvanceBooking] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>(isMemberMode ? 'razorpay_link' : 'cash');
  const [selectedLockerId, setSelectedLockerId] = useState<string>('');

  // GST State
  const [includeGst, setIncludeGst] = useState(false);
  const [gstRate, setGstRate] = useState(5);

  // Partial Payment State (member mode never offers partial)
  const [isPartialPayment, setIsPartialPayment] = useState(false);
  const [amountPaying, setAmountPaying] = useState(0);
  const [paymentDueDate, setPaymentDueDate] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [sendReminders, setSendReminders] = useState(true);
  const [transactionId, setTransactionId] = useState('');

  
  const queryClient = useQueryClient();
  const { data: gstRates = [5, 12, 18, 28] } = useGstRates();

  const { data: plans = [] } = usePlans(branchId);
  const selectedPlan = plans.find((p: any) => p.id === selectedPlanId);

  // Check if selected plan has locker benefit
  const hasLockerBenefit = selectedPlan?.plan_benefits?.some(
    (b: any) => b.benefit_type === 'locker_access' || b.benefit_type?.includes('locker')
  );

  // Fetch available lockers
  const { data: availableLockers = [] } = useQuery({
    queryKey: ['available-lockers', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lockers')
        .select('*')
        .eq('branch_id', branchId)
        .eq('status', 'available')
        .order('locker_number');
      if (error) throw error;
      return data || [];
    },
    enabled: !!branchId && hasLockerBenefit,
  });

  // Check if member has active membership
  const { data: activeMembership } = useQuery({
    queryKey: ['active-membership-check', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*, membership_plans(name)')
        .eq('member_id', memberId)
        .in('status', ['active', 'frozen'])
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!memberId && open,
  });

  // Calculate if renewal is allowed (only 7 days before expiry or after expiry)
  const daysUntilExpiry = activeMembership 
    ? differenceInDays(new Date(activeMembership.end_date), new Date())
    : null;
  
  const canRenew = !activeMembership || (daysUntilExpiry !== null && daysUntilExpiry <= 7);

  // Check if member has a pending referral
  const { data: pendingReferral } = useQuery({
    queryKey: ['pending-referral', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referrals')
        .select('*, referrer:referrer_member_id(id, member_code, user_id)')
        .eq('referred_member_id', memberId)
        .eq('status', 'new')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!memberId,
  });

  // Get referral settings
  const { data: referralSettings } = useQuery({
    queryKey: ['referral-settings', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_settings')
        .select('*')
        .eq('is_active', true)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order('branch_id', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Plan price + admission is the *gross* (consumer-facing) amount the member pays.
  // GST inclusive plans (default): tax is extracted out of the gross — total stays the same
  //   regardless of whether the cashier ticks "Tax invoice".
  // GST exclusive plans (legacy): tax is added on top.
  const isPlanGstInclusive = (selectedPlan as any)?.is_gst_inclusive !== false;

  const calculateGross = () => {
    if (!selectedPlan) return 0;
    const base = selectedPlan.discounted_price || selectedPlan.price;
    const admission = selectedPlan.admission_fee || 0;
    return Math.max(base + admission - discountAmount, 0);
  };

  const calculateGstAmount = () => {
    if (!includeGst || !selectedPlan || !gstRate) return 0;
    const gross = calculateGross();
    if (isPlanGstInclusive) {
      // Extract: gross = base * (1 + r/100)  =>  tax = gross - gross/(1+r/100)
      const taxable = Math.round((gross / (1 + gstRate / 100)) * 100) / 100;
      return Math.round((gross - taxable) * 100) / 100;
    }
    return Math.round(gross * (gstRate / 100) * 100) / 100;
  };

  const calculateTotal = () => {
    const gross = calculateGross();
    if (!includeGst || isPlanGstInclusive) {
      // Inclusive plans: total = gross. Receipt vs tax invoice only changes the breakdown.
      return gross;
    }
    return gross + calculateGstAmount();
  };

  const calculateEndDate = () => {
    if (!selectedPlan) return '';
    return membershipEndDateISO(startDate, selectedPlan.duration_days);
  };
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const isBackdated = !isMemberMode && !advanceBooking && startDate < todayIso;
  const backdatedDays = isBackdated ? differenceInDays(new Date(todayIso), new Date(startDate)) : 0;

  /** Same rule as Record Payment: a reference number is only meaningful for
   *  non-cash, non-wallet manual settlements. */
  const showTransactionField =
    !isMemberMode && ['upi', 'bank_transfer', 'card'].includes(paymentMethod);

  const remainingAmount = calculateTotal() - amountPaying;


  const purchaseMembership = useMutation({
    mutationFn: async () => {
      if (!selectedPlan) throw new Error('Please select a plan');

      const isPaymentLink = paymentMethod === 'razorpay_link';

      // Validate partial payment
      if (isPartialPayment && !isPaymentLink) {
        if (amountPaying <= 0) throw new Error('Please enter amount paying now');
        if (amountPaying >= calculateTotal()) throw new Error('Amount paying should be less than total for partial payment');
        if (!paymentDueDate) throw new Error('Please set a due date for remaining amount');
      }

      // Start date resolution:
      //  • Advance booking ON (staff)  → use the user-picked date as-is (creates a Scheduled membership).
      //  • Active renewal w/o advance → start day after current expiry.
      //  • Otherwise                  → user-picked date.
      const effectiveStartDate = advanceBooking
        ? startDate
        : (activeMembership && canRenew && activeMembership.end_date
            ? format(addDays(new Date(activeMembership.end_date), 1), 'yyyy-MM-dd')
            : startDate);

      const totalAmount = calculateTotal();
      const actualAmountPaid = isPaymentLink ? 0 : (isPartialPayment ? amountPaying : totalAmount);

      // Idempotency key — guarantees the same Submit click never produces two
      // memberships/invoices even on network retries.
      const idempotencyKey = `purchase:${memberId}:${selectedPlanId}:${effectiveStartDate}:${totalAmount}`;

      // ✅ Single atomic RPC: creates membership + invoice + items + (optional) initial payment.
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('purchase_member_membership', {
        p_member_id: memberId,
        p_plan_id: selectedPlanId,
        p_branch_id: branchId,
        p_start_date: effectiveStartDate,
        p_discount_amount: discountAmount,
        p_discount_reason: discountReason || null,
        p_include_gst: includeGst,
        p_gst_rate: includeGst ? gstRate : 0,
        p_payment_method: normalizePaymentMethod(paymentMethod),
        p_amount_paying: actualAmountPaid,
        p_payment_due_date: isPartialPayment ? paymentDueDate : null,
        p_send_reminders: sendReminders,
        p_payment_source: isPaymentLink ? 'payment_link' : 'manual',
        p_idempotency_key: idempotencyKey,
        p_assign_locker_id: hasLockerBenefit && selectedLockerId ? selectedLockerId : null,
        p_notes: null,
        p_transaction_id: showTransactionField ? (transactionId.trim() || null) : null,

      });

      if (rpcErr) throw rpcErr;
      const result = rpcRes as any;
      if (result?.success === false) throw new Error(result.error || 'Purchase failed');

      const invoiceId: string | undefined = result?.invoice_id;
      const membershipId: string | undefined = result?.membership_id ?? result?.entity_id;

      // Generate Razorpay payment link (the RPC left the invoice unpaid for us).
      if (isPaymentLink && invoiceId) {
        const { data: linkData, error: linkError } = await supabase.functions.invoke('create-razorpay-link', {
          body: { invoiceId, amount: totalAmount, branchId },
        });
        if (linkError) throw new Error(linkError.message || 'Failed to generate payment link');
        if (linkData?.error) throw new Error(linkData.error);

        if (linkData?.short_url) {
          await navigator.clipboard.writeText(linkData.short_url);
          toast.success(`Payment link copied: ${linkData.short_url}`);
        }
      }

      // Referral conversion + reward issuance is owned by the backend
      // (`purchase_member_membership` RPC + `notify_referral_converted` trigger).
      // Do NOT double-process here. Query invalidations below will refresh UI from the
      // authoritative state.

      return { membershipId, invoiceId };
    },
    onSuccess: ({ invoiceId }) => {
      toast.success('Membership purchased successfully');
      invalidateMembersData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      queryClient.invalidateQueries({ queryKey: ['all-rewards'] });
      queryClient.invalidateQueries({ queryKey: ['lockers'] });
      queryClient.invalidateQueries({ queryKey: ['available-lockers'] });
      queryClient.invalidateQueries({ queryKey: ['active-membership'] });
      queryClient.invalidateQueries({ queryKey: ['member-pending-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
      queryClient.invalidateQueries({ queryKey: ['all-overdue-invoices'] });
      onOpenChange(false);
      resetForm();
      // Member-mode: ALWAYS route to embedded checkout when there's an unpaid balance.
      // Staff-mode: only route when explicitly requested.
      const shouldRedirect = (isMemberMode || redirectToCheckout) && invoiceId
        && paymentMethod !== 'cash' && paymentMethod !== 'wallet';
      if (shouldRedirect) {
        navigate(`/member/pay?invoice=${invoiceId}`);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to purchase membership');
    },
  });

  const resetForm = () => {
    // Preserve presetPlanId so reopening the drawer with a preset still pre-selects it.
    setSelectedPlanId(presetPlanId ?? '');
    setStartDate(format(new Date(), 'yyyy-MM-dd'));
    setAdvanceBooking(false);
    setDiscountAmount(0);
    setDiscountReason('');
    setPaymentMethod('cash');
    setSelectedLockerId('');
    setIncludeGst(false);
    setGstRate(18);
    setIsPartialPayment(false);
    setAmountPaying(0);
    setPaymentDueDate(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
    setSendReminders(true);
    setTransactionId('');
  };


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Purchase Membership
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <MemberIdentityHeader memberId={memberId} memberName={memberName} />

          {/* Active Membership Warning — softened when staff opts into advance booking */}
          {activeMembership && !canRenew && !advanceBooking && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Member already has an active membership ({activeMembership.membership_plans?.name}) 
                expiring on {format(new Date(activeMembership.end_date), 'dd MMM yyyy')}. 
                Renewal is allowed only 7 days before expiry — or enable "Advance booking" below to schedule a future start.
                <br />
                <span className="font-medium">Days remaining: {daysUntilExpiry}</span>
              </AlertDescription>
            </Alert>
          )}

          {/* Renewal Notice */}
          {activeMembership && canRenew && !advanceBooking && (
            <Alert className="border-success/50 bg-success/5">
              <CheckCircle className="h-4 w-4 text-success" />
              <AlertDescription className="text-success">
                Current membership expires in {daysUntilExpiry} days. 
                New membership will start after current one ends.
              </AlertDescription>
            </Alert>
          )}

          {/* Advance-booking confirmation banner */}
          {advanceBooking && (
            <Alert className="border-blue-300 bg-blue-50">
              <Calendar className="h-4 w-4 text-blue-700" />
              <AlertDescription className="text-blue-800">
                Scheduled to start on <strong>{format(new Date(startDate), 'dd MMM yyyy')}</strong>.
                The membership stays in <strong>Scheduled</strong> status until then — hardware access is not granted before the start date.
              </AlertDescription>
            </Alert>
          )}




          {/* Plan Selection */}
          <div className="space-y-2">
            <Label>Select Plan *</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a membership plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan: any) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    <div className="flex justify-between items-center w-full">
                      <span>{plan.name}</span>
                      <span className="text-muted-foreground ml-2">
                        ₹{plan.discounted_price || plan.price} / {plan.duration_days} days
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Referral Bonus Indicator */}
          {pendingReferral && referralSettings && (
            <Card className="border-success/50 bg-success/5">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-success">
                  <Gift className="h-5 w-5" />
                  <div>
                    <p className="font-medium">Referral Bonus Active!</p>
                    <p className="text-sm text-muted-foreground">
                      Referrer gets ₹{referralSettings.referrer_reward_value} • 
                      New member gets ₹{referralSettings.referred_reward_value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {selectedPlan && (
            <>
              {/* Plan Details */}
              <Card className="bg-muted/50">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span>Plan Price{isPlanGstInclusive ? ' (incl. GST)' : ''}</span>
                    <span>₹{selectedPlan.discounted_price || selectedPlan.price}</span>
                  </div>
                  {selectedPlan.admission_fee > 0 && (
                    <div className="flex justify-between">
                      <span>Admission Fee</span>
                      <span>₹{selectedPlan.admission_fee}</span>
                    </div>
                  )}
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-success">
                      <span>Discount</span>
                      <span>-₹{discountAmount}</span>
                    </div>
                  )}
                  {includeGst && (
                    <>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Taxable value</span>
                        <span>₹{(calculateTotal() - calculateGstAmount()).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>CGST ({gstRate / 2}%)</span>
                        <span>₹{(calculateGstAmount() / 2).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>SGST ({gstRate / 2}%)</span>
                        <span>₹{(calculateGstAmount() / 2).toLocaleString()}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Total Payable</span>
                    <span className="flex items-center">
                      <IndianRupee className="h-4 w-4" />
                      {calculateTotal()}
                    </span>
                  </div>
                  {isPlanGstInclusive && (
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Plan is GST-inclusive. Total stays the same whether you issue a tax invoice or a receipt — only the invoice breakdown changes.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Invoice Type (back-office only) */}
              {!isMemberMode && (
                <Card className="border-dashed">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <Label htmlFor="gst-toggle" className="cursor-pointer">Tax Invoice (GST breakup)</Label>
                        <p className="text-xs text-muted-foreground">
                          Off = simple receipt, no tax breakup. {isPlanGstInclusive ? 'Member pays the same either way.' : 'GST will be added on top.'}
                        </p>
                      </div>
                      <Switch
                        id="gst-toggle"
                        checked={includeGst}
                        onCheckedChange={(v) => {
                          setIncludeGst(v);
                          // When turning on, default to the plan's configured rate.
                          const planRate = (selectedPlan as any)?.gst_rate;
                          if (v && planRate) setGstRate(Number(planRate));
                        }}
                      />
                    </div>
                    {includeGst && (
                      <div className="space-y-2">
                        <Label>GST Rate</Label>
                        <Select value={gstRate.toString()} onValueChange={(v) => setGstRate(Number(v))}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {gstRates.map((rate: number) => (
                              <SelectItem key={rate} value={rate.toString()}>{rate}%</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Start Date + Advance booking toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Start Date
                  </Label>
                  {!isMemberMode && (
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 cursor-help">
                            <Label htmlFor="advance-booking" className="text-xs text-muted-foreground cursor-help">
                              Advance booking
                            </Label>
                            <Switch
                              id="advance-booking"
                              checked={advanceBooking}
                              onCheckedChange={(v) => {
                                setAdvanceBooking(v);
                                if (v && new Date(startDate) <= new Date()) {
                                  setStartDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
                                }
                              }}
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Enable this to schedule a membership for a future date. 
                          The membership will stay in <strong>Scheduled</strong> status and hardware access 
                          will only be granted on the start date.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
                <Input
                  type="date"
                  value={startDate}
                  min={
                    advanceBooking
                      ? format(addDays(new Date(), 1), 'yyyy-MM-dd')
                      : isMemberMode
                        ? todayIso
                        : format(addDays(new Date(), -90), 'yyyy-MM-dd')
                  }
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <div className="flex flex-col gap-1.5 mt-1.5">
                  <p className="text-sm font-medium text-primary">
                    Ends on: {calculateEndDate() || '—'}
                  </p>
                  {!isMemberMode && !advanceBooking && (
                    <p className="text-xs text-muted-foreground">
                      Staff can backdate up to 90 days for members who already started training.
                    </p>
                  )}
                </div>
                {isBackdated && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    Backdated start: this membership counts as already running since{' '}
                    <strong>{format(new Date(startDate), 'dd MMM yyyy')}</strong> —{' '}
                    <strong>{backdatedDays} day{backdatedDays === 1 ? '' : 's'}</strong> of cover are
                    already consumed and it will end on <strong>{calculateEndDate() || '—'}</strong>.
                  </div>
                )}
              </div>


              {/* Discount (back-office only) */}
              {!isMemberMode && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Discount Amount</Label>
                    <Input
                      type="number"
                      min={0}
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Discount Reason</Label>
                    <Input
                      placeholder="e.g., Referral, Promo"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Complimentary Locker Selection (back-office only, plan must include locker) */}
              {!isMemberMode && hasLockerBenefit && (
                <Card className="border-primary/50 bg-primary/5">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Lock className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium text-primary">Complimentary Locker</p>
                        <p className="text-xs text-muted-foreground">This plan includes a free locker</p>
                      </div>
                    </div>
                    <Select value={selectedLockerId || "none"} onValueChange={(val) => setSelectedLockerId(val === "none" ? "" : val)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a locker (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No locker needed</SelectItem>
                        {availableLockers.map((locker: any) => (
                          <SelectItem key={locker.id} value={locker.id}>
                            🔐 {locker.locker_number} {locker.size ? `(${locker.size})` : ''}
                          </SelectItem>
                        ))}
                        {availableLockers.length === 0 && (
                          <SelectItem value="no-lockers" disabled>
                            No lockers available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              )}

              {/* Partial Payment (back-office only) */}
              {!isMemberMode && (
                <Card className="border-dashed">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-5 w-5 text-primary" />
                        <div>
                          <Label htmlFor="partial-payment" className="cursor-pointer">Partial Payment</Label>
                          <p className="text-xs text-muted-foreground">Record partial payment with due date</p>
                        </div>
                      </div>
                      <Switch
                        id="partial-payment"
                        checked={isPartialPayment}
                        onCheckedChange={(checked) => {
                          setIsPartialPayment(checked);
                          if (checked) {
                            setAmountPaying(Math.round(calculateTotal() * 0.5));
                          }
                        }}
                      />
                    </div>

                    {isPartialPayment && (
                      <div className="space-y-4 pt-2 border-t">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Amount Paying Now *</Label>
                            <Input
                              type="number"
                              min={1}
                              max={calculateTotal() - 1}
                              value={amountPaying}
                              onChange={(e) => setAmountPaying(Number(e.target.value))}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="purchase-due-date">Due Date for Remaining *</Label>
                          <div className="flex flex-wrap gap-2">
                            {DUE_DATE_PRESETS.map((preset) => {
                              const value = format(addDays(new Date(), preset.days), 'yyyy-MM-dd');
                              const active = value === paymentDueDate;
                              return (
                                <button
                                  key={preset.days}
                                  type="button"
                                  onClick={() => setPaymentDueDate(value)}
                                  aria-pressed={active}
                                  className={`min-h-[44px] cursor-pointer rounded-full px-4 text-sm font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                    active
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-muted dark:text-muted-foreground'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                          <Input
                            id="purchase-due-date"
                            type="date"
                            value={paymentDueDate}
                            min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                            onChange={(e) => setPaymentDueDate(e.target.value)}
                          />
                        </div>


                        <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                          <div className="flex justify-between text-sm">
                            <span>Remaining Amount:</span>
                            <span className="font-bold text-warning">₹{remainingAmount}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Due on {format(new Date(paymentDueDate), 'dd MMM yyyy')}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Switch
                            id="send-reminders"
                            checked={sendReminders}
                            onCheckedChange={setSendReminders}
                          />
                          <Label htmlFor="send-reminders" className="text-sm cursor-pointer">
                            Send payment reminders (3 days before, on due date, 3 days after)
                          </Label>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Payment Method (back-office only — members always pay via Razorpay) */}
              {!isMemberMode ? (
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="wallet">Wallet</SelectItem>
                      <SelectItem value="razorpay_link">🔗 Send Payment Link</SelectItem>
                    </SelectContent>
                  </Select>

                  {showTransactionField && (
                    <div className="space-y-2 pt-2">
                      <Label htmlFor="purchase-transaction-id">
                        {paymentMethod === 'bank_transfer' ? 'UTR / Reference Number' : 'Transaction / UTR ID'}
                      </Label>
                      <Input
                        id="purchase-transaction-id"
                        value={transactionId}
                        onChange={(e) => setTransactionId(e.target.value)}
                        placeholder={
                          paymentMethod === 'upi'
                            ? 'e.g., 412345678901 (UPI ref)'
                            : paymentMethod === 'bank_transfer'
                              ? 'e.g., NEFT/RTGS UTR number'
                              : 'e.g., card auth / approval code'
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional but recommended — this reference shows on the Payments page and the
                        invoice payment history, exactly like Record Payment.
                      </p>
                    </div>
                  )}
                </div>

              ) : (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="flex items-center gap-3 pt-4">
                    <img src="/assets/payment-logos/razorpay.svg" alt="Razorpay" className="h-6" />
                    <div className="text-sm">
                      <p className="font-medium">Secure online payment</p>
                      <p className="text-xs text-muted-foreground">UPI, Cards, Net Banking & Wallets via Razorpay</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => purchaseMembership.mutate()}
              disabled={!selectedPlanId || purchaseMembership.isPending || (!canRenew && !advanceBooking)}
            >
              {purchaseMembership.isPending
                ? 'Processing...'
                : (!canRenew && !advanceBooking)
                  ? 'Cannot Purchase Yet'
                  : advanceBooking
                    ? 'Schedule & Collect Payment'
                    : isMemberMode
                      ? 'Pay Now'
                      : 'Complete Purchase'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
