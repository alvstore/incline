import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BadgePercent, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ExceptionSale {
  id: string;
  sale_date: string;
  customer_name: string | null;
  buyer_type: string;
  original_amount: number | null;
  manual_discount: number;
  discount_reason: string | null;
  discount_by: string | null;
  sold_by: string | null;
  settlement: string | null;
  payment_method: string;
  payment_status: string | null;
  total_amount: number;
  invoices: { invoice_number: string | null } | null;
}

const SETTLEMENT_LABEL: Record<string, string> = {
  paid: 'Paid', link: 'Payment link', due: 'Due', salary_deduction: 'Salary deduction',
};

/** Every counter sale with a manual discount, a due, or a salary deduction — who, why, how paid. */
export function DiscountsDuesTab({ branchId }: { branchId: string | null }) {
  const [q, setQ] = useState('');
  const { data: sales = [], isLoading, isError } = useQuery({
    queryKey: ['pos-exceptions', branchId],
    queryFn: async () => {
      let query = supabase
        .from('pos_sales')
        .select('id, sale_date, customer_name, buyer_type, original_amount, manual_discount, discount_reason, discount_by, sold_by, settlement, payment_method, payment_status, total_amount, invoices!pos_sales_invoice_id_fkey(invoice_number)')
        .or('manual_discount.gt.0,settlement.in.(due,salary_deduction)')
        .order('sale_date', { ascending: false })
        .limit(200);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as ExceptionSale[];
    },
  });

  const userIds = useMemo(
    () => Array.from(new Set(sales.flatMap((s) => [s.sold_by, s.discount_by]).filter(Boolean))) as string[],
    [sales],
  );
  const { data: names = {} } = useQuery({
    queryKey: ['pos-exception-sellers', userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name ?? '—'])) as Record<string, string>;
    },
  });

  const rows = sales.filter((s) => {
    if (!q.trim()) return true;
    const hay = [s.customer_name, s.discount_reason, names[s.sold_by ?? ''], s.invoices?.invoice_number].join(' ').toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  const totalDiscount = rows.reduce((s, r) => s + Number(r.manual_discount || 0), 0);

  return (
    <Card className="rounded-xl">
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Discounts given</p>
            <p className="text-2xl font-bold tabular-nums">₹{totalDiscount.toLocaleString('en-IN')}</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search seller, buyer, reason, invoice" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search discounts and dues" />
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load discounts and dues. Refresh to try again.</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center text-muted-foreground">
            <BadgePercent className="h-8 w-8 mb-2" aria-hidden />
            <p className="text-sm">No discounted, due or salary-deduction sales yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Sold by</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id} className="hover:bg-muted/50 transition-colors duration-150">
                    <TableCell className="whitespace-nowrap">{format(new Date(s.sale_date), 'dd MMM yy, HH:mm')}</TableCell>
                    <TableCell className="font-mono text-xs">{s.invoices?.invoice_number ?? '—'}</TableCell>
                    <TableCell>
                      <div className="font-medium">{s.customer_name ?? 'Member'}</div>
                      {s.buyer_type === 'staff' && <Badge variant="outline" className="text-[10px]">Team</Badge>}
                    </TableCell>
                    <TableCell>{names[s.sold_by ?? ''] ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">₹{Number(s.original_amount ?? s.total_amount).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.manual_discount > 0 ? `−₹${Number(s.manual_discount).toLocaleString('en-IN')}` : '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate" title={s.discount_reason ?? ''}>{s.discount_reason ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">₹{Number(s.total_amount).toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        s.settlement === 'due' && s.payment_status !== 'paid'
                          ? 'bg-destructive/10 text-destructive border-destructive/20'
                          : s.settlement === 'salary_deduction'
                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                      }>
                        {SETTLEMENT_LABEL[s.settlement ?? ''] ?? s.payment_method}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
