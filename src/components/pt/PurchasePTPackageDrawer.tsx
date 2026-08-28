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
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Dumbbell, CalendarDays, Plus, Check, AlertTriangle, Info,
  ArrowLeft, ArrowRight, SlidersHorizontal, ChevronDown, PackageOpen, RotateCcw, UserRound, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { computePtCheckout, formatINR } from '@/lib/payments/ptCheckout';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';

type Mode = 'session' | 'monthly';
type PayMethod = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'wallet';
type PaySource = 'in_person' | 'payment_link';
type CollectMode = 'full' | 'half' | 'custom' | 'none';
type Step = 1 | 2 | 3;

const REFERENCE_LABELS: Record<PayMethod, { label: string; placeholder: string } | null> = {
  cash: null,
  wallet: null,
  upi: { label: 'UPI reference / UTR', placeholder: '12-digit UTR from the UPI app' },
  card: { label: 'Card auth / RRN', placeholder: 'Approval code on the POS slip' },
  bank_transfer: { label: 'Bank reference / UTR', placeholder: 'NEFT / IMPS / RTGS reference' },
  cheque: { label: 'Cheque number', placeholder: 'Cheque no. + bank' },
};

const DUE_PRESETS = [7, 10, 15, 30] as const;

const addDaysISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// PT GST is 5% inclusive by default; owners/admins/managers may mark a sale exempt (0%).
const PT_GST_RATE = 5;

const STEP_LABELS: Record<Step, string> = {
  1: 'Plan & trainer',
  2: 'Schedule & pricing',
  3: 'Payment',
};

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

