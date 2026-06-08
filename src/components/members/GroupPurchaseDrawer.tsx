import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlans } from '@/hooks/usePlans';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Users, Search, X, IndianRupee, Sparkles, Heart, Briefcase, UserPlus } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
}

const GROUP_TYPES = [
  { value: 'couple', label: 'Couple', icon: Heart, min: 2, max: 2 },
  { value: 'family', label: 'Family', icon: Users, min: 2, max: 8 },
  { value: 'friends', label: 'Friends', icon: Sparkles, min: 2, max: 10 },
  { value: 'corporate', label: 'Corporate', icon: Briefcase, min: 2, max: 50 },
];

export function GroupPurchaseDrawer({ open, onOpenChange, branchId }: Props) {
  const qc = useQueryClient();
  const [groupName, setGroupName] = useState('');
  const [groupType, setGroupType] = useState<'couple' | 'family' | 'friends' | 'corporate'>('couple');
  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState(10);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [includeGst, setIncludeGst] = useState(false);
  const [notes, setNotes] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Array<{ id: string; name: string; phone: string }>>([]);

  useEffect(() => {
    if (!open) {
      setGroupName(''); setPlanId(''); setSelectedMembers([]);
      setMemberSearch(''); setDiscountValue(10); setNotes('');
    }
  }, [open]);

  const { data: plans = [] } = usePlans(branchId);
  const selectedPlan = plans.find((p: any) => p.id === planId);

  const { data: searchResults = [] } = useQuery({
    queryKey: ['group-member-search', branchId, memberSearch],
    enabled: open && memberSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, member_code, branch_id, profiles:user_id(full_name, phone)')
        .eq('branch_id', branchId)
        .eq('status', 'active')
        .limit(20);
      if (error) throw error;
      const q = memberSearch.toLowerCase();
      return (data || []).filter((m: any) => {
        const name = m.profiles?.full_name?.toLowerCase() || '';
        const phone = m.profiles?.phone || '';
        const code = m.member_code?.toLowerCase() || '';
        return name.includes(q) || phone.includes(q) || code.includes(q);
      });
    },
  });

  const typeMeta = GROUP_TYPES.find((t) => t.value === groupType)!;
  const memberCount = selectedMembers.length;

  const pricing = useMemo(() => {
    if (!selectedPlan || memberCount === 0) return null;
    const base = Number(selectedPlan.discounted_price ?? selectedPlan.price ?? 0);
    const adm = Number(selectedPlan.admission_fee ?? 0);
    const grossPer = base + adm;
    const discPer = discountType === 'percentage'
      ? Math.round((grossPer * discountValue) / 100 * 100) / 100
      : Math.round((discountValue / memberCount) * 100) / 100;
    const finalPer = Math.max(0, grossPer - discPer);
    return {
      grossPer, discPer, finalPer,
      groupTotal: finalPer * memberCount,
      groupGross: grossPer * memberCount,
      groupDiscount: discPer * memberCount,
    };
  }, [selectedPlan, memberCount, discountType, discountValue]);

  const addMember = (m: any) => {
    if (selectedMembers.some((s) => s.id === m.id)) return;
    if (memberCount >= typeMeta.max) {
      toast.error(`${typeMeta.label} groups support up to ${typeMeta.max} members`);
      return;
    }
    setSelectedMembers([...selectedMembers, {
      id: m.id, name: m.profiles?.full_name || 'Unknown', phone: m.profiles?.phone || '',
    }]);
    setMemberSearch('');
  };

  const removeMember = (id: string) => setSelectedMembers(selectedMembers.filter((m) => m.id !== id));

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!groupName.trim()) throw new Error('Group name is required');
      if (!planId) throw new Error('Pick a plan');
      if (memberCount < typeMeta.min) throw new Error(`${typeMeta.label} groups need at least ${typeMeta.min} members`);

      const { data, error } = await supabase.rpc('purchase_group_membership', {
        p_branch_id: branchId,
        p_member_ids: selectedMembers.map((m) => m.id),
        p_plan_id: planId,
        p_start_date: startDate,
        p_group_name: groupName,
        p_group_type: groupType,
        p_discount_type: discountType,
        p_discount_value: discountValue,
        p_payment_method: paymentMethod,
        p_include_gst: includeGst,
        p_notes: notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(`Group "${data?.group_name}" created — ${data?.member_count} memberships`);
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['memberships'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      const map: Record<string, string> = {
        GROUP_REQUIRES_MIN_2_MEMBERS: 'A group must have at least 2 members.',
        COUPLE_REQUIRES_EXACTLY_2_MEMBERS: 'A couple group must have exactly 2 members.',
        DUPLICATE_MEMBER_IN_GROUP: 'The same member appears more than once.',
        ALREADY_IN_ACTIVE_GROUP: 'One of the selected members is already in another active group.',
        MEMBER_BRANCH_MISMATCH: 'A selected member belongs to another branch.',
        MEMBER_NOT_ACTIVE: 'A selected member is not active.',
        DISCOUNT_PERCENT_OUT_OF_RANGE: 'Discount % must be between 0 and 100.',
        DISCOUNT_FIXED_OUT_OF_RANGE: 'Fixed discount exceeds the total plan price.',
        PLAN_NOT_FOUND: 'Selected plan no longer exists.',
        INVALID_GROUP_TYPE: 'Invalid group type.',
      };
      const code = (e.message || '').split(':')[0].trim();
      toast.error(map[code] || e.message || 'Group purchase failed');
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-primary/15 text-primary">
              <Users className="h-5 w-5" />
            </span>
            Group / Couple Purchase
          </SheetTitle>
          <SheetDescription>
            Sell the same plan to multiple existing members and split a group discount evenly across each invoice.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Group identity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Group name *</Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Sharma Family" />
            </div>
            <div className="space-y-2">
              <Label>Group type</Label>
              <Select value={groupType} onValueChange={(v) => setGroupType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label} ({t.min}–{t.max})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Member picker */}
          <div className="space-y-2">
            <Label>Members in this group ({memberCount}/{typeMeta.max})</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search members by name, phone or code"
                className="pl-9"
              />
              {searchResults.length > 0 && memberSearch && (
                <Card className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto shadow-lg">
                  <CardContent className="p-1">
                    {searchResults.map((m: any) => (
                      <button
                        key={m.id} type="button"
                        onClick={() => addMember(m)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted flex items-center gap-3"
                      >
                        <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{m.profiles?.full_name?.[0] || '?'}</AvatarFallback></Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.profiles?.full_name}</p>
                          <p className="text-xs text-muted-foreground">{m.profiles?.phone} · {m.member_code}</p>
                        </div>
                        <UserPlus className="h-4 w-4 text-primary" />
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {selectedMembers.map((m) => (
                  <Badge key={m.id} variant="secondary" className="rounded-full pl-1 pr-2 py-1 gap-2">
                    <Avatar className="h-5 w-5"><AvatarFallback className="text-[10px]">{m.name[0]}</AvatarFallback></Avatar>
                    <span className="text-xs">{m.name}</span>
                    <button onClick={() => removeMember(m.id)} aria-label="Remove" className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Plan + dates */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Plan *</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — ₹{p.discounted_price ?? p.price}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          {/* Discount */}
          <div className="space-y-2">
            <Label>Group discount</Label>
            <div className="flex gap-2">
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as any)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">% per member</SelectItem>
                  <SelectItem value="fixed">₹ total (split)</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number" min={0} value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value || 0))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {discountType === 'percentage'
                ? `${discountValue}% will be applied to each member's invoice.`
                : `₹${discountValue} will be split evenly across ${memberCount || 'N'} members.`}
            </p>
          </div>

          {/* Payment + GST */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tax invoice</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={includeGst} onCheckedChange={setIncludeGst} />
                <span className="text-sm text-muted-foreground">{includeGst ? 'GST broken out' : 'Receipt only'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional internal note" />
          </div>

          {/* Pricing summary */}
          {pricing && (
            <Alert className="bg-primary/10 border-primary/25">
              <AlertDescription className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Per member</span>
                  <span className="text-sm">
                    <span className="line-through text-muted-foreground mr-2">₹{pricing.grossPer.toFixed(2)}</span>
                    <span className="font-semibold text-primary">₹{pricing.finalPer.toFixed(2)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Group total ({memberCount} members)</span>
                  <span className="font-bold text-lg flex items-center text-foreground">
                    <IndianRupee className="h-4 w-4" />{pricing.groupTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-success">
                  <span>Total discount applied</span>
                  <span>−₹{pricing.groupDiscount.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Each member gets their own invoice. Group purchases create pending balances; settle each individually.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <SheetFooter className="pt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => purchaseMutation.mutate()}
            disabled={purchaseMutation.isPending || memberCount < typeMeta.min || !planId || !groupName.trim()}
            className="gap-2"
          >
            <Users className="h-4 w-4" />
            {purchaseMutation.isPending ? 'Creating…' : `Create group (${memberCount} members)`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
