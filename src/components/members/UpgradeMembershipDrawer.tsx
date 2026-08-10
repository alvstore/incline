import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { ArrowUpCircle, IndianRupee, Loader2, Calendar, Info } from 'lucide-react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

import { supabase } from '@/integrations/supabase/client';
import { usePlans } from '@/hooks/usePlans';
import { useGstRates } from '@/hooks/useGstRates';
import { upgradeMembership } from '@/services/membershipActionsService';
import { membershipEndDate, daysRemaining } from '@/lib/memberships/duration';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { normalizePaymentMethod } from '@/lib/payments/normalizePaymentMethod';
import { MemberIdentityHeader } from '@/components/members/MemberIdentityHeader';

interface UpgradeMembershipDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently active membership row (with membership_plans joined when available). */
  membership: any;
  memberId: string;
  memberName?: string;
  branchId: string;
}

const inr = (n: number) =>
  `₹${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function UpgradeMembershipDrawer({
  open,
  onOpenChange,
  membership,
  memberId,
  memberName,
  branchId,
}: UpgradeMembershipDrawerProps) {
  const queryClient = useQueryClient();
  const { data: plans = [] } = usePlans(branchId);
  const { data: gstRates = [5, 12, 18, 28] } = useGstRates();

  const [newPlanId, setNewPlanId] = useState('');
  const [reason, setReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [includeGst, setIncludeGst] = useState(false);
  const [gstRate, setGstRate] = useState(5);
  const [payNow, setPayNow] = useState(true);
  const [amountPaying, setAmountPaying] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [sendReminders, setSendReminders] = useState(true);
  const [selectedLockerId, setSelectedLockerId] = useState('');


  // Mirrors the server: the invoice that carries this membership + its gifted days.
  const { data: ledger } = useQuery({
    queryKey: ['membership-upgrade-ledger', membership?.id],
    enabled: open && !!membership?.id,
    queryFn: async () => {
      const [{ data: items, error: itemsErr }, { data: gifts, error: giftsErr }] = await Promise.all([
        supabase
          .from('invoice_items')
          .select('invoice_id, invoices!inner(id, invoice_number, amount_paid, total_amount, status, created_at)')
          .eq('reference_id', membership!.id)
          .in('reference_type', ['membership', 'admission_fee']),
        supabase
          .from('membership_free_days')
          .select('days_added')
          .eq('membership_id', membership!.id),
      ]);
      if (itemsErr) throw itemsErr;
      if (giftsErr) throw giftsErr;

      const invoices = (items || [])
        .map((r: any) => r.invoices)
        .filter((i: any) => i && i.status !== 'cancelled')
        .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));

      return {
        invoice: invoices[0] || null,
        giftDays: (gifts || []).reduce((s: number, g: any) => s + Number(g.days_added || 0), 0),
      };
    },
  });

  const currentPlan = membership?.membership_plans;
  const currentPrice = Number(membership?.price_paid ?? 0);
  const credit = Math.max(Number(ledger?.invoice?.amount_paid ?? 0), 0);


  // Only plans worth more than the credit already paid can be upgraded into.
  const upgradablePlans = useMemo(
    () =>
      (plans as any[])
        .filter((p) => p.id !== membership?.plan_id)
        .filter((p) => Number(p.discounted_price ?? p.price ?? 0) > credit)
        .sort((a, b) => Number(a.discounted_price ?? a.price ?? 0) - Number(b.discounted_price ?? b.price ?? 0)),
    [plans, membership?.plan_id, credit],
  );

  const newPlan = upgradablePlans.find((p) => p.id === newPlanId);
  const listPrice = Number(newPlan?.discounted_price ?? newPlan?.price ?? 0);
  const maxDiscount = Math.max(listPrice - credit, 0);
  const newGross = Math.max(listPrice - Math.min(Math.max(discountAmount, 0), listPrice), 0);

  // Locker parity with the purchase flow: only offered when the new plan includes one.
  const hasLockerBenefit = newPlan?.plan_benefits?.some(
    (b: any) => b.benefit_type === 'locker_access' || String(b.benefit_type || '').includes('locker'),
  );
  const { data: availableLockers = [] } = useQuery({
    queryKey: ['available-lockers', branchId],
    enabled: open && !!branchId && !!hasLockerBenefit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lockers')
        .select('id, locker_number, size')
        .eq('branch_id', branchId)
        .eq('status', 'available')
        .order('locker_number');
      if (error) throw error;
      return data || [];
    },
  });

  const taxAmount = useMemo(() => {
    if (!includeGst || !newPlan || !gstRate) return 0;
    const isInclusive = newPlan.is_gst_inclusive !== false;
    if (isInclusive) {
      const taxable = Math.round((newGross / (1 + gstRate / 100)) * 100) / 100;
      return Math.round((newGross - taxable) * 100) / 100;
    }
    return Math.round(newGross * (gstRate / 100) * 100) / 100;
  }, [includeGst, newPlan, gstRate, newGross]);

  const newTotal = useMemo(() => {
    if (!newPlan) return 0;
    const isInclusive = newPlan.is_gst_inclusive !== false;
    return !includeGst || isInclusive ? newGross : newGross + taxAmount;
  }, [newPlan, includeGst, newGross, taxAmount]);

  const balanceDue = Math.max(newTotal - credit, 0);

  const newEnd = useMemo(() => {
    if (!newPlan || !membership?.start_date) return null;
    const base = membershipEndDate(membership.start_date, Number(newPlan.duration_days ?? 0));
    const carried = Number(ledger?.giftDays ?? 0) + Number(membership?.total_freeze_days_used ?? 0);
    return new Date(base.getTime() + carried * 86400000);
  }, [newPlan, membership?.start_date, ledger?.giftDays, membership?.total_freeze_days_used]);


  const daysUsed = membership?.start_date
    ? Math.max(differenceInCalendarDays(new Date(), parseISO(String(membership.start_date))), 0)
    : 0;

  useEffect(() => {
    if (open) {
      setNewPlanId('');
      setReason('');
      setPaymentMethod('cash');
      setIncludeGst(false);
      setGstRate(5);
      setPayNow(true);
      setAmountPaying(0);
      setDiscountAmount(0);
      setDiscountReason('');
      setSendReminders(true);
      setSelectedLockerId('');
    }
  }, [open]);

  // Default the GST rate to whatever the chosen plan is configured with (5% for
  // most fitness plans) instead of a hardcoded 18%.
  useEffect(() => {
    if (newPlan?.gst_rate) setGstRate(Number(newPlan.gst_rate));
  }, [newPlan?.gst_rate]);


  useEffect(() => {
    setAmountPaying(balanceDue);
  }, [balanceDue]);

  const upgrade = useMutation({
    mutationFn: async () => {
      if (!newPlanId) throw new Error('Select the plan to upgrade to');
      if (discountAmount > maxDiscount) {
        throw new Error(`Discount cannot exceed ${inr(maxDiscount)} — the new plan must stay above the credit already paid`);
      }
      if (discountAmount > 0 && !discountReason.trim()) {
        throw new Error('Add a reason for the discount');
      }
      if (payNow && amountPaying > balanceDue) {
        throw new Error('Amount collected cannot exceed the balance due');
      }
      return upgradeMembership({
        membershipId: membership.id,
        newPlanId,
        reason: reason.trim() || undefined,
        paymentMethod: normalizePaymentMethod(paymentMethod),
        amountPaying: payNow ? amountPaying : 0,
        includeGst,
        gstRate: includeGst ? gstRate : 0,
        discountAmount,
        discountReason: discountReason.trim() || undefined,
        sendReminders,
        assignLockerId: hasLockerBenefit && selectedLockerId ? selectedLockerId : null,
        idempotencyKey: `upgrade:${membership?.id}:${newPlanId}:${newTotal}`,
      });
    },
    onSuccess: (res: any) => {
      toast.success(
        `Upgraded to ${newPlan?.name}. Credit ${inr(Number(res?.credit_applied ?? credit))} applied · balance ${inr(Number(res?.balance_due ?? 0))}`,
      );
      invalidateMembersData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['member-pending-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['member-details', memberId] });
      queryClient.invalidateQueries({ queryKey: ['active-membership'] });
      queryClient.invalidateQueries({ queryKey: ['lockers'] });
      queryClient.invalidateQueries({ queryKey: ['available-lockers'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Upgrade failed'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-indigo-600" />
            Upgrade Membership
          </SheetTitle>
          <SheetDescription>
            {memberName ? `${memberName} — ` : ''}move to a higher plan. The joining date stays the same and
            everything already paid becomes credit on the same invoice.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <MemberIdentityHeader
            memberId={memberId}
            memberName={memberName}
            subtitle={currentPlan?.name ? `On ${currentPlan.name}` : undefined}
          />

          {/* Current plan */}
          <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
            <CardContent className="pt-5 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current plan</p>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">{currentPlan?.name || 'Current membership'}</span>
                <span className="text-sm text-slate-600">{inr(currentPrice)}</span>
              </div>
              <div className="text-xs text-slate-500">
                {membership?.start_date && (
                  <>
                    Started {format(parseISO(String(membership.start_date)), 'dd MMM yyyy')} · {daysUsed} day
                    {daysUsed === 1 ? '' : 's'} used ·{' '}
                    {Math.max(daysRemaining(membership?.end_date) ?? 0, 0)} left
                  </>
                )}
              </div>
              <div className="text-xs font-medium text-emerald-700">
                Credit available: {inr(credit)} (already paid
                {ledger?.invoice?.invoice_number ? ` on ${ledger.invoice.invoice_number}` : ''})

              </div>
            </CardContent>
          </Card>

          {/* New plan */}
          <div className="space-y-2">
            <Label htmlFor="upgrade-plan">Upgrade to</Label>
            <Select value={newPlanId} onValueChange={setNewPlanId}>
              <SelectTrigger id="upgrade-plan" className="min-h-[44px]">
                <SelectValue placeholder="Select a higher plan" />
              </SelectTrigger>
              <SelectContent>
                {upgradablePlans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {inr(Number(p.discounted_price ?? p.price ?? 0))} · {p.duration_days}d
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {upgradablePlans.length === 0 && (
              <p className="text-xs text-slate-500">
                No plan priced above the {inr(credit)} already paid. Downgrades are handled through cancel + repurchase.
              </p>
            )}
          </div>

          {/* Discount — same controls as the purchase flow */}
          {newPlan && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="upgrade-discount">Discount</Label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="upgrade-discount"
                    type="number"
                    min={0}
                    max={maxDiscount}
                    className="pl-9 min-h-[44px]"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(Math.max(Number(e.target.value) || 0, 0))}
                  />
                </div>
                <p className="text-xs text-slate-500">Max {inr(maxDiscount)} (must stay above the paid credit)</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="upgrade-discount-reason">Discount reason</Label>
                <Input
                  id="upgrade-discount-reason"
                  className="min-h-[44px]"
                  placeholder="e.g. Festive offer"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  disabled={discountAmount <= 0}
                />
              </div>
            </div>
          )}

          {/* Complimentary locker (plan must include one) */}
          {newPlan && hasLockerBenefit && (
            <div className="space-y-2 rounded-xl bg-slate-50 px-4 py-3">
              <Label htmlFor="upgrade-locker" className="flex items-center gap-2 text-sm">
                <Lock className="h-4 w-4 text-indigo-600" />
                Complimentary locker
              </Label>
              <Select
                value={selectedLockerId || 'none'}
                onValueChange={(v) => setSelectedLockerId(v === 'none' ? '' : v)}
              >
                <SelectTrigger id="upgrade-locker" className="min-h-[44px] bg-white">
                  <SelectValue placeholder="Select a locker (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No locker needed</SelectItem>
                  {availableLockers.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.locker_number}
                      {l.size ? ` (${l.size})` : ''}
                    </SelectItem>
                  ))}
                  {availableLockers.length === 0 && (
                    <SelectItem value="no-lockers" disabled>
                      No lockers available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* GST */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <div>
              <Label htmlFor="upgrade-gst" className="text-sm">Tax invoice (GST)</Label>
              <p className="text-xs text-slate-500">Recomputes GST on the revised total</p>
            </div>
            <div className="flex items-center gap-3">
              {includeGst && (
                <Select value={String(gstRate)} onValueChange={(v) => setGstRate(Number(v))}>
                  <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {gstRates.map((r) => (
                      <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Switch id="upgrade-gst" checked={includeGst} onCheckedChange={setIncludeGst} />
            </div>
          </div>

          {/* Breakdown */}
          {newPlan && (
            <Card className="rounded-2xl border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg">
              <CardContent className="pt-5 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/80">{newPlan.name} ({newPlan.duration_days} days)</span>
                  <span className="font-semibold">{inr(newGross)}</span>
                </div>
                {includeGst && taxAmount > 0 && (
                  <div className="flex justify-between text-white/80">
                    <span>GST @ {gstRate}%{newPlan.is_gst_inclusive !== false ? ' (inclusive)' : ''}</span>
                    <span>{inr(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-white/80">Revised invoice total</span>
                  <span className="font-semibold">{inr(newTotal)}</span>
                </div>
                <div className="flex justify-between text-emerald-200">
                  <span>Less: upgrade credit ({currentPlan?.name || 'current plan'})</span>
                  <span>− {inr(credit)}</span>
                </div>
                <Separator className="bg-white/20" />
                <div className="flex justify-between text-lg font-bold">
                  <span>Member pays</span>
                  <span>{inr(balanceDue)}</span>
                </div>
                <div className="flex items-center gap-2 pt-1 text-xs text-white/80">
                  <Calendar className="h-3.5 w-3.5" />
                  {membership?.start_date && newEnd && (
                    <>
                      {format(parseISO(String(membership.start_date)), 'dd MMM yyyy')} →{' '}
                      {format(newEnd, 'dd MMM yyyy')} · {Math.max(daysRemaining(newEnd) ?? 0, 0)} days remaining
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Collection */}
          {newPlan && balanceDue > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <Label htmlFor="upgrade-paynow" className="text-sm">Collect payment now</Label>
                <Switch id="upgrade-paynow" checked={payNow} onCheckedChange={setPayNow} />
              </div>
              {payNow && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="upgrade-amount">Amount collected</Label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="upgrade-amount"
                        type="number"
                        min={0}
                        max={balanceDue}
                        className="pl-9 min-h-[44px]"
                        value={amountPaying}
                        onChange={(e) => setAmountPaying(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="upgrade-method">Payment method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger id="upgrade-method" className="min-h-[44px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="upgrade-reason">Reason / note</Label>
            <Textarea
              id="upgrade-reason"
              placeholder="e.g. Member upgraded from Monthly to Annual on request"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <Alert className="rounded-xl">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              The original invoice keeps its number. Its line items are replaced with the new plan plus an
              upgrade-credit line, and everything already paid stays on the invoice as paid.
            </AlertDescription>
          </Alert>

          <div className="flex gap-2 pb-6">
            <Button variant="outline" className="flex-1 min-h-[44px]" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 min-h-[44px]"
              disabled={!newPlanId || !ledger?.invoice || upgrade.isPending}
              onClick={() => upgrade.mutate()}
            >
              {upgrade.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm upgrade
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