/** Header progress: three dots + the current step label. */
function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of 3: ${STEP_LABELS[step]}`}>
      <div className="flex items-center gap-1.5">
        {([1, 2, 3] as Step[]).map((s) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              s === step ? 'w-6 bg-primary' : s < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-muted-foreground/25'
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-muted-foreground">
        Step {step} of 3 · {STEP_LABELS[step]}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
  );
}

export function PurchasePTPackageDrawer({
  open, onOpenChange, memberId, branchId, memberName,
}: PurchasePTPackageDrawerProps) {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const roleList = useMemo(() => roles?.map((r) => r.role) ?? [], [roles]);
  const canEditTax = can.viewFinancials(roleList);

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>('monthly');
  const [selected, setSelected] = useState<string | 'custom' | null>(null);
  const [paySource, setPaySource] = useState<PaySource>('in_person');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [pendingPackageId, setPendingPackageId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [gstExempt, setGstExempt] = useState(false);
  const [chargeOverride, setChargeOverride] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Collection: how much money actually changes hands right now.
  const [collectMode, setCollectMode] = useState<CollectMode>('full');
  const [collectInput, setCollectInput] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [txnRef, setTxnRef] = useState<string>('');
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
      setStep(1);
      setMode('monthly'); setSelected(null);
      setPaySource('in_person'); setPayMethod('cash');
      setPendingPackageId(null);
      setStartDate(todayISO());
      setGstExempt(false);
      setChargeOverride('');
      setAdvancedOpen(false);
      setCollectMode('full'); setCollectInput(''); setDueDate(''); setTxnRef('');
    }
  }, [open]);

  const dbType = mode === 'session' ? 'session_based' : 'monthly';
  const gstRate: 0 | 5 = gstExempt ? 0 : PT_GST_RATE;

  // Idempotency key stable across retries within this draft
  const [trainerDraftKey, setTrainerDraftKey] = useState<string>('none');
  const collectDraftKey = `${collectMode}-${collectInput}-${dueDate}`;
  const draftId = selected === 'custom'
    ? `custom-${mode}-${custom.name}-${custom.price}-${trainerDraftKey}-${collectDraftKey}`
    : `${selected ?? 'none'}-${startDate}-${gstRate}-${chargeOverride}-${trainerDraftKey}-${collectDraftKey}`;
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

  // Duplicate-sale guard — surface any package that is live or awaiting payment.
  const { data: existingPackages = [], isLoading: existingLoading } = useQuery({
    queryKey: ['pt-existing-packages', memberId],
    enabled: open && !!memberId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_pt_packages')
        .select('id, status, invoice_id, trainer_id, start_date, expiry_date, sessions_remaining, sessions_total, created_at, pt_packages(name)')
        .eq('member_id', memberId)
        .in('status', ['active', 'pending_payment'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  const blockingPackage = existingPackages[0] ?? null;
  const [duplicateAck, setDuplicateAck] = useState(false);
  useEffect(() => { if (!open) setDuplicateAck(false); }, [open]);

  // Branch trainer roster — staff pick who is coaching this PT package.
  const {
    data: trainers = [], isLoading: trainersLoading, isError: trainersError, refetch: refetchTrainers,
  } = useQuery({
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
    if (open && currentTrainerId && trainerId === null) {
      setTrainerId(currentTrainerId);
      setTrainerDraftKey(currentTrainerId);
    }
  }, [open, currentTrainerId, trainerId]);
  useEffect(() => {
    if (!open) { setTrainerId(null); setTrainerDraftKey('none'); setKeepCurrentTrainer(false); }
  }, [open]);

  const handleTrainerChange = (id: string) => {
    setTrainerId(id);
    setTrainerDraftKey(id);
  };

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

  const {
    data: packages = [], isLoading, isError: packagesError, refetch: refetchPackages,
  } = useQuery<CatalogPkg[]>({
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

  const commissionPreview = trainerShare == null
    ? null
    : Math.round(breakdown.subtotal * (trainerShare / 100) * 100) / 100;

  // ---- Collection (how much is settled right now) -------------------------
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const customCollect = collectInput.trim() === '' ? 0 : Number(collectInput);
  const collectedNow = paySource === 'payment_link'
    ? 0
    : collectMode === 'full'
      ? breakdown.total
      : collectMode === 'none'
        ? 0
        : collectMode === 'half'
          ? round2(breakdown.total / 2)
          : Math.min(Math.max(0, Number.isNaN(customCollect) ? 0 : customCollect), breakdown.total);
  const balanceDue = round2(Math.max(0, breakdown.total - collectedNow));
  const needsDueDate = balanceDue > 0 && paySource === 'in_person';
  const refSpec = REFERENCE_LABELS[payMethod];
  const needsReference = paySource === 'in_person' && collectedNow > 0 && !!refSpec;
  const referenceMissing = needsReference && txnRef.trim().length < 4;

  // A partial collection always needs a due date — default it to +7 days.
  useEffect(() => {
    if (needsDueDate && !dueDate) setDueDate(addDaysISO(7));
  }, [needsDueDate, dueDate]);

  const purchase = useMutation({
    mutationFn: async () => {
      if (!trainerId) throw new Error('Select the trainer for this package');

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
          _reassign_member_trainer: !keepCurrentTrainer,
          _allow_duplicate: duplicateAck,
          _amount_paid: paySource === 'payment_link' ? 0 : collectedNow,
          _due_date: needsDueDate ? (dueDate || addDaysISO(7)) : null,
          _transaction_id: txnRef.trim() || null,
          _payment_notes: balanceDue > 0
            ? `PT package purchase · part payment (balance ₹${balanceDue.toLocaleString('en-IN')})`
            : 'PT package purchase',
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
      queryClient.invalidateQueries({ queryKey: ['member-trainer', memberId] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['member-detail'] });
      queryClient.invalidateQueries({ queryKey: ['trainers-utilization'] });

      if (data?.trainer_reassigned && trainerName) {
        toast.success(`${trainerName} is now this member's trainer`);
      }

      if (paySource === 'payment_link') {
        toast.success('Package created · awaiting payment');
        setPendingPackageId(mpId);
        if (invoiceId) window.open(`/member/pay?invoice=${invoiceId}`, '_blank');
        return;
      }
      toast.success(
        balanceDue > 0
          ? `PT package activated · ₹${balanceDue.toLocaleString('en-IN')} ${collectedNow > 0 ? 'balance' : 'unpaid'} due by ${dueDate || addDaysISO(7)}`
          : 'PT package activated',
      );

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
  const canSellDuplicate = canEditTax; // owner / admin / manager
  const duplicateBlocked = !!blockingPackage && !(canSellDuplicate && duplicateAck);

  const planChosen =
    (!!selected && selected !== 'custom') ||
    (selected === 'custom' &&
      custom.name.trim().length > 0 &&
      custom.price > 0 &&
      (mode === 'session' ? custom.sessions > 0 : custom.durationMonths > 0));

  // Why the user can't move on — shown inline instead of a dead button.
  const step1Blocker: string | null =
    existingLoading ? 'Checking existing packages…'
      : duplicateBlocked ? 'Resolve the existing package first'
        : !trainerId ? 'Select a trainer'
          : !planChosen ? (selected === 'custom' ? 'Complete the custom plan details' : 'Pick a plan')
            : null;
  const step2Blocker: string | null =
    !startDate ? 'Pick a start date' : price <= 0 ? 'Set a price above zero' : null;
  const step3Blocker: string | null =
    awaitingPayment ? 'Waiting for the payment link to settle'
      : referenceMissing ? `Add the ${refSpec?.label.toLowerCase() ?? 'payment reference'}`
        : null;

  const canCharge =
    !purchase.isPending && !step1Blocker && !step2Blocker && !step3Blocker;

  const goNext = () => setStep((s) => (s === 1 ? 2 : 3));
  const goBack = () => setStep((s) => (s === 3 ? 2 : 1));
  const currentBlocker = step === 1 ? step1Blocker : step === 2 ? step2Blocker : step3Blocker;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        <SheetHeader className="space-y-2 border-b px-5 py-4 text-left sm:px-6">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-500/10">
              <Dumbbell className="h-4 w-4" />
            </span>
            Purchase PT Package
          </SheetTitle>
          <SheetDescription className="text-xs">
            {memberName ? `For ${memberName}` : 'Personal training package'}
          </SheetDescription>
          <StepDots step={step} />
        </SheetHeader>

        {awaitingPayment && (
          <div className="mx-5 mt-4 flex items-center justify-between gap-2 rounded-xl bg-info/10 px-3 py-2 text-sm text-info sm:mx-6">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment…
            </div>
            <Button
              size="sm" variant="ghost"
              className="min-h-[36px]"
              onClick={() => cancelPending.mutate()}
              disabled={cancelPending.isPending}
            >
              Cancel &amp; reverse
            </Button>
          </div>
        )}

        {/* ------------------------------ BODY ------------------------------ */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {/* ---------------------- STEP 1 · Plan & trainer ------------------ */}
          {step === 1 && (
            <>
              {blockingPackage && (
                <div className="rounded-2xl bg-amber-50 p-3 dark:bg-amber-500/10">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        {blockingPackage.status === 'pending_payment'
                          ? 'Already has a package awaiting payment'
                          : 'Already has an active PT package'}
                      </p>
                      <p className="text-xs text-amber-800 dark:text-amber-300/90">
                        {blockingPackage.pt_packages?.name ?? 'PT package'}
                        {trainers.find((t) => t.id === blockingPackage.trainer_id)
                          ? ` · ${trainers.find((t) => t.id === blockingPackage.trainer_id)!.full_name}`
                          : ''}
                        {blockingPackage.start_date ? ` · from ${prettyDate(blockingPackage.start_date)}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {blockingPackage.invoice_id && (
                          <Button
                            size="sm" variant="outline" className="min-h-[36px] rounded-full"
                            onClick={() => window.open(`/member/pay?invoice=${blockingPackage.invoice_id}`, '_blank')}
                          >
                            Open invoice
                          </Button>
                        )}
                        {canSellDuplicate ? (
                          <Button
                            size="sm"
                            variant={duplicateAck ? 'secondary' : 'default'}
                            className="min-h-[36px] rounded-full"
                            onClick={() => setDuplicateAck((v) => !v)}
                          >
                            {duplicateAck ? 'Additional package confirmed' : 'Sell an additional package'}
                          </Button>
                        ) : (
                          <p className="text-xs text-amber-800">Ask a manager to approve an additional package.</p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        blockingPackage.status === 'pending_payment'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {blockingPackage.status === 'pending_payment' ? 'Awaiting payment' : 'Active'}
                    </Badge>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <SectionLabel>Trainer</SectionLabel>
                <Label htmlFor="pt-trainer" className="sr-only">Trainer for this package</Label>
                {trainersLoading ? (
                  <Skeleton className="h-11 w-full rounded-xl" />
                ) : trainersError ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <span>Couldn't load the trainer roster.</span>
                    <Button size="sm" variant="ghost" className="min-h-[36px]" onClick={() => refetchTrainers()}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
                    </Button>
                  </div>
                ) : (
                  <Select value={trainerId ?? ''} onValueChange={handleTrainerChange}>
                    <SelectTrigger id="pt-trainer" className="h-11 rounded-xl">
                      <SelectValue placeholder="Select the coaching trainer" />
                    </SelectTrigger>
                    <SelectContent>
                      {trainers.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No active trainers in this branch
                        </div>
                      )}
                      {trainers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.full_name} · {t.share}% share
                          {t.id === currentTrainerId ? ' · current' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {trainerId && trainerId !== currentTrainerId && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {keepCurrentTrainer
                      ? `${currentTrainer?.full_name ?? 'The current trainer'} stays as the general-training trainer.`
                      : `${trainerName} will ${currentTrainerId ? `replace ${currentTrainer?.full_name ?? 'the current trainer'} as` : 'become'} this member's trainer.`}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <SectionLabel>Plan</SectionLabel>
                <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                  <TabsList className="grid w-full grid-cols-2 rounded-xl bg-muted p-1">
                    <TabsTrigger value="monthly" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                      <CalendarDays className="mr-2 h-4 w-4" /> Monthly
                    </TabsTrigger>
                    <TabsTrigger value="session" className="rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                      <Dumbbell className="mr-2 h-4 w-4" /> Session pack
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {isLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />)}
                  </div>
                ) : packagesError ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-destructive/5 px-4 py-8 text-center">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-muted-foreground">We couldn't load this branch's PT plans.</p>
                    <Button size="sm" variant="outline" className="min-h-[40px] rounded-full" onClick={() => refetchPackages()}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
                    </Button>
                  </div>
                ) : packages.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted/40 px-4 py-8 text-center">
                    <span className="rounded-full bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-500/10">
                      <PackageOpen className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-medium text-foreground">
                      No preset {mode === 'session' ? 'session packs' : 'monthly plans'} here
                    </p>
                    <p className="text-xs text-muted-foreground">Build a custom one below and it will be saved to this sale.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {packages.map((pkg) => {
                      const isSel = selected === pkg.id;
                      const isMonthly = pkg.package_type === 'monthly';
                      const meta = [
                        isMonthly
                          ? `Monthly access${pkg.duration_months ? ` · ${pkg.duration_months} month${pkg.duration_months > 1 ? 's' : ''}` : ''}`
                          : `${pkg.total_sessions ?? 0} sessions`,
                        !isMonthly && pkg.validity_days != null ? `valid ${pkg.validity_days} days` : null,
                        gstExempt ? 'GST exempt' : 'GST 5% incl.',
                      ].filter(Boolean).join(' · ');
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => setSelected(pkg.id)}
                          aria-pressed={isSel}
                          className={`w-full cursor-pointer rounded-2xl bg-card p-4 text-left shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                            isSel ? 'ring-2 ring-primary shadow-md shadow-primary/10' : 'hover:shadow-md hover:shadow-indigo-500/10'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="truncate font-semibold">{pkg.name}</h4>
                                {isSel && <Check className="h-4 w-4 shrink-0 text-primary" />}
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
                            </div>
                            <div className="shrink-0 text-right text-lg font-bold tabular-nums">
                              ₹{Number(pkg.price).toLocaleString('en-IN')}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                <Card
                  onClick={() => selected !== 'custom' && setSelected('custom')}
                  className={`cursor-pointer rounded-2xl border-2 border-dashed shadow-none transition-all duration-200 ${
                    selected === 'custom' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  }`}
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Plus className="h-4 w-4" />
                      Build a custom {mode === 'session' ? 'session pack' : 'monthly plan'}
                    </div>

                    {selected === 'custom' && (
                      <div className="space-y-3 pt-1">
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
                              <Label htmlFor="custom-sessions" className="text-xs">Sessions</Label>
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
              </div>
            </>
          )}

          {/* -------------------- STEP 2 · Schedule & pricing ----------------- */}
          {step === 2 && (
            <>
              <div className="space-y-3">
                <SectionLabel>Schedule</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pt-start-date" className="text-xs">Start date</Label>
                    <Input
                      id="pt-start-date"
                      type="date"
                      className="h-11 rounded-xl"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ends on</Label>
                    <div className="flex h-11 items-center rounded-xl bg-muted/50 px-3 text-sm font-medium">
                      {prettyDate(expiryPreview)}
                    </div>
                  </div>
                </div>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {trainerName ? `${trainerName} ` : 'The assigned trainer '}
                  can mark PT attendance from {prettyDate(startDate)}
                  {expiryPreview ? ` until ${prettyDate(expiryPreview)}` : ''}.
                </p>
              </div>

              <div className="space-y-2">
                <SectionLabel>Pricing</SectionLabel>
                <div className="space-y-2 rounded-2xl bg-card p-4 shadow-sm">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">List price</span>
                    <span className="tabular-nums">{formatINR(listPrice)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-sm text-amber-600">
                      <span>Discount</span>
                      <span className="tabular-nums">− {formatINR(discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {gstExempt ? 'GST (exempt sale)' : 'GST 5% (inclusive)'}
                    </span>
                    <span className="tabular-nums">{formatINR(breakdown.tax)}</span>
                  </div>
                  <div className="flex justify-between border-t border-dashed pt-2 text-sm font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatINR(breakdown.total)}</span>
                  </div>
                  {commissionPreview != null && (
                    <div className="flex justify-between text-xs text-emerald-600">
                      <span>{trainerName} · {trainerShare}% commission</span>
                      <span className="tabular-nums">{formatINR(commissionPreview)}</span>
                    </div>
                  )}
                </div>
              </div>

              {canEditTax && (
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      className="min-h-[44px] w-full justify-between rounded-xl"
                      aria-expanded={advancedOpen}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <SlidersHorizontal className="h-4 w-4" /> Advanced
                      </span>
                      <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 rounded-2xl bg-muted/40 p-4 mt-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="pt-gst-exempt" className="text-sm">GST exempt sale</Label>
                        <p className="text-xs text-muted-foreground">Off = GST 5% inclusive (standard).</p>
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
                        Amount to charge (₹) — blank keeps the list price
                      </Label>
                      <Input
                        id="pt-charge"
                        type="number"
                        min={0}
                        className="h-11 rounded-xl"
                        placeholder={listPrice ? String(listPrice) : '0'}
                        value={chargeOverride}
                        onChange={(e) => setChargeOverride(e.target.value)}
                      />
                    </div>

                    {currentTrainerId && trainerId && trainerId !== currentTrainerId && (
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="pt-keep-trainer" className="text-xs font-normal text-muted-foreground">
                          Keep {currentTrainer?.full_name ?? 'the current trainer'} for general training
                        </Label>
                        <Switch
                          id="pt-keep-trainer"
                          checked={keepCurrentTrainer}
                          onCheckedChange={setKeepCurrentTrainer}
                          aria-label="Keep the current trainer assigned for general training"
                        />
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}

          {/* ------------------------ STEP 3 · Payment ----------------------- */}
          {step === 3 && (
            <>
              <div className="space-y-3">
                <SectionLabel>How is this being paid?</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pt-source" className="text-xs">Payment source</Label>
                    <Select value={paySource} onValueChange={(v) => setPaySource(v as PaySource)}>
                      <SelectTrigger id="pt-source" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_person">In-person (settle now)</SelectItem>
                        <SelectItem value="payment_link">Payment link</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pt-method" className="text-xs">Method</Label>
                    <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PayMethod)} disabled={paySource === 'payment_link'}>
                      <SelectTrigger id="pt-method" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                        <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="wallet">Wallet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {paySource === 'payment_link' ? (
                <p className="flex items-start gap-1.5 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  A payment link opens after you create the package. It activates automatically once the member pays.
                </p>
              ) : (
                <>
                  <div className="space-y-3">
                    <SectionLabel>Collect now</SectionLabel>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { key: 'full', label: 'Full' },
                        { key: 'half', label: '50%' },
                        { key: 'custom', label: 'Custom' },
                        { key: 'none', label: 'Nothing yet' },
                      ] as { key: CollectMode; label: string }[]).map((opt) => (
                        <Button
                          key={opt.key}
                          type="button"
                          size="sm"
                          variant={collectMode === opt.key ? 'default' : 'outline'}
                          className="min-h-[40px] cursor-pointer rounded-full"
                          onClick={() => {
                            setCollectMode(opt.key);
                            if (opt.key === 'custom' && !collectInput) setCollectInput('');
                          }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>

                    {collectMode === 'custom' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="pt-collect" className="text-xs">Amount collected (₹)</Label>
                        <Input
                          id="pt-collect"
                          type="number"
                          min={0}
                          max={breakdown.total}
                          className="h-11 rounded-xl"
                          placeholder="e.g. 10000"
                          value={collectInput}
                          onChange={(e) => setCollectInput(e.target.value)}
                        />
                      </div>
                    )}

                    {needsReference && (
                      <div className="space-y-1.5">
                        <Label htmlFor="pt-ref" className="text-xs">{refSpec!.label}</Label>
                        <Input
                          id="pt-ref"
                          value={txnRef}
                          className="h-11 rounded-xl"
                          placeholder={refSpec!.placeholder}
                          onChange={(e) => setTxnRef(e.target.value)}
                          aria-invalid={referenceMissing}
                        />
                        {referenceMissing && (
                          <p className="text-xs text-amber-600">
                            Required — this reference is how the payment is reconciled.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {needsDueDate && (
                    <div className="space-y-2 rounded-2xl bg-amber-50 p-4 dark:bg-amber-500/10">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-amber-600" />
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                          {formatINR(balanceDue)} balance — due when?
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {DUE_PRESETS.map((d) => (
                          <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant={dueDate === addDaysISO(d) ? 'default' : 'outline'}
                            className="min-h-[40px] cursor-pointer rounded-full bg-card"
                            onClick={() => setDueDate(addDaysISO(d))}
                          >
                            +{d} days
                          </Button>
                        ))}
                      </div>
                      <Label htmlFor="pt-due" className="sr-only">Balance due date</Label>
                      <Input
                        id="pt-due"
                        type="date"
                        className="h-11 rounded-xl bg-card"
                        min={todayISO()}
                        value={dueDate || addDaysISO(7)}
                        onChange={(e) => setDueDate(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* ----------------------------- FOOTER ----------------------------- */}
        <div className="space-y-3 border-t bg-card/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-xl font-bold tabular-nums">{formatINR(breakdown.total)}</span>
            </div>
            {paySource === 'in_person' && balanceDue > 0 && (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Collecting now</span>
                  <span className="tabular-nums">{formatINR(collectedNow)}</span>
                </div>
                <div className="flex justify-between text-xs font-medium text-amber-600">
                  <span>Balance due {prettyDate(dueDate || addDaysISO(7))}</span>
                  <span className="tabular-nums">{formatINR(balanceDue)}</span>
                </div>
              </>
            )}
          </div>

          {currentBlocker && (
            <p className="text-center text-xs text-muted-foreground">{currentBlocker}</p>
          )}

          <div className="flex gap-2">
            {step > 1 && (
              <Button
                variant="outline"
                className="min-h-[44px] flex-1 rounded-xl"
                onClick={goBack}
                disabled={purchase.isPending}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
            )}
            {step < 3 ? (
              <Button
                className="min-h-[44px] flex-[2] rounded-xl"
                onClick={goNext}
                disabled={!!currentBlocker}
              >
                Next <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button
                className="min-h-[44px] flex-[2] rounded-xl"
                disabled={!canCharge}
                onClick={() => purchase.mutate()}
              >
                {purchase.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
                ) : awaitingPayment ? (
                  <>Waiting for payment…</>
                ) : paySource === 'payment_link' ? (
                  <>Create &amp; send link · {formatINR(breakdown.total)}</>
                ) : collectedNow === 0 ? (
                  <>Assign now · {formatINR(breakdown.total)} unpaid</>
                ) : balanceDue > 0 ? (
                  <>Collect {formatINR(collectedNow)} &amp; assign</>

                ) : (
                  <>Charge &amp; assign · {formatINR(breakdown.total)}</>
                )}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
