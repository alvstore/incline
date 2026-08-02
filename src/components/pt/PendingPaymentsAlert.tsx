import { useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, XCircle, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { PTMemberPackageRow } from './ptTypes';

interface Props {
  rows: PTMemberPackageRow[];
  canCancelInvoice: boolean;
  onCancelInvoice: (invoice: {
    id: string;
    invoice_number: string | null;
    total_amount: number;
    amount_paid: number;
    status: string;
  }) => void;
}

/**
 * Unpaid PT sales read as a single alert strip; the detail lives in a sheet so
 * it never competes with the operational tables underneath.
 */
export function PendingPaymentsAlert({ rows, canCancelInvoice, onCancelInvoice }: Props) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;

  const total = rows.reduce((s, r) => s + Number(r.price_paid || 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-warning/30">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning"
          aria-hidden
        >
          <AlertCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {rows.length} package{rows.length === 1 ? '' : 's'} awaiting payment
          </p>
          <p className="text-xs text-muted-foreground">
            ₹{total.toLocaleString('en-IN')} sold but not yet collected — activate by collecting, or
            cancel to reverse the sale.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className="gap-1 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Review
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Packages awaiting payment</SheetTitle>
            <SheetDescription>
              Collect payment to activate the package, or cancel the invoice to reverse the sale and
              free up trainer commissions.
            </SheetDescription>
          </SheetHeader>

          <ul className="mt-4 max-h-[75vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((pkg) => (
              <li key={pkg.id} className="rounded-xl bg-card p-3 ring-1 ring-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {pkg.member_name || pkg.member_code || '—'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {pkg.package_name} · {pkg.trainer_name || 'Unassigned'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Expires {pkg.expiry_date ? format(new Date(pkg.expiry_date), 'PP') : '—'}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                    ₹{Number(pkg.price_paid || 0).toLocaleString('en-IN')}
                  </p>
                </div>

                <div className="mt-2 flex justify-end">
                  {canCancelInvoice && pkg.invoice_id ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        onCancelInvoice({
                          id: pkg.invoice_id as string,
                          invoice_number: pkg.invoice_number ?? null,
                          total_amount: Number(pkg.price_paid || 0),
                          amount_paid: 0,
                          status: 'pending',
                        })
                      }
                    >
                      <XCircle className="h-4 w-4" aria-hidden />
                      Cancel invoice
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Awaiting payment</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
