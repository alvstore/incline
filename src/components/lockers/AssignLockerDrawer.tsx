import { useState, useEffect, useRef, useMemo } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { lockerService } from '@/services/lockerService';
import { recordPayment } from '@/services/billingService';
import { useLockerPricing } from '@/hooks/useLockerPricing';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Receipt, Gift, Link2, Loader2, Check, Percent, IndianRupee, Key } from 'lucide-react';
import { usePageEntrance, useRowsEntrance } from '@/components/motion/pageMotion';
import { quoteLockerAssignment, validateLockerAssignment, type LockerPriceMode, type DiscountKind } from '@/lib/lockers/assignPricing';

interface AssignLockerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locker: any;
  branchId: string;
}

const MODES: { value: LockerPriceMode; label: string; hint: string }[] = [
  { value: 'standard', label: 'Set price', hint: 'Branch price' },
  { value: 'discount', label: 'Discount', hint: 'Reason needed' },
  { value: 'complimentary', label: 'Free', hint: 'Reason needed' },
];

const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function AssignLockerDrawer({ open, onOpenChange, locker, branchId }: AssignLockerDrawerProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: pricing, isLoading: pricingLoading } = useLockerPricing(open ? branchId : null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [assignMonths, setAssignMonths] = useState(1);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [planIncluded, setPlanIncluded] = useState(false);
  const [checkingPlan, setCheckingPlan] = useState(false);
  const [mode, setMode] = useState<LockerPriceMode>('standard');
  const [discountKind, setDiscountKind] = useState<DiscountKind>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [reason, setReason] = useState('');
  const [collectNow, setCollectNow] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [syncWithMembership, setSyncWithMembership] = useState(true);
  const [membershipEndDate, setMembershipEndDate] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  usePageEntrance(bodyRef);
  useRowsEntrance(listRef, `${searchResults.map((r) => r.id).join(',')}`);

  const size: 'Medium' | 'Large' = String(locker?.size || '').toLowerCase() === 'large' ? 'Large' : 'Medium';
  const listFee = Number(size === 'Large' ? pricing?.large_fee : pricing?.medium_fee) || 0;
  const gstRate = pricing?.gst_enabled ? Number(pricing?.gst_rate) || 0 : 0;

  const input = { listFee, gstRate, mode, discountKind, discountValue: Number(discountValue) || 0, planIncluded };
  const quote = useMemo(() => quoteLockerAssignment(input), [listFee, gstRate, mode, discountKind, discountValue, planIncluded]); // eslint-disable-line react-hooks/exhaustive-deps
  const error = validateLockerAssignment({ ...input, reason });

  useEffect(() => {
    const q = memberSearch.trim();
    if (q.length < 2 || !branchId) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const digits = q.replace(/\D/g, '');
        const { data, error: e } = await supabase.rpc('search_members', {
          search_term: digits.length >= 10 ? digits.slice(-10) : q, p_branch_id: branchId, p_limit: 10,
        });
        if (e) throw e;
        setSearchResults(((data || []) as any[]).map((m) => ({
          id: m.id, member_code: m.member_code, full_name: m.full_name, phone: m.phone ?? null,
        })));
      } catch { toast.error('Could not search members'); }
      finally { setIsSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [memberSearch, branchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedMember) { setPlanIncluded(false); setMembershipEndDate(null); return; }
      setCheckingPlan(true);
      try {
        const { data: ms } = await supabase.from('memberships')
          .select('id, end_date, membership_plans!inner(includes_free_locker, free_locker_size)')
          .eq('member_id', selectedMember.id).eq('status', 'active')
          .gte('end_date', new Date().toISOString().split('T')[0])
          .order('end_date', { ascending: false }).limit(1).maybeSingle();
        if (cancelled) return;
        setMembershipEndDate(ms?.end_date ?? null);
        const plan = ms?.membership_plans as any;
        const planSize = plan?.free_locker_size;
        setPlanIncluded(!!plan?.includes_free_locker && (!planSize || planSize === size.toLowerCase()));
      } catch { if (!cancelled) { setPlanIncluded(false); setMembershipEndDate(null); } }
      finally { if (!cancelled) setCheckingPlan(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedMember, size]);

  const effectiveEndDate = syncWithMembership && membershipEndDate
    ? membershipEndDate
    : new Date(Date.now() + assignMonths * 30 * 86400000).toISOString().split('T')[0];

  const resetForm = () => {
    setSelectedMember(null); setSearchResults([]); setMemberSearch(''); setAssignMonths(1);
    setPlanIncluded(false); setMode('standard'); setDiscountValue(''); setReason('');
    setCollectNow(false); setPaymentMethod('cash'); setSyncWithMembership(true);
    setMembershipEndDate(null); setTouched(false);
  };

  const handleAssign = async () => {
    setTouched(true);
    if (!selectedMember || !locker || !branchId || error) return;
    setIsAssigning(true);
    try {
      const result = await lockerService.assignLocker({
        locker_id: locker.id, member_id: selectedMember.id,
        start_date: new Date().toISOString().split('T')[0], end_date: effectiveEndDate,
        fee_amount: quote.taxable, billing_months: 1, chargeable: quote.taxable > 0,
        gst_rate: gstRate, received_by: user?.id,
        assign_source: planIncluded ? 'plan' : 'addon',
      });

      const why = reason.trim();
      if (!planIncluded && mode !== 'standard') {
        const note = mode === 'complimentary'
          ? `Complimentary locker (list ${fmt(quote.list)}). Reason: ${why}`
          : `Locker discount ${fmt(quote.discount)} off list ${fmt(quote.list)}. Reason: ${why}`;
        if (result.invoice_id) await supabase.from('invoices').update({ notes: note }).eq('id', result.invoice_id);
        await supabase.from('audit_logs').insert({
          branch_id: branchId, user_id: user?.id ?? null,
          action: mode === 'complimentary' ? 'locker_complimentary' : 'locker_discount',
          table_name: 'locker_assignments', record_id: result.assignment_id,
          new_values: { locker: locker.locker_number, member_id: selectedMember.id, list_fee: quote.list, discount: quote.discount, taxable: quote.taxable, reason: why },
        } as never);
      }

      if (quote.total > 0 && result.invoice_id && collectNow) {
        try {
          await recordPayment({ branchId, invoiceId: result.invoice_id, memberId: selectedMember.id, amount: quote.total, paymentMethod, notes: `Locker ${locker.locker_number} rental` });
          toast.success(`Locker ${locker.locker_number} assigned · ${fmt(quote.total)} collected`);
        } catch (e: any) { toast.error(e?.message || 'Locker assigned, but the payment could not be recorded'); }
      } else if (quote.total > 0) {
        toast.success(`Locker ${locker.locker_number} assigned · bill of ${fmt(quote.total)} created`);
      } else {
        toast.success(planIncluded ? 'Locker assigned (included in plan)' : 'Locker assigned free of charge');
      }

      ['lockers', 'locker-assignments', 'invoices', 'payments'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false); resetForm();
    } catch (e: any) {
      toast.error(String(e?.message || '').includes('LOCKER_TAKEN') ? 'This locker was just taken by someone else.' : 'Could not assign locker');
    } finally { setIsAssigning(false); }
  };

  if (!locker) return null;
  const roomLabel = locker.gender_zone === 'male' ? 'Male room' : locker.gender_zone === 'female' ? 'Female room' : 'Common area';
  const showError = touched && !!error;

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-2 border-b border-border p-6 text-left">
          <SheetTitle className="flex items-center gap-2"><Key className="h-5 w-5 text-primary" aria-hidden />Assign locker {locker.locker_number}</SheetTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{roomLabel}</Badge>
            <Badge variant="secondary">{size}</Badge>
            {locker.location && <Badge variant="outline">{locker.location}</Badge>}
          </div>
          <SheetDescription>Pick a member. The price comes from your locker pricing; give a discount or make it free with a reason.</SheetDescription>
        </SheetHeader>

        <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto p-6">
          <section data-anim="card" className="space-y-2">
            <Label htmlFor="locker-member-search">Member</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="locker-member-search" placeholder="Name, code, phone or email" value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)} className="h-11 rounded-xl pl-10" autoComplete="off" />
              {isSearching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />}
            </div>
            <div ref={listRef} className="space-y-2" aria-live="polite">
              {isSearching && !searchResults.length && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
              {searchResults.map((m) => {
                const active = selectedMember?.id === m.id;
                return (
                  <button type="button" key={m.id} data-anim="row" aria-pressed={active} onClick={() => setSelectedMember(m)}
                    className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`}>
                    <span>
                      <span className="block font-medium">{m.full_name || 'Unknown'}</span>
                      <span className="text-sm text-muted-foreground">{m.member_code}{m.phone ? ` · ${m.phone}` : ''}</span>
                    </span>
                    {active && <Check className="h-4 w-4 text-primary" aria-hidden />}
                  </button>
                );
              })}
              {memberSearch.trim().length >= 2 && !isSearching && !searchResults.length && (
                <p className="rounded-xl bg-muted p-3 text-center text-sm text-muted-foreground">No members found for “{memberSearch}”</p>
              )}
            </div>
          </section>

          {selectedMember && (
            <section data-anim="card" className="space-y-3 rounded-2xl bg-muted/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{selectedMember.full_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedMember.member_code}</p>
                </div>
                {checkingPlan ? <Skeleton className="h-6 w-24 rounded-full" /> : planIncluded && (
                  <Badge variant="outline" className="border-success/30 text-success"><Gift className="mr-1 h-3 w-3" aria-hidden />In plan</Badge>
                )}
              </div>
              {membershipEndDate ? (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="locker-sync" className="flex items-center gap-2 text-sm font-normal">
                    <Link2 className="h-4 w-4" aria-hidden />Until membership ends ({fmtDate(membershipEndDate)})
                  </Label>
                  <Switch id="locker-sync" checked={syncWithMembership} onCheckedChange={setSyncWithMembership} />
                </div>
              ) : <p className="text-sm text-warning">No active membership found — choose a duration.</p>}
              {(!syncWithMembership || !membershipEndDate) && (
                <div className="space-y-1.5">
                  <Label htmlFor="locker-duration">Duration</Label>
                  <Select value={String(assignMonths)} onValueChange={(v) => setAssignMonths(Number(v))}>
                    <SelectTrigger id="locker-duration" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 3, 6, 12].map((m) => <SelectItem key={m} value={String(m)}>{m} month{m > 1 ? 's' : ''}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </section>
          )}

          {!planIncluded && (
            <section data-anim="card" className="space-y-3">
              <Label id="locker-price-mode">Price</Label>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="locker-price-mode">
                {MODES.map((m) => (
                  <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)}
                    className={`min-h-[56px] rounded-xl border p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === m.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/50'}`}>
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
                  </button>
                ))}
              </div>

              {mode === 'discount' && (
                <div className="flex gap-2">
                  <div className="flex rounded-xl border border-border p-1" role="group" aria-label="Discount type">
                    <Button type="button" size="sm" variant={discountKind === 'percent' ? 'default' : 'ghost'} aria-pressed={discountKind === 'percent'} aria-label="Percent" onClick={() => setDiscountKind('percent')}><Percent className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant={discountKind === 'flat' ? 'default' : 'ghost'} aria-pressed={discountKind === 'flat'} aria-label="Rupees" onClick={() => setDiscountKind('flat')}><IndianRupee className="h-4 w-4" /></Button>
                  </div>
                  <Input type="number" inputMode="decimal" min={0} aria-label={discountKind === 'percent' ? 'Discount percent' : 'Discount in rupees'}
                    placeholder={discountKind === 'percent' ? 'e.g. 10' : 'e.g. 500'} value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)} className="h-11 rounded-xl" />
                </div>
              )}

              {mode !== 'standard' && (
                <div className="space-y-1.5">
                  <Label htmlFor="locker-reason">Reason <span className="text-destructive">*</span></Label>
                  <Textarea id="locker-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-required="true"
                    aria-invalid={showError} aria-describedby={showError ? 'locker-error' : undefined}
                    placeholder={mode === 'complimentary' ? 'e.g. Founder guest, service recovery' : 'e.g. Annual member offer approved by manager'} />
                  <p className="text-xs text-muted-foreground">Saved on the bill’s internal note and the audit log.</p>
                </div>
              )}
            </section>
          )}

          <section data-anim="card" className="space-y-2 rounded-2xl bg-muted p-4 text-sm tabular-nums" aria-live="polite">
            {pricingLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading price"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-6 w-1/2" /></div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">{size} locker price</span><span className={quote.discount ? 'line-through text-muted-foreground' : 'font-medium'}>{fmt(quote.list)}</span></div>
                {quote.discount > 0 && <div className="flex justify-between text-success"><span>{planIncluded ? 'Included in plan' : mode === 'complimentary' ? 'Complimentary' : 'Discount'}</span><span>−{fmt(quote.discount)}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">GST ({gstRate}%)</span><span>{fmt(quote.gst)}</span></div>
                <div className="flex items-center justify-between border-t border-border pt-2"><span className="text-muted-foreground">Total</span><span className="text-xl font-bold">{fmt(quote.total)}</span></div>
                <p className="text-xs text-muted-foreground"><Receipt className="mr-1 inline h-3 w-3" aria-hidden />
                  {quote.total > 0 ? `One bill for ${fmtDate(new Date().toISOString())} – ${fmtDate(effectiveEndDate)}` : 'No bill will be created'}
                </p>
              </>
            )}
          </section>

          {quote.total > 0 && (
            <section data-anim="card" className="space-y-3 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="locker-collect" className="text-sm">Collect payment now</Label>
                <Switch id="locker-collect" checked={collectNow} onCheckedChange={setCollectNow} />
              </div>
              {collectNow && (
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger aria-label="Payment method" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="wallet">Wallet</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </section>
          )}

          {showError && <p id="locker-error" role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-border bg-background p-4 pb-safe">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={handleAssign} disabled={!selectedMember || isAssigning || pricingLoading || checkingPlan}>
            {isAssigning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {quote.total > 0 ? `Assign & bill ${fmt(quote.total)}` : 'Assign locker'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
