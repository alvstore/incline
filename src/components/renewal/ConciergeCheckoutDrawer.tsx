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
      <span className={`text-sm tracking-wide ${strong ? 'text-lux-ivory' : 'text-lux-mist'}`}>{label}</span>
      <span className={`text-sm tracking-wide ${strong ? 'text-lg font-medium text-lux-ivory' : 'text-lux-ivory/85'}`}>{value}</span>
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
        className="flex w-full flex-col border-lux-line/10 bg-gradient-lux p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-lux-line/10 px-6 py-6 text-left">
          <SheetTitle className="flex items-center gap-2 text-xl font-light tracking-wide text-lux-ivory">
            <ReceiptText className="h-5 w-5 text-lux-gold" aria-hidden />
            Your order
          </SheetTitle>
          <SheetDescription className="tracking-wide text-lux-mist">
            Review the details before we confirm it with the front desk.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {selection && breakdown && (
            <div className="rounded-3xl border border-lux-line/10 bg-lux-ivory/[0.04] p-5 backdrop-blur-xl">
              <p className="text-[11px] uppercase tracking-[0.3em] text-lux-mist">
                {selection.kind === 'membership' ? 'Membership' : 'Personal training'}
              </p>
              <p className="mt-2 text-lg font-medium tracking-wide text-lux-ivory">{selection.name}</p>
              <p className="mt-1 text-xs tracking-wide text-lux-mist">{selection.detail}</p>

              <div className="mt-5 divide-y divide-lux-line/10 border-t border-lux-line/10 pt-1">
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
            <div className="rounded-3xl border border-lux-gold/30 bg-lux-gold/[0.06] p-5">
              <p className="text-[11px] uppercase tracking-[0.3em] text-lux-gold">Awaiting payment</p>
              <p className="mt-2 text-sm tracking-wide text-lux-ivory">
                Invoice {payableInvoice.invoiceNumber} · {formatINR(payableInvoice.balance)} outstanding
              </p>
              <Button
                onClick={() => navigate(`/member/pay?invoice=${payableInvoice.id}`)}
                className="mt-4 h-12 w-full cursor-pointer rounded-2xl bg-gradient-gold text-sm font-medium tracking-wide text-lux-obsidian hover:opacity-90 focus-visible:ring-2 focus-visible:ring-lux-gold"
              >
                <Lock className="mr-2 h-4 w-4" aria-hidden />
                Pay via UPI / Card
              </Button>
            </div>
          )}

          <p className="flex items-start gap-2 text-xs leading-relaxed tracking-wide text-lux-mist">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lux-gold/80" aria-hidden />
            Confirming sends this to your club's front desk. They raise the invoice and send you a secure
            payment link — your membership is only extended once payment is received.
          </p>
        </div>

        <div className="border-t border-lux-line/10 bg-lux-obsidian/60 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-12 cursor-pointer rounded-2xl border border-lux-line/15 text-sm tracking-wide text-lux-ivory hover:bg-lux-ivory/5"
            >
              Cancel
            </Button>
            <Button
              disabled={!selection || submitting}
              onClick={() => selection && onConfirm(selection)}
              className="h-12 cursor-pointer rounded-2xl bg-gradient-gold text-sm font-medium tracking-wide text-lux-obsidian hover:opacity-90 focus-visible:ring-2 focus-visible:ring-lux-gold"
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
