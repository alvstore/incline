import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Dumbbell, CalendarDays, Plus, Check, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { computePtCheckout, formatINR } from '@/lib/payments/ptCheckout';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';

type Mode = 'session' | 'monthly';
type PayMethod = 'cash' | 'card' | 'upi' | 'bank_transfer';
type PaySource = 'in_person' | 'payment_link';

// PT GST is 5% inclusive by default; owners/admins/managers may mark a sale exempt (0%).
const PT_GST_RATE = 5;

interface PurchasePTPackageDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  branchId: string;
  /** Optional — shown in the header so staff know who they are selling to. */
  memberName?: string;
}

interface CatalogPkg {
  id: string;
  name: string;
  description: string | null;
  total_sessions: number | null;
  duration_months: number | null;
  validity_days: number | null;
  price: number;
  package_type: 'session_based' | 'monthly';
}

interface CustomForm {
  name: string;
  sessions: number;
  validityMonths: number;
  durationMonths: number;
  price: number;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Calendar-correct end date preview, mirroring pt_calendar_expiry. */
function previewExpiry(startISO: string, months: number | null, validityDays: number | null): string | null {
  if (!startISO) return null;
  const d = new Date(`${startISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (months && months > 0) {
    const day = d.getDate();
    const end = new Date(d);
    end.setMonth(end.getMonth() + months);
    // Clamp for short months (31 Jan + 1 month -> 28/29 Feb)
    if (end.getDate() < day) end.setDate(0);
    end.setDate(end.getDate() - 1);
    return end.toISOString().slice(0, 10);
  }
  if (validityDays && validityDays > 0) {
    const end = new Date(d);
    end.setDate(end.getDate() + validityDays - 1);
    return end.toISOString().slice(0, 10);
  }
  return null;
}

const prettyDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function PurchasePTPackageDrawer({
  open, onOpenChange, memberId, branchId, memberName,
}: PurchasePTPackageDrawerProps) {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const roleList = useMemo(() => roles?.map((r) => r.role) ?? [], [roles]);
  const canEditTax = can.viewFinancials(roleList);

  const [mode, setMode] = useState<Mode>('monthly');
  const [selected, setSelected] = useState<string | 'custom' | null>(null);
  const [paySource, setPaySource] = useState<PaySource>('in_person');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [pendingPackageId, setPendingPackageId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [gstExempt, setGstExempt] = useState(false);
  const [chargeOverride, setChargeOverride] = useState<string>('');
  const [custom, setCustom] = useState<CustomForm>({
    name: '',
    sessions: 12,
    validityMonths: 3,
    durationMonths: 1,
    price: 0,
  });

  useEffect(() => { setSelected(null); setChargeOverride(''); }, [mode]);
  useEffect(() => {
    if (!open) {
      setMode('monthly'); setSelected(null);
      setPaySource('in_person'); setPayMethod('cash');
      setPendingPackageId(null);
      setStartDate(todayISO());
      setGstExempt(false);
      setChargeOverride('');
    }
  }, [open]);

  const dbType = mode === 'session' ? 'session_based' : 'monthly';
  const gstRate: 0 | 5 = gstExempt ? 0 : PT_GST_RATE;

  // Idempotency key stable across retries within this draft
  const draftId = selected === 'custom'
    ? `custom-${mode}-${custom.name}-${custom.price}`
    : `${selected ?? 'none'}-${startDate}-${gstRate}-${chargeOverride}`;
  const idempotencyKey = useStableIdempotencyKey(memberId, 'pt-purchase', draftId);

  // Current general-training trainer on the member (may be null)
  const { data: member } = useQuery({
    queryKey: ['member-trainer', memberId],
    enabled: open && !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, assigned_trainer_id')
        .eq('id', memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const currentTrainerId = member?.assigned_trainer_id ?? null;

  // Branch trainer roster — staff pick who is coaching this PT package.
  const { data: trainers = [], isLoading: trainersLoading } = useQuery({
    queryKey: ['pt-branch-trainers', branchId],
    enabled: open && !!branchId,
    queryFn: async () => {
      const { data: list, error } = await supabase
        .from('trainers')
        .select('id, user_id, pt_share_percentage, is_active')
        .eq('branch_id', branchId)
        .eq('is_active', true);
      if (error) throw error;
      const ids = (list ?? []).map((t) => t.user_id).filter(Boolean) as string[];
      let names: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ids);
        names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name ?? 'Trainer']));
      }
      return (list ?? [])
        .map((t) => ({
          id: t.id,
          full_name: (t.user_id && names[t.user_id]) || 'Unnamed trainer',
          share: Number(t.pt_share_percentage ?? 0),
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [keepCurrentTrainer, setKeepCurrentTrainer] = useState(false);

  // Seed selection from the member's current trainer when the drawer opens.
  useEffect(() => {
    if (open && currentTrainerId && trainerId === null) setTrainerId(currentTrainerId);
  }, [open, currentTrainerId, trainerId]);
  useEffect(() => {
    if (!open) { setTrainerId(null); setKeepCurrentTrainer(false); }
  }, [open]);

  const selectedTrainer = useMemo(
    () => trainers.find((t) => t.id === trainerId) ?? null,
    [trainers, trainerId],
  );
  const currentTrainer = useMemo(
    () => trainers.find((t) => t.id === currentTrainerId) ?? null,
    [trainers, currentTrainerId],
  );
  const trainerShare = selectedTrainer ? selectedTrainer.share : null;
  const trainerName: string | null = selectedTrainer?.full_name ?? null;
  const willReassign = !!trainerId && trainerId !== currentTrainerId && !keepCurrentTrainer;



  const { data: packages = [], isLoading } = useQuery<CatalogPkg[]>({
    queryKey: ['pt-packages-active', branchId, dbType],
    enabled: open && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_packages')
        .select('id, name, description, total_sessions, duration_months, validity_days, price, package_type')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .eq('package_type', dbType as any)
        .order('price', { ascending: true });
      if (error) throw error;
      return (data as any) ?? [];
    },
  });

  const selectedPkg = useMemo(
    () => packages.find(p => p.id === selected) ?? null,
    [packages, selected],
  );

  const listPrice = selected === 'custom'
    ? custom.price
    : selectedPkg ? Number(selectedPkg.price) || 0 : 0;
  const overrideValue = chargeOverride.trim() === '' ? null : Number(chargeOverride);
  const price = overrideValue != null && !Number.isNaN(overrideValue) && overrideValue > 0
    ? overrideValue
    : listPrice;
  const discount = Math.max(0, listPrice - price);

  const breakdown = computePtCheckout({ price, gstPct: gstRate, gstInclusive: true });

  const durationMonths = selected === 'custom'
    ? (mode === 'monthly' ? custom.durationMonths : null)
    : (selectedPkg?.package_type === 'monthly' ? selectedPkg.duration_months : null);
  const validityDays = selected === 'custom'
    ? (mode === 'session' ? Math.max(1, custom.validityMonths) * 30 : null)
    : selectedPkg?.validity_days ?? null;
  const expiryPreview = previewExpiry(startDate, durationMonths ?? null, validityDays ?? null);

  const commissionPreview = Math.round(breakdown.subtotal * (trainerShare / 100) * 100) / 100;

  const purchase = useMutation({
    mutationFn: async () => {
      if (!trainerId) throw new Error('Assign a trainer to this member before purchase');
      if (!startDate) throw new Error('Pick a start date');
      let packageId: string | null = null;

      if (selected === 'custom') {
        if (!custom.name.trim()) throw new Error('Give the custom pack a name');
        if (custom.price <= 0) throw new Error('Enter a price');
        if (mode === 'session' && custom.sessions <= 0) throw new Error('Sessions must be > 0');
        if (mode === 'monthly' && custom.durationMonths <= 0) throw new Error('Duration must be > 0');

        const insert = {
          branch_id: branchId,
          name: custom.name.trim(),
          description: 'Custom PT pack',
          package_type: dbType,
          total_sessions: mode === 'session' ? custom.sessions : null,
          duration_months: mode === 'monthly' ? custom.durationMonths : null,
          validity_days: mode === 'session' ? Math.max(1, custom.validityMonths) * 30 : null,
          price: custom.price,
          gst_percentage: gstRate,
          gst_inclusive: true,
          is_active: false,
        };
        const { data, error } = await supabase
          .from('pt_packages').insert(insert as any)
          .select('id').single();
        if (error) throw error;
        packageId = data.id;
      } else if (selectedPkg) {
        packageId = selectedPkg.id;
      } else {
        throw new Error('Pick a package first');
      }

      const { data: rpc, error: rpcErr } = await supabase.rpc(
        'purchase_pt_package',
        {
          _member_id: memberId,
          _package_id: packageId!,
          _trainer_id: trainerId,
          _branch_id: branchId,
          _price_paid: price,
          _gst_rate: gstRate,
          _payment_method: payMethod,
          _payment_source: paySource,
          _idempotency_key: idempotencyKey,
          _start_date: startDate,
        } as any,
      );
      if (rpcErr) throw rpcErr;
      const r = rpc as any;
      if (r && r.success === false) throw new Error(r.error || 'Purchase failed');
      return r;
    },
    onSuccess: (data: any) => {
      const invoiceId = data?.invoice_id;
      const mpId = data?.member_package_id;
      queryClient.invalidateQueries({ queryKey: ['my-pt-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
      queryClient.invalidateQueries({ queryKey: ['active-member-packages'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });

      if (paySource === 'payment_link') {
        toast.success('Package created · awaiting payment');
        setPendingPackageId(mpId);
        if (invoiceId) window.open(`/member/pay?invoice=${invoiceId}`, '_blank');
        return;
      }
      toast.success('PT package activated');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Could not start checkout'),
  });

  // Poll for activation when awaiting a link payment
  const { data: pendingStatus } = useQuery({
    queryKey: ['pt-pending-status', pendingPackageId],
    enabled: !!pendingPackageId,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data } = await supabase
        .from('member_pt_packages')
        .select('status, payment_status')
        .eq('id', pendingPackageId!)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (pendingStatus?.status === 'active') {
      toast.success('Payment received · package activated');
      setPendingPackageId(null);
      queryClient.invalidateQueries({ queryKey: ['my-pt-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
      onOpenChange(false);
    }
    if (pendingStatus?.status === 'reversed') {
      toast.error('Package reversed (payment timed out)');
      setPendingPackageId(null);
    }
  }, [pendingStatus?.status, queryClient, onOpenChange]);

  const cancelPending = useMutation({
    mutationFn: async () => {
      if (!pendingPackageId) return;
      const { data, error } = await supabase.rpc(
        'cancel_pending_pt_package',
        { _member_package_id: pendingPackageId, _reason: 'manual_cancel' } as any,
      );
      if (error) throw error;
      const r = data as any;
      if (r && r.success === false) throw new Error(r.error || 'Cancel failed');
    },
    onSuccess: () => {
      toast.success('Pending purchase reversed');
      setPendingPackageId(null);
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Reverse failed'),
  });

  const awaitingPayment = !!pendingPackageId;
  const canCharge =
    !purchase.isPending && !awaitingPayment && !!trainerId && !!startDate && price > 0 &&
    ((selected && selected !== 'custom') ||
      (selected === 'custom' &&
        custom.name.trim().length > 0 &&
        custom.price > 0 &&
        (mode === 'session' ? custom.sessions > 0 : custom.durationMonths > 0)));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5" /> Purchase PT Package
          </SheetTitle>
          <SheetDescription>
            {memberName ? `Add a personal training package for ${memberName}. ` : ''}
            Pick a plan, set the start date and confirm the tax treatment — commission preview updates live.
          </SheetDescription>
        </SheetHeader>

        {!trainerId && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg bg-warning/10 text-warning px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Assign a trainer to this member before purchasing.
          </div>
        )}

        {awaitingPayment && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-2 rounded-lg bg-info/10 text-info px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment…
            </div>
            <Button
              size="sm" variant="ghost"
              onClick={() => cancelPending.mutate()}
              disabled={cancelPending.isPending}
            >
              Cancel & reverse
            </Button>
          </div>
        )}

        <div className="px-6 pt-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-2 w-full bg-muted p-1 rounded-xl">
              <TabsTrigger value="monthly" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                <CalendarDays className="h-4 w-4 mr-2" /> Monthly Plan
              </TabsTrigger>
              <TabsTrigger value="session" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                <Dumbbell className="h-4 w-4 mr-2" /> Session Pack
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {packages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No preset {mode === 'session' ? 'session packs' : 'monthly plans'} — build a custom one below.
                </p>
              )}

              {packages.map((pkg) => {
                const isSel = selected === pkg.id;
                const isMonthly = pkg.package_type === 'monthly';
                return (
                  <Card
                    key={pkg.id}
                    onClick={() => setSelected(pkg.id)}
                    className={`cursor-pointer rounded-2xl border-0 shadow-sm transition-all ${
                      isSel ? 'ring-2 ring-primary shadow-md shadow-primary/10' : 'hover:shadow-md'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold truncate">{pkg.name}</h4>
                            {isSel && <Check className="h-4 w-4 text-primary shrink-0" />}
                          </div>
                          {pkg.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {pkg.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-2">
                            {isMonthly ? (
                              <Badge variant="secondary" className="text-xs">
                                Monthly access
                                {pkg.duration_months ? ` · ${pkg.duration_months} month${pkg.duration_months > 1 ? 's' : ''}` : ''}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                {pkg.total_sessions ?? 0} sessions
                              </Badge>
                            )}
                            {!isMonthly && pkg.validity_days != null && (
                              <Badge variant="outline" className="text-xs">
                                Valid {pkg.validity_days} days
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {gstExempt ? 'GST exempt' : 'GST 5% incl.'}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-lg font-bold">
                            ₹{Number(pkg.price).toLocaleString('en-IN')}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              <Card
                onClick={() => selected !== 'custom' && setSelected('custom')}
                className={`cursor-pointer rounded-2xl border-2 border-dashed transition-all ${
                  selected === 'custom'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-border'
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 font-medium">
                    <Plus className="h-4 w-4" />
                    Build a custom {mode === 'session' ? 'session pack' : 'monthly plan'}
                  </div>

                  {selected === 'custom' && (
                    <div className="space-y-3 pt-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="custom-name" className="text-xs">Pack name</Label>
                        <Input
                          id="custom-name"
                          value={custom.name}
                          onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                          placeholder={mode === 'session' ? '12 PT Sessions — Custom' : 'Monthly PT — Custom'}
                        />
                      </div>

                      {mode === 'session' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-sessions" className="text-xs">Number of sessions</Label>
                            <Input id="custom-sessions" type="number" min={1}
                              value={custom.sessions}
                              onChange={(e) => setCustom({ ...custom, sessions: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-validity" className="text-xs">Validity (months)</Label>
                            <Input id="custom-validity" type="number" min={1}
                              value={custom.validityMonths}
                              onChange={(e) => setCustom({ ...custom, validityMonths: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                        </div>
                      )}

                      {mode === 'monthly' && (
                        <div className="space-y-1.5">
                          <Label htmlFor="custom-duration" className="text-xs">Duration (months)</Label>
                          <Input id="custom-duration" type="number" min={1}
                            value={custom.durationMonths}
                            onChange={(e) => setCustom({ ...custom, durationMonths: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="custom-price" className="text-xs">
                          Price (₹, {gstExempt ? 'GST exempt' : 'GST 5% incl.'})
                        </Label>
                        <Input id="custom-price" type="number" min={0}
                          value={custom.price}
                          onChange={(e) => setCustom({ ...custom, price: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Schedule + tax controls */}
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pt-start-date" className="text-xs">Start date</Label>
                      <Input
                        id="pt-start-date"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ends on</Label>
                      <div className="h-10 flex items-center rounded-md border border-input px-3 text-sm text-muted-foreground">
                        {prettyDate(expiryPreview)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      {trainerName ? `${trainerName} ` : 'The assigned trainer '}
                      can mark PT attendance from {prettyDate(startDate)} onwards
                      {expiryPreview ? ` until ${prettyDate(expiryPreview)}` : ''}.
                    </span>
                  </div>

                  {canEditTax && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <Label htmlFor="pt-gst-exempt" className="text-sm">GST exempt sale</Label>
                          <p className="text-xs text-muted-foreground">
                            Off = GST 5% inclusive (standard). On = 0% on the invoice.
                          </p>
                        </div>
                        <Switch
                          id="pt-gst-exempt"
                          checked={gstExempt}
                          onCheckedChange={setGstExempt}
                          aria-label="Toggle GST exempt sale"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="pt-charge" className="text-xs">
                          Amount to charge (₹) — leave blank for list price
                        </Label>
                        <Input
                          id="pt-charge"
                          type="number"
                          min={0}
                          placeholder={listPrice ? String(listPrice) : '0'}
                          value={chargeOverride}
                          onChange={(e) => setChargeOverride(e.target.value)}
                        />
                        {discount > 0 && (
                          <p className="text-xs text-warning">
                            Discount applied: {formatINR(discount)} off list price.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="border-t bg-card/95 backdrop-blur px-6 py-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Payment source</Label>
              <Select value={paySource} onValueChange={(v) => setPaySource(v as PaySource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_person">In-person (settle now)</SelectItem>
                  <SelectItem value="payment_link">Payment link</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PayMethod)} disabled={paySource === 'payment_link'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Subtotal (pre-GST)</span>
            <span>{formatINR(breakdown.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{gstExempt ? 'GST (exempt sale)' : 'GST 5% (inclusive)'}</span>
            <span>{formatINR(breakdown.tax)}</span>
          </div>
          <div className="flex justify-between text-sm text-success">
            <span>Trainer commission (preview)</span>
            <span>{formatINR(commissionPreview)}</span>
          </div>
          <div className="flex justify-between text-base font-bold pt-1 border-t border-dashed border-border">
            <span>Final Total</span>
            <span>{formatINR(breakdown.total)}</span>
          </div>
          <Button
            className="w-full mt-2"
            size="lg"
            disabled={!canCharge}
            onClick={() => purchase.mutate()}
          >
            {purchase.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : awaitingPayment ? (
              <>Waiting for payment…</>
            ) : (
              <>Charge &amp; Assign · {formatINR(breakdown.total)}</>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
