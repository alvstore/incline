import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Ban, Pencil, Loader2 } from 'lucide-react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { voidPayment as unifiedVoidPayment } from '@/services/billingService';
import { resolveMemberDisplay } from '@/lib/members/resolveMemberDisplay';

interface PaymentEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: any | null;
  /** Owner/admin get the full edit form; everyone else gets void-only. */
  canEdit: boolean;
}

const METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'wallet', 'cheque', 'other'];

export function PaymentEditDrawer({ open, onOpenChange, payment, canEdit }: PaymentEditDrawerProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'edit' | 'void'>(canEdit ? 'edit' : 'void');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [paymentDate, setPaymentDate] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!payment) return;
    setMode(canEdit ? 'edit' : 'void');
    setAmount(String(payment.amount ?? ''));
    setMethod(payment.payment_method || 'cash');
    setPaymentDate(payment.payment_date ? format(new Date(payment.payment_date), "yyyy-MM-dd'T'HH:mm") : '');
    setTransactionId(payment.transaction_id || '');
    setNotes(payment.notes || '');
    setReason('');
  }, [payment, canEdit]);

  const invalidate = () => {
    ['payments', 'invoices', 'all-overdue-invoices', 'member-wallet', 'member-wallet-balance', 'member-invoices']
      .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };

  const editMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('edit_payment' as any, {
        p_payment_id: payment.id,
        p_amount: Number(amount),
        p_payment_method: method,
        p_payment_date: paymentDate ? new Date(paymentDate).toISOString() : null,
        p_transaction_id: transactionId || null,
        p_notes: notes || null,
        p_reason: reason,
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) throw new Error(res?.error || 'Failed to edit payment');
      return res;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Payment corrected — invoice balance recalculated');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to edit payment'),
  });

  const voidMutation = useMutation({
    mutationFn: async () => unifiedVoidPayment(payment.id, reason),
    onSuccess: () => {
      invalidate();
      toast.success('Payment voided — invoice balance reversed');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to void payment'),
  });

  const busy = editMutation.isPending || voidMutation.isPending;
  const display = payment ? resolveMemberDisplay(payment.members) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {mode === 'edit' ? <Pencil className="h-5 w-5 text-primary" /> : <Ban className="h-5 w-5 text-destructive" />}
            {mode === 'edit' ? 'Edit Payment' : 'Void Payment'}
          </SheetTitle>
          <SheetDescription>
            {mode === 'edit'
              ? 'The original entry is voided and a corrected payment is recorded, so the audit trail stays intact.'
              : 'The original record is preserved for audit purposes and the invoice balance is reversed.'}
          </SheetDescription>
        </SheetHeader>

        {payment && (
          <div className="space-y-5 py-5">
            <Card className="rounded-2xl border-border/60">
              <CardContent className="pt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Member</span>
                  <span className="font-medium">{display?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current amount</span>
                  <span className="font-semibold">₹{Number(payment.amount || 0).toLocaleString('en-IN')}</span>
                </div>
                {payment.invoices?.invoice_number && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice</span>
                    <span className="font-mono">{payment.invoices.invoice_number}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recorded</span>
                  <span>{format(new Date(payment.payment_date), 'dd MMM yyyy HH:mm')}</span>
                </div>
              </CardContent>
            </Card>

            {mode === 'edit' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pay-amount">Amount (₹) <span className="text-destructive">*</span></Label>
                  <Input id="pay-amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-method">Payment method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger id="pay-method" className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{m.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-date">Payment date</Label>
                  <Input id="pay-date" type="datetime-local" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-ref">Reference / transaction ID</Label>
                  <Input id="pay-ref" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-notes">Notes</Label>
                  <Textarea id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[70px]" />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="pay-reason">
                {mode === 'edit' ? 'Reason for correction' : 'Reason for voiding'} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="pay-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={mode === 'edit' ? 'e.g. wrong amount entered at reception' : 'e.g. duplicate entry'}
                className="min-h-[80px]"
              />
            </div>

            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={mode === 'edit' ? 'text-destructive hover:text-destructive' : ''}
                onClick={() => setMode(mode === 'edit' ? 'void' : 'edit')}
              >
                {mode === 'edit' ? 'Void this payment instead' : 'Back to editing'}
              </Button>
            )}
          </div>
        )}

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {mode === 'edit' ? (
            <Button
              disabled={busy || !reason.trim() || !amount || Number(amount) <= 0}
              onClick={() => editMutation.mutate()}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Pencil className="h-4 w-4 mr-1" />}
              Save correction
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => voidMutation.mutate()}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Ban className="h-4 w-4 mr-1" />}
              Void payment
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
