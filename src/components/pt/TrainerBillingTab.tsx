import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, IndianRupee, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  inr,
  paymentStateMeta,
  useTrainerBilling,
  type TrainerPtBillingRow,
} from '@/hooks/useTrainerBilling';
import { TrainerSaleDetailDrawer } from './TrainerSaleDetailDrawer';

interface Props {
  trainerId?: string | null;
  enabled?: boolean;
}

/**
 * "Did my PT client actually pay?" — the trainer-facing money view.
 * Read-only: figures come from a security-definer RPC, never raw invoices.
 */
export function TrainerBillingTab({ trainerId, enabled = true }: Props) {
  const { data: rows = [], isLoading, isError, error } = useTrainerBilling(trainerId, enabled);
  const [selected, setSelected] = useState<TrainerPtBillingRow | null>(null);

  const totals = useMemo(() => {
    const active = rows.filter((r) => !['cancelled', 'refunded'].includes(r.payment_state));
    return {
      sold: active.reduce((s, r) => s + r.price_paid, 0),
      collected: active.reduce((s, r) => s + r.amount_paid, 0),
      outstanding: active.reduce((s, r) => s + r.balance_due, 0),
      overdue: active.filter((r) => r.payment_state === 'overdue').length,
    };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
          <p className="text-sm font-medium">Could not load your PT billing</p>
          <p className="text-xs text-muted-foreground">{(error as Error)?.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (!rows.length) {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 dark:shadow-none">
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No PT sales yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Packages sold with you as the assigned trainer will appear here with their payment
            status and due dates.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-5 text-primary-foreground shadow-lg">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-80">
            <TrendingUp className="h-4 w-4" aria-hidden /> Sold by me
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">{inr(totals.sold)}</p>
        </div>
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 dark:shadow-none">
          <CardContent className="flex items-center gap-3 p-5">
            <span className="rounded-full bg-emerald-50 p-2 text-emerald-600" aria-hidden>
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Collected
              </p>
              <p className="text-2xl font-bold tabular-nums">{inr(totals.collected)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 dark:shadow-none">
          <CardContent className="flex items-center gap-3 p-5">
            <span className="rounded-full bg-red-50 p-2 text-red-600" aria-hidden>
              <IndianRupee className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Outstanding
              </p>
              <p className="text-2xl font-bold tabular-nums">{inr(totals.outstanding)}</p>
              {totals.overdue > 0 && (
                <p className="text-xs font-medium text-red-600">{totals.overdue} overdue</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <ul className="space-y-3">
        {rows.map((row) => {
          const meta = paymentStateMeta(row.payment_state);
          return (
            <li key={row.package_row_id}>
              <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 dark:shadow-none">
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-foreground">
                        {row.member_name || row.member_code}
                      </p>
                      <Badge className={`rounded-full border-0 text-xs ${meta.className}`}>
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.member_code} · {row.package_name || 'Package'}
                      {row.invoice_number ? ` · ${row.invoice_number}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.payment_due_date
                        ? `Due ${format(new Date(row.payment_due_date), 'dd MMM yyyy')}`
                        : row.sold_on
                          ? `Sold ${format(new Date(row.sold_on), 'dd MMM yyyy')}`
                          : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums text-foreground">
                      {inr(row.price_paid)}
                    </p>
                    <p
                      className={`text-xs tabular-nums ${row.balance_due > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                    >
                      {row.balance_due > 0 ? `${inr(row.balance_due)} due` : 'Fully paid'}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSelected(row)}
                    aria-label={`View sale details for ${row.member_name || row.member_code}`}
                  >
                    Details
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <TrainerSaleDetailDrawer
        row={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
