import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Dumbbell, Wallet, CheckCircle2, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { applyAdvanceRecovery } from '@/services/expenseService';

export interface SettlementItem {
  id: string;
  user_id: string;
  staff_kind: string | null;
  status: string;
  final_base: number | string;
  final_ot: number | string;
  final_bonus: number | string;
  final_deductions: number | string;
  final_advance: number | string;
  final_penalty: number | string;
  profile?: { full_name?: string | null } | null;
}

interface PtRow {
  installment_id: string;
  payout_month: string;
  installment_index: number;
  plan_months: number;
  amount: number;
  member_name: string;
  member_code: string | null;
  package_name: string | null;
  sale_date: string | null;
  settled: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: SettlementItem | null;
  periodStart: string;
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const n = (v: unknown) => Number(v || 0);

export function GeneratePayrollSheet({ open, onOpenChange, item, periodStart }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjustment, setAdjustment] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');

  const { data: rows = [], isLoading, isError, refetch } = useQuery<PtRow[]>({
    queryKey: ['pt_settlements', item?.id],
    enabled: open && !!item?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('payroll_item_pt_breakdown' as never, { p_item_id: item!.id } as never);
      if (error) throw error;
      return ((data as unknown as PtRow[]) || []).map((r) => ({ ...r, amount: Number(r.amount) }));
    },
  });

  useEffect(() => {
    if (open) {
      setSelected(new Set(rows.filter((r) => !r.settled).map((r) => r.installment_id)));
    }
  }, [open, rows]);

  useEffect(() => {
    if (!open) { setAdjustment(''); setReason(''); setReference(''); }
  }, [open]);

  const ptTotal = useMemo(
    () => rows.filter((r) => selected.has(r.installment_id)).reduce((s, r) => s + r.amount, 0),
    [rows, selected],
  );
  const adj = Number(adjustment) || 0;
  const base = n(item?.final_base);
  const net = item
    ? base + ptTotal + n(item.final_ot) + n(item.final_bonus) + adj
      - (n(item.final_deductions) + n(item.final_advance) + n(item.final_penalty))
    : 0;

  const settle = useMutation({
    mutationFn: async () => {
      const ids = [...selected];
      const { data, error } = await supabase.rpc('payroll_settle_item' as never, {
        p_item_id: item!.id, p_installment_ids: ids, p_adjustment: adj,
        p_reason: reason || null, p_method: method, p_reference: reference || null,
      } as never);
      if (error) throw error;
      if (n(item!.final_advance) > 0) {
        try { await applyAdvanceRecovery(item!.user_id, n(item!.final_advance)); } catch { /* ledger retry is manual */ }
      }
      return data as unknown as { settled_count: number };
    },
    onSuccess: (res) => {
      toast.success(`Payroll finalized and ${res?.settled_count ?? 0} PT sessions settled.`);
      ['payroll', 'payroll-items', 'payroll-runs', 'pt_settlements', 'staff', 'hrm-payroll',
        'pt-commission-ledger', 'trainer-commissions', 'salary-advances', 'pending-advance']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const monthYear = periodStart ? format(parseISO(periodStart), 'MMMM yyyy') : '';
  const adjInvalid = adj !== 0 && !reason.trim();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]">
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <SheetTitle className="tracking-tight">Payroll Settlement — {item?.profile?.full_name || 'Staff'}</SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            {monthYear} Pay Cycle
            {item?.staff_kind && <Badge variant="outline" className="capitalize">{item.staff_kind}</Badge>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Wallet className="h-4 w-4" /> Base Salary
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">{inr(base)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Dumbbell className="h-4 w-4" /> PT Commissions
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums">{inr(ptTotal)}</p>
              <p className="text-xs text-muted-foreground">across {selected.size} client {selected.size === 1 ? 'entry' : 'entries'}</p>
            </div>
          </div>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Itemized PT client sessions (to be settled)
            </h4>
            <div className="rounded-xl border border-border max-h-80 overflow-y-auto divide-y divide-border">
              {isLoading ? (
                <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : isError ? (
                <div className="p-6 text-center text-sm text-muted-foreground space-y-2">
                  <AlertCircle className="h-6 w-6 mx-auto text-destructive" />
                  <p>Couldn't load PT sessions.</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                </div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <Dumbbell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No pending PT sessions to settle.
                </div>
              ) : rows.map((r) => (
                <label key={r.installment_id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors duration-150">
                  <Checkbox checked={selected.has(r.installment_id)} disabled={r.settled}
                    onCheckedChange={() => toggle(r.installment_id)}
                    aria-label={`Include ${r.member_name}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {format(parseISO(r.payout_month), 'MMM yyyy')} — {r.member_name}
                      {r.member_code && <span className="text-muted-foreground font-normal"> · {r.member_code}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.package_name || 'PT package'} · month {r.installment_index} of {r.plan_months}
                      {r.sale_date && ` · sold ${format(parseISO(r.sale_date), 'd MMM')}`}
                    </p>
                  </div>
                  {r.settled
                    ? <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Settled</Badge>
                    : <span className="text-sm font-semibold tabular-nums">{inr(r.amount)}</span>}
                </label>
              ))}
            </div>
            {rows.length > 0 && selected.size < rows.filter((r) => !r.settled).length && (
              <p className="text-xs text-muted-foreground">Unticked entries stay pending and roll into the next pay cycle.</p>
            )}
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="adj">Adjustment (₹)</Label>
              <Input id="adj" type="number" inputMode="decimal" value={adjustment}
                onChange={(e) => setAdjustment(e.target.value)} placeholder="+ incentive / − deduction" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-reason">Reason {adj !== 0 && <span className="text-destructive">*</span>}</Label>
              <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Diwali incentive" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref">Reference / UTR</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </section>

          {item && (n(item.final_ot) + n(item.final_bonus) + n(item.final_deductions) + n(item.final_advance) + n(item.final_penalty)) > 0 && (
            <div className="rounded-xl bg-muted/50 p-4 text-xs space-y-1 tabular-nums">
              {n(item.final_ot) > 0 && <div className="flex justify-between"><span>Overtime</span><span>{inr(n(item.final_ot))}</span></div>}
              {n(item.final_bonus) > 0 && <div className="flex justify-between"><span>Bonus</span><span>{inr(n(item.final_bonus))}</span></div>}
              {n(item.final_deductions) > 0 && <div className="flex justify-between text-destructive"><span>Statutory deductions</span><span>-{inr(n(item.final_deductions))}</span></div>}
              {n(item.final_advance) > 0 && <div className="flex justify-between text-destructive"><span>Advance recovery</span><span>-{inr(n(item.final_advance))}</span></div>}
              {n(item.final_penalty) > 0 && <div className="flex justify-between text-destructive"><span>Penalties</span><span>-{inr(n(item.final_penalty))}</span></div>}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-card px-6 py-4 pb-safe space-y-3">
          <div className="flex items-end justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Net Payable</span>
            <span className="text-3xl font-bold tabular-nums">{inr(net)}</span>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-[2]" disabled={!item || settle.isPending || isLoading || adjInvalid || net < 0}
              onClick={() => settle.mutate()}>
              {settle.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Confirm Settlement & Mark as Paid
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
