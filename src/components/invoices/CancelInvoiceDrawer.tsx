import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, XCircle } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cancelInvoice } from '@/services/invoiceService';

interface CancelInvoiceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number?: string | null;
    total_amount?: number | null;
    amount_paid?: number | null;
    status?: string | null;
  } | null;
  onCancelled?: () => void;
}

/**
 * Right-side drawer to cancel an invoice.
 * Guarded by `can.cancelInvoice(roles)` at the caller.
 */
export function CancelInvoiceDrawer({
  open,
  onOpenChange,
  invoice,
  onCancelled,
}: CancelInvoiceDrawerProps) {
  const [reason, setReason] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!invoice?.id) throw new Error('No invoice');
      return cancelInvoice(invoice.id, reason.trim() || 'manual_cancel');
    },
    onSuccess: (res) => {
      if (res?.already) {
        toast.info(`Invoice was already ${res.already}.`);
      } else {
        toast.success(
          `Invoice cancelled — ${res.voided_payments ?? 0} payment(s) voided, ` +
            `${res.cancelled_packages ?? 0} package(s) reversed.`,
        );
      }
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice-details', invoice?.id] });
      qc.invalidateQueries({ queryKey: ['invoice-payments', invoice?.id] });
      qc.invalidateQueries({ queryKey: ['member-pt-packages'] });
      qc.invalidateQueries({ queryKey: ['active-member-packages'] });
      qc.invalidateQueries({ queryKey: ['trainer-sessions'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      setReason('');
      onOpenChange(false);
      onCancelled?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Could not cancel invoice');
    },
  });

  const alreadyClosed =
    invoice?.status === 'cancelled' || invoice?.status === 'refunded';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Cancel Invoice
          </SheetTitle>
          <SheetDescription>
            This will void any active payments on this invoice, cancel any
            linked PT package, and reverse pending trainer commissions.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="rounded-2xl border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Invoice
              </span>
              <Badge variant="outline">{invoice?.invoice_number || '—'}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold">
                ₹{Number(invoice?.total_amount || 0).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Paid so far</span>
              <span className="font-semibold text-emerald-600">
                ₹{Number(invoice?.amount_paid || 0).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current status</span>
              <Badge variant="secondary">{invoice?.status || '—'}</Badge>
            </div>
          </div>

          {alreadyClosed && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This invoice is already {invoice?.status}. No further action
                needed.
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Cash payments recorded manually will be marked as{' '}
              <strong>refunded</strong>. For Razorpay-settled payments you
              still need to trigger the refund inside the Razorpay dashboard —
              this action only reverses it in our books.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="cancel-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong PT package sold to member — sales error"
              rows={4}
              disabled={alreadyClosed || mutation.isPending}
            />
          </div>
        </div>

        <SheetFooter className="border-t pt-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Keep Invoice
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={
              alreadyClosed || reason.trim().length < 3 || mutation.isPending
            }
          >
            {mutation.isPending ? 'Cancelling…' : 'Cancel Invoice'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
