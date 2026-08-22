import { format } from 'date-fns';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CalendarDays, FileText, IndianRupee, User } from 'lucide-react';
import { inr, paymentStateMeta, type TrainerPtBillingRow } from '@/hooks/useTrainerBilling';

interface Props {
  row: TrainerPtBillingRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Read-only money view for a trainer: what was sold, what's collected, what's due. */
export function TrainerSaleDetailDrawer({ row, open, onOpenChange }: Props) {
  const meta = row ? paymentStateMeta(row.payment_state) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Sale details</SheetTitle>
          <SheetDescription>
            Payment status for this personal training package. Collection is handled at the front
            desk.
          </SheetDescription>
        </SheetHeader>

        {row && (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-5 text-primary-foreground shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
                Balance due
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{inr(row.balance_due)}</p>
              <p className="mt-1 text-sm opacity-85">
                {inr(row.amount_paid)} collected of {inr(row.price_paid)}
              </p>
            </div>

            <div className="rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 dark:shadow-none">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <User className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {row.member_name || row.member_code}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.member_code}</p>
                </div>
                {meta && (
                  <Badge className={`rounded-full border-0 ${meta.className}`}>{meta.label}</Badge>
                )}
              </div>

              <Separator className="my-4" />

              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Package</dt>
                  <dd className="font-medium text-right">{row.package_name || '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">
                    {row.package_type === 'monthly' ? 'Monthly' : 'Session based'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Sold on
                  </dt>
                  <dd className="font-medium">
                    {row.sold_on ? format(new Date(row.sold_on), 'dd MMM yyyy') : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" aria-hidden /> Invoice
                  </dt>
                  <dd className="font-medium">{row.invoice_number || 'Not issued'}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Due date
                  </dt>
                  <dd className="font-medium">
                    {row.payment_due_date
                      ? format(new Date(row.payment_due_date), 'dd MMM yyyy')
                      : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <IndianRupee className="h-3.5 w-3.5" aria-hidden /> Package value
                  </dt>
                  <dd className="font-semibold tabular-nums">{inr(row.price_paid)}</dd>
                </div>
              </dl>
            </div>

            {row.balance_due > 0 && (
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                This client still owes {inr(row.balance_due)}. Please ask them to settle at the front
                desk — trainers cannot collect payments in the app.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
