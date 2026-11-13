import { useQuery } from '@tanstack/react-query';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CANCEL_REASONS, computeRefund, remainingDue,
  type BalanceAction, type RefundChoice,
} from '@/lib/membership/cancellationMath';

export interface CancellationState {
  reasonKey: string;
  reasonNote: string;
  balanceAction: BalanceAction;
  refundChoice: RefundChoice;
  customRefund: number;
  refundMethod: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'wallet';
}

export const initialCancellationState: CancellationState = {
  reasonKey: '',
  reasonNote: '',
  balanceAction: 'write_off',
  refundChoice: 'none',
  customRefund: 0,
  refundMethod: 'cash',
};

export function resolveReason(s: CancellationState): string {
  if (!s.reasonKey) return '';
  if (s.reasonKey === 'Other') return s.reasonNote.trim();
  return s.reasonNote.trim() ? `${s.reasonKey} — ${s.reasonNote.trim()}` : s.reasonKey;
}

export interface BillSummary { total: number; received: number; due: number }

/** Totals from the plan's linked bills, using money actually received. */
export function useMembershipBill(membershipId?: string | null) {
  return useQuery({
    queryKey: ['membership-bill', membershipId],
    enabled: !!membershipId,
    queryFn: async (): Promise<BillSummary> => {
      const { data, error } = await supabase
        .from('invoice_items')
        .select('invoice_id, invoices!inner(id, total_amount, amount_paid, status)')
        .eq('reference_id', membershipId!)
        .eq('reference_type', 'membership');
      if (error) throw error;
      const seen = new Set<string>();
      let total = 0; let received = 0; let due = 0;
      for (const row of (data || []) as Array<{ invoice_id: string; invoices: { id: string; total_amount: number | null; amount_paid: number | null; status: string } }>) {
        const inv = row.invoices;
        if (!inv || seen.has(inv.id) || inv.status === 'cancelled') continue;
        seen.add(inv.id);
        const t = Number(inv.total_amount || 0); const p = Number(inv.amount_paid || 0);
        total += t; received += p; due += Math.max(0, t - p);
      }
      return { total, received, due };
    },
  });
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function CancellationOptions({
  idPrefix, state, onChange, membership, reasonError,
}: {
  idPrefix: string;
  state: CancellationState;
  onChange: (s: CancellationState) => void;
  membership: { id: string; start_date: string; end_date: string } | null;
  reasonError?: string | null;
}) {
  const bill = useMembershipBill(membership?.id);
  const set = (patch: Partial<CancellationState>) => onChange({ ...state, ...patch });
  const totalDays = membership ? Math.max(0, differenceInDays(new Date(membership.end_date), new Date(membership.start_date))) : 0;
  const daysRemaining = membership ? Math.max(0, differenceInDays(new Date(membership.end_date), new Date())) : 0;
  const received = bill.data?.received ?? 0;
  const due = bill.data?.due ?? 0;
  const refund = computeRefund({ choice: state.refundChoice, received, totalDays, daysRemaining, custom: state.customRefund });
  const errId = `${idPrefix}-reason-error`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-reason`}>Reason <span aria-hidden="true" className="text-destructive">*</span></Label>
        <Select value={state.reasonKey} onValueChange={(v) => set({ reasonKey: v })}>
          <SelectTrigger id={`${idPrefix}-reason`} aria-required="true" aria-invalid={!!reasonError} aria-describedby={reasonError ? errId : undefined}>
            <SelectValue placeholder="Choose a reason" />
          </SelectTrigger>
          <SelectContent>
            {CANCEL_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Label htmlFor={`${idPrefix}-note`} className="sr-only">Reason details</Label>
        <Textarea
          id={`${idPrefix}-note`}
          rows={2}
          placeholder={state.reasonKey === 'Other' ? 'Describe the reason (required)' : 'Add details (optional)'}
          value={state.reasonNote}
          onChange={(e) => set({ reasonNote: e.target.value })}
        />
        {reasonError && <p id={errId} className="text-sm text-destructive">{reasonError}</p>}
      </div>

      {membership && (
        <section aria-labelledby={`${idPrefix}-bill`} className="rounded-2xl bg-muted/50 p-4">
          <h3 id={`${idPrefix}-bill`} className="mb-3 text-sm font-semibold text-foreground">Bill summary</h3>
          {bill.isLoading ? <Skeleton className="h-12 w-full" /> : bill.isError ? (
            <p className="text-sm text-destructive">Couldn't load the bill. <button type="button" className="underline" onClick={() => bill.refetch()}>Retry</button></p>
          ) : (
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-muted-foreground">Total</dt><dd className="font-semibold tabular-nums">{inr(bill.data?.total ?? 0)}</dd></div>
              <div><dt className="text-muted-foreground">Received</dt><dd className="font-semibold tabular-nums text-success">{inr(received)}</dd></div>
              <div><dt className="text-muted-foreground">Still due</dt><dd className="font-semibold tabular-nums text-destructive">{inr(due)}</dd></div>
            </dl>
          )}
        </section>
      )}

      {due > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Unpaid balance of {inr(due)}</legend>
          <RadioGroup value={state.balanceAction} onValueChange={(v) => set({ balanceAction: v as BalanceAction })}>
            <div className="flex items-center gap-2"><RadioGroupItem id={`${idPrefix}-wo`} value="write_off" /><Label htmlFor={`${idPrefix}-wo`} className="font-normal">Write off and close the bill (member owes nothing)</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem id={`${idPrefix}-keep`} value="keep" /><Label htmlFor={`${idPrefix}-keep`} className="font-normal">Keep it due (member still owes {inr(due)})</Label></div>
          </RadioGroup>
        </fieldset>
      )}

      {received > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Money already received ({inr(received)})</legend>
          <RadioGroup value={state.refundChoice} onValueChange={(v) => set({ refundChoice: v as RefundChoice })}>
            <div className="flex items-center gap-2"><RadioGroupItem id={`${idPrefix}-rn`} value="none" /><Label htmlFor={`${idPrefix}-rn`} className="font-normal">Keep it, no refund</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem id={`${idPrefix}-rf`} value="full" /><Label htmlFor={`${idPrefix}-rf`} className="font-normal">Refund everything received ({inr(received)})</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem id={`${idPrefix}-rp`} value="prorated" /><Label htmlFor={`${idPrefix}-rp`} className="font-normal">Refund unused days ({daysRemaining} of {totalDays} days = {inr(computeRefund({ choice: 'prorated', received, totalDays, daysRemaining }))})</Label></div>
            <div className="flex items-center gap-2"><RadioGroupItem id={`${idPrefix}-rc`} value="custom" /><Label htmlFor={`${idPrefix}-rc`} className="font-normal">Custom amount</Label></div>
          </RadioGroup>
          {state.refundChoice === 'custom' && (
            <div className="space-y-1 pl-6">
              <Label htmlFor={`${idPrefix}-custom`}>Refund amount (up to {inr(received)})</Label>
              <Input id={`${idPrefix}-custom`} type="number" inputMode="numeric" min={0} max={received} value={state.customRefund} onChange={(e) => set({ customRefund: Number(e.target.value) })} />
            </div>
          )}
          {refund > 0 && (
            <div className="space-y-1 pl-6">
              <Label htmlFor={`${idPrefix}-method`}>Refund method</Label>
              <Select value={state.refundMethod} onValueChange={(v) => set({ refundMethod: v as CancellationState['refundMethod'] })}>
                <SelectTrigger id={`${idPrefix}-method`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="wallet">Wallet credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </fieldset>
      )}

      <section aria-live="polite" className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
        <h3 className="mb-2 font-semibold text-foreground">What will happen</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>The plan ends today and gate access is removed immediately.</li>
          {due > 0 && <li>{state.balanceAction === 'write_off' ? `The unpaid ${inr(due)} is written off.` : `${inr(remainingDue(due, 'keep'))} stays due.`}</li>}
          <li>{refund > 0 ? `${inr(refund)} is refunded by ${state.refundMethod.replace('_', ' ')}.` : 'No refund is given.'}</li>
        </ul>
      </section>
    </div>
  );
}

export function useCancellationRefund(state: CancellationState, membership: { id: string; start_date: string; end_date: string } | null, received: number) {
  const totalDays = membership ? Math.max(0, differenceInDays(new Date(membership.end_date), new Date(membership.start_date))) : 0;
  const daysRemaining = membership ? Math.max(0, differenceInDays(new Date(membership.end_date), new Date())) : 0;
  return computeRefund({ choice: state.refundChoice, received, totalDays, daysRemaining, custom: state.customRefund });
}
