import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { lockerService } from '@/services/lockerService';
import { recordPayment } from '@/services/billingService';
import { toast } from 'sonner';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Search, Receipt, Gift, CheckCircle, CreditCard, Link2 } from 'lucide-react';

interface AssignLockerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locker: any;
  branchId: string;
}

export function AssignLockerDrawer({ open, onOpenChange, locker, branchId }: AssignLockerDrawerProps) {
  const queryClient = useQueryClient();
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [assignMonths, setAssignMonths] = useState(1);
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [memberHasFreeLocker, setMemberHasFreeLocker] = useState(false);
  const [checkingPlan, setCheckingPlan] = useState(false);
  const [isChargeable, setIsChargeable] = useState(false);
  const [rentalFee, setRentalFee] = useState(500);
  const [chargeGst, setChargeGst] = useState(true);
  const [collectNow, setCollectNow] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [syncWithMembership, setSyncWithMembership] = useState(true);
  const [membershipEndDate, setMembershipEndDate] = useState<string | null>(null);

  // Resolved GST rate for locker rentals (branch override → org default).
  const { data: lockerGstRate } = useQuery({
    queryKey: ['locker-gst-rate', locker?.id, branchId],
    enabled: open && !!locker?.id && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resolve_gst_rate' as never, {
        p_item_type: 'locker',
        p_item_id: locker.id,
        p_branch_id: branchId,
      } as never);
      if (error) throw error;
      return Number(data ?? 18);
    },
  });


  const handleMemberSearch = async () => {
    if (!memberSearch.trim() || !branchId) return;
    
    setIsSearching(true);
    try {
      const { data: membersByCode } = await supabase
        .from('members')
        .select(`
          id,
          member_code,
          user_id,
          profiles:user_id (full_name, email, phone)
        `)
        .eq('branch_id', branchId)
        .ilike('member_code', `%${memberSearch}%`)
        .limit(10);

      const { data: membersByProfile } = await supabase
        .from('members')
        .select(`
          id,
          member_code,
          user_id,
          profiles:user_id (full_name, email, phone)
        `)
        .eq('branch_id', branchId)
        .not('user_id', 'is', null)
        .limit(50);

      const searchLower = memberSearch.toLowerCase();
      const filteredByProfile = (membersByProfile || []).filter((m) => {
        const profile = m.profiles as any;
        if (!profile) return false;
        return (
          (profile.full_name?.toLowerCase().includes(searchLower)) ||
          (profile.email?.toLowerCase().includes(searchLower)) ||
          (profile.phone?.includes(memberSearch))
        );
      });

      const allResults = [...(membersByCode || []), ...filteredByProfile];
      const uniqueResults = allResults.filter(
        (member, index, self) => index === self.findIndex((m) => m.id === member.id)
      ).slice(0, 10);

      setSearchResults(uniqueResults);
    } catch (error) {
      toast.error('Failed to search members');
    } finally {
      setIsSearching(false);
    }
  };

  // Check member plan + fetch membership end date
  useEffect(() => {
    async function checkMemberPlan() {
      if (!selectedMember) {
        setMemberHasFreeLocker(false);
        setMembershipEndDate(null);
        return;
      }
      
      setCheckingPlan(true);
      try {
        const { data: membership } = await supabase
          .from('memberships')
          .select(`
            id,
            end_date,
            membership_plans!inner(
              includes_free_locker,
              free_locker_size
            )
          `)
          .eq('member_id', selectedMember.id)
          .eq('status', 'active')
          .gte('end_date', new Date().toISOString().split('T')[0])
          .order('end_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (membership) {
          setMembershipEndDate(membership.end_date);
          const plan = membership.membership_plans as any;
          const hasFreeLocker = plan?.includes_free_locker === true;
          
          if (hasFreeLocker) {
            const planSize = plan?.free_locker_size;
            const lockerSize = locker?.size?.toLowerCase();
            setMemberHasFreeLocker(!planSize || !lockerSize || planSize === lockerSize);
          } else {
            setMemberHasFreeLocker(false);
          }
        } else {
          setMemberHasFreeLocker(false);
          setMembershipEndDate(null);
        }
      } catch (error) {
        setMemberHasFreeLocker(false);
        setMembershipEndDate(null);
      } finally {
        setCheckingPlan(false);
      }
    }
    
    checkMemberPlan();
  }, [selectedMember, locker]);

  const handleAssignLocker = async () => {
    if (!selectedMember || !locker || !branchId) return;

    setIsAssigning(true);
    try {
      const startDate = new Date().toISOString().split('T')[0];
      let endDate: string;

      if (syncWithMembership && membershipEndDate) {
        endDate = membershipEndDate;
      } else {
        endDate = new Date(Date.now() + assignMonths * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }

      // Flat fee for the whole assignment period (no monthly multiplication).
      const feeAmount = memberHasFreeLocker ? 0 : (isChargeable ? rentalFee : 0);
      const appliedGstRate = chargeGst ? Number(lockerGstRate ?? 18) : 0;

      const result = await lockerService.assignLocker({
        locker_id: locker.id,
        member_id: selectedMember.id,
        start_date: startDate,
        end_date: endDate,
        fee_amount: feeAmount,
        billing_months: 1,
        chargeable: feeAmount > 0,
        gst_rate: appliedGstRate,
        assign_source: memberHasFreeLocker ? 'plan' : 'addon',
      });

      if (feeAmount > 0 && result.invoice_id) {
        const payable = Math.round(feeAmount * (1 + appliedGstRate / 100) * 100) / 100;
        if (collectNow) {
          try {
            await recordPayment({
              branchId,
              invoiceId: result.invoice_id,
              memberId: selectedMember.id,
              amount: payable,
              paymentMethod,
              notes: `Locker ${locker.locker_number} rental`,
            });
            toast.success(`Locker assigned · ₹${payable} collected (${paymentMethod})`);
          } catch (e: any) {
            toast.error(e?.message || 'Locker assigned but payment could not be recorded');
          }
        } else {
          toast.success(`Locker assigned and invoice of ₹${payable} created`);
        }
      } else if (memberHasFreeLocker) {
        toast.success('Locker assigned (included in membership plan)');
      } else {
        toast.success('Locker assigned (free)');
      }

      queryClient.invalidateQueries({ queryKey: ['lockers'] });
      queryClient.invalidateQueries({ queryKey: ['locker-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast.error('Failed to assign locker');
    } finally {
      setIsAssigning(false);
    }
  };

  const resetForm = () => {
    setSelectedMember(null);
    setSearchResults([]);
    setMemberSearch('');
    setAssignMonths(1);
    setMemberHasFreeLocker(false);
    setIsChargeable(false);
    setRentalFee(500);
    setChargeGst(true);
    setCollectNow(false);
    setPaymentMethod('cash');
    setSyncWithMembership(true);
    setMembershipEndDate(null);
  };

  if (!locker) return null;

  const effectivelyFree = memberHasFreeLocker || !isChargeable;
  const effectiveEndDate = syncWithMembership && membershipEndDate
    ? membershipEndDate
    : new Date(Date.now() + assignMonths * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const totalAmount = effectivelyFree ? 0 : rentalFee;
  const gstRate = chargeGst ? Number(lockerGstRate ?? 18) : 0;
  const gstAmount = Math.round(totalAmount * (gstRate / 100) * 100) / 100;
  const grandTotal = Math.round((totalAmount + gstAmount) * 100) / 100;


  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Assign Locker {locker.locker_number}</SheetTitle>
          <SheetDescription>
            Assign this locker to a member. Configure rental charges below.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Member Search */}
          <div className="space-y-2">
            <Label>Search Member</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Name, code, phone, or email"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleMemberSearch()}
                  className="pl-10"
                />
              </div>
              <Button variant="outline" onClick={handleMemberSearch} disabled={isSearching}>
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Search Results ({searchResults.length})</Label>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {searchResults.map((member) => {
                  const profile = member.profiles as any;
                  return (
                    <div
                      key={member.id}
                      onClick={() => setSelectedMember(member)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedMember?.id === member.id ? 'border-accent bg-accent/10' : 'hover:bg-muted/50'
                      }`}
                    >
                      <p className="font-medium">{profile?.full_name || 'Unknown'}</p>
                      <div className="flex gap-2 text-sm text-muted-foreground">
                        <span>{member.member_code}</span>
                        {profile?.phone && <span>• {profile.phone}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No Results Message */}
          {memberSearch && searchResults.length === 0 && !isSearching && (
            <div className="p-4 rounded-lg bg-muted text-center">
              <p className="text-sm text-muted-foreground">No members found matching "{memberSearch}"</p>
            </div>
          )}

          {/* Selected Member */}
          {selectedMember && (
            <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
              <p className="font-medium">Selected: {(selectedMember.profiles as any)?.full_name}</p>
              <p className="text-sm text-muted-foreground">{selectedMember.member_code}</p>
              {memberHasFreeLocker && (
                <Badge variant="outline" className="mt-2 text-success border-success/25">
                  <Gift className="w-3 h-3 mr-1" /> Free locker included in plan
                </Badge>
              )}
              {membershipEndDate && (
                <p className="text-xs text-muted-foreground mt-1">Membership ends: {membershipEndDate}</p>
              )}
            </div>
          )}

          {/* Sync with membership toggle */}
          {selectedMember && membershipEndDate && (
            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> Sync with Membership
                </Label>
                <p className="text-sm text-muted-foreground">End locker assignment when membership expires ({membershipEndDate})</p>
              </div>
              <Switch checked={syncWithMembership} onCheckedChange={setSyncWithMembership} />
            </div>
          )}

          {/* Duration (hidden when synced) */}
          {!syncWithMembership && (
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select value={String(assignMonths)} onValueChange={(v) => setAssignMonths(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 3, 6, 12].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} Month{m > 1 ? 's' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Charge Toggle */}
          {!memberHasFreeLocker && (
            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Charge Rental Fee?</Label>
                <p className="text-sm text-muted-foreground">Charged once for the entire assignment period</p>
              </div>
              <Switch checked={isChargeable} onCheckedChange={setIsChargeable} />
            </div>
          )}

          {/* Rental Fee Input */}
          {isChargeable && !memberHasFreeLocker && (
            <div className="space-y-2">
              <Label>Rental Fee (₹)</Label>
              <Input
                type="number"
                value={rentalFee}
                onChange={(e) => setRentalFee(Number(e.target.value))}
                min={0}
              />
              <p className="text-xs text-muted-foreground">
                Flat fee covering {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                {' – '}
                {new Date(effectiveEndDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
          )}

          {/* GST toggle + payment collection */}
          {isChargeable && !memberHasFreeLocker && (
            <div className="space-y-4 p-4 rounded-2xl border">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="locker-gst" className="text-base">Charge GST?</Label>
                  <p className="text-sm text-muted-foreground">
                    Applies {Number(lockerGstRate ?? 18)}% GST to this rental
                  </p>
                </div>
                <Switch id="locker-gst" checked={chargeGst} onCheckedChange={setChargeGst} />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="locker-collect" className="text-base">Collect payment now?</Label>
                  <p className="text-sm text-muted-foreground">Marks the invoice paid and records the transaction</p>
                </div>
                <Switch id="locker-collect" checked={collectNow} onCheckedChange={setCollectNow} />
              </div>

              {collectNow && (
                <div className="space-y-2">
                  <Label htmlFor="locker-pay-method">Payment method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger id="locker-pay-method">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="wallet">Wallet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Total Amount or Free Assignment Message */}
          {effectivelyFree ? (
            <div className="p-4 rounded-lg bg-success/10 dark:bg-success/10 border border-success/25 dark:border-success/20">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-success" />
                <div>
                  <p className="font-medium text-success dark:text-success">Free Assignment</p>
                  <p className="text-sm text-muted-foreground">
                    {memberHasFreeLocker ? 'Included in membership plan' : 'No invoice will be generated'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-muted space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Sub-total</span>
                <span className="font-medium">₹{totalAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">GST ({gstRate}%)</span>
                <span className="font-medium">₹{gstAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-muted-foreground">Total payable</span>
                <span className="text-xl font-bold">
                  ₹{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <Receipt className="w-3 h-3 inline mr-1" />
                An invoice will be generated automatically
              </p>
            </div>
          )}

        </div>


        <SheetFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleAssignLocker}  
            disabled={!selectedMember || isAssigning}
          >
            {isAssigning ? 'Assigning...' : 'Assign Locker'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
