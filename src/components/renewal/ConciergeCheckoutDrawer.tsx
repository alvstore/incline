import { useNavigate } from 'react-router-dom';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, ReceiptText, ShieldCheck } from 'lucide-react';
import { formatINR, splitGst } from '@/lib/renewal/conciergePricing';
import type { ConciergeInvoiceSummary, ConciergeSelection } from '@/types/concierge';

interface ConciergeCheckoutDrawerProps {
  selection: ConciergeSelection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An invoice already raised for this member, if any. */
  payableInvoice: ConciergeInvoiceSummary | null;
  submitting: boolean;
  onConfirm: (selection: ConciergeSelection) => void;
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className={`text-sm tracking-wide ${strong ? 'text-slate-900' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-sm tracking-wide ${strong ? 'text-lg font-medium text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

/** Slide-out itemised receipt for a renewal or PT top-up. */
export function ConciergeCheckoutDrawer({
  selection, open, onOpenChange, payableInvoice, submitting, onConfirm,
}: ConciergeCheckoutDrawerProps) {
  const navigate = useNavigate();
  const breakdown = selection
    ? splitGst(selection.price, selection.gstRate, selection.gstInclusive)
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col bg-white p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-slate-200 px-6 py-6 text-left">
          <SheetTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <ReceiptText className="h-5 w-5 text-primary" aria-hidden />
            Your order
          </SheetTitle>
          <SheetDescription className="tracking-wide text-slate-500">
            Review the details before we confirm it with the front desk.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {selection && breakdown && (
            <div className="rounded-2xl bg-white p-5 shadow-lg shadow-slate-200/50">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                {selection.kind === 'membership' ? 'Membership' : 'Personal training'}
              </p>
              <p className="mt-2 text-lg font-medium tracking-wide text-slate-900">{selection.name}</p>
              <p className="mt-1 text-xs tracking-wide text-slate-500">{selection.detail}</p>

              <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200 pt-1">
                <Line label="Base price" value={formatINR(breakdown.base)} />
                <Line
                  label={breakdown.rate > 0 ? `GST (${breakdown.rate}%)` : 'GST'}
                  value={breakdown.rate > 0 ? formatINR(breakdown.tax) : 'Not applicable'}
                />
                <Line label="Total payable" value={formatINR(breakdown.total)} strong />
              </div>
            </div>
          )}

          {payableInvoice && (
            <div className="rounded-2xl bg-amber-50 p-5">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-primary">Awaiting payment</p>
              <p className="mt-2 text-sm tracking-wide text-slate-900">
                Invoice {payableInvoice.invoiceNumber} · {formatINR(payableInvoice.balance)} outstanding
              </p>
              <Button
                onClick={() => navigate(`/member/pay?invoice=${payableInvoice.id}`)}
                className="mt-4 h-12 w-full cursor-pointer rounded-2xl bg-theme-gradient text-sm font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Lock className="mr-2 h-4 w-4" aria-hidden />
                Pay via UPI / Card
              </Button>
            </div>
          )}

          <p className="flex items-start gap-2 text-xs leading-relaxed tracking-wide text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            Confirming sends this to your club's front desk. They raise the invoice and send you a secure
            payment link — your membership is only extended once payment is received.
          </p>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-12 cursor-pointer rounded-2xl border border-slate-200 text-sm tracking-wide text-slate-900 hover:bg-slate-100"
            >
              Cancel
            </Button>
            <Button
              disabled={!selection || submitting}
              onClick={() => selection && onConfirm(selection)}
              className="h-12 cursor-pointer rounded-2xl bg-theme-gradient text-sm font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Confirm order
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ConciergeCheckoutDrawer;
