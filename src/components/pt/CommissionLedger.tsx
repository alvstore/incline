import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Search, Wallet } from 'lucide-react';
import { formatISTDate } from '@/lib/utils/datetime';
import { exportToCSV } from '@/lib/csvExport';

interface Props {
  branchId?: string | null;
}

interface LedgerRow {
  id: string;
  sale_date: string | null;
  member_name: string;
  member_code: string | null;
  plan_months: number;
  package_name: string;
  trainer_name: string;
  total_amount: number;
  paid: number;
  due: number;
  percent: number;
  mode: string;
  base_commission: number;
  gst_deduction: number;
  net_commission: number;
  installments: { month: string; amount: number; status: string }[];
}

const MODE_BADGE: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-700',
  upi: 'bg-indigo-100 text-indigo-700',
  card: 'bg-violet-100 text-violet-700',
  bank_transfer: 'bg-blue-100 text-blue-700',
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export function CommissionLedger({ branchId }: Props) {
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading, isError } = useQuery<LedgerRow[]>({
    queryKey: ['pt-commission-ledger', branchId],
    queryFn: async () => {
      let q = supabase
        .from('trainer_commissions')
        .select('id, trainer_id, pt_package_id, member_id, branch_id, sale_date, plan_duration_months, total_sale_amount, percentage, payment_mode, base_commission, gst_deduction, net_total_commission, created_at')
        .eq('commission_type', 'package_sale')
        .order('sale_date', { ascending: false })
        .limit(500);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      const commissions = data || [];
      if (commissions.length === 0) return [];

      const commissionIds = commissions.map((c) => c.id);
      const packageIds = [...new Set(commissions.map((c) => c.pt_package_id).filter(Boolean))] as string[];
      const trainerIds = [...new Set(commissions.map((c) => c.trainer_id).filter(Boolean))] as string[];
      const memberIds = [...new Set(commissions.map((c: any) => c.member_id).filter(Boolean))] as string[];

      const [installmentsRes, packagesRes, trainersRes, membersRes] = await Promise.all([
        supabase
          .from('pt_commission_installments')
          .select('commission_id, payout_month, installment_amount, status')
          .in('commission_id', commissionIds),
        packageIds.length
          ? supabase
              .from('member_pt_packages')
              .select('id, invoice_id, price_paid, package_id')
              .in('id', packageIds)
          : Promise.resolve({ data: [], error: null } as any),
        trainerIds.length
          ? supabase.from('trainers').select('id, user_id').in('id', trainerIds)
          : Promise.resolve({ data: [], error: null } as any),
        memberIds.length
          ? supabase.from('members').select('id, member_code, user_id').in('id', memberIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const packages = (packagesRes.data || []) as any[];
      const invoiceIds = packages.map((p) => p.invoice_id).filter(Boolean);
      const catalogIds = [...new Set(packages.map((p) => p.package_id).filter(Boolean))];

      const [invoicesRes, catalogRes, profilesRes] = await Promise.all([
        invoiceIds.length
          ? supabase.from('invoices').select('id, total_amount, amount_paid').in('id', invoiceIds)
          : Promise.resolve({ data: [], error: null } as any),
        catalogIds.length
          ? supabase.from('pt_packages').select('id, name').in('id', catalogIds)
          : Promise.resolve({ data: [], error: null } as any),
        (() => {
          const userIds = [
            ...((trainersRes.data || []) as any[]).map((t) => t.user_id),
            ...((membersRes.data || []) as any[]).map((m) => m.user_id),
          ].filter(Boolean);
          return userIds.length
            ? supabase.from('profiles').select('id, full_name').in('id', [...new Set(userIds)])
            : Promise.resolve({ data: [], error: null } as any);
        })(),
      ]);

      const nameByUser = new Map(((profilesRes.data || []) as any[]).map((p) => [p.id, p.full_name]));
      const trainerName = new Map(((trainersRes.data || []) as any[]).map((t) => [t.id, nameByUser.get(t.user_id) || 'Trainer']));
      const memberMap = new Map(((membersRes.data || []) as any[]).map((m) => [m.id, m]));
      const packageMap = new Map(packages.map((p) => [p.id, p]));
      const invoiceMap = new Map(((invoicesRes.data || []) as any[]).map((i) => [i.id, i]));
      const catalogMap = new Map(((catalogRes.data || []) as any[]).map((p) => [p.id, p.name]));

      const installmentsByCommission = new Map<string, { month: string; amount: number; status: string }[]>();
      for (const inst of ((installmentsRes.data || []) as any[])) {
        const list = installmentsByCommission.get(inst.commission_id) || [];
        list.push({ month: inst.payout_month, amount: Number(inst.installment_amount), status: inst.status });
        installmentsByCommission.set(inst.commission_id, list);
      }

      return commissions.map((c: any): LedgerRow => {
        const pkg = c.pt_package_id ? packageMap.get(c.pt_package_id) : null;
        const invoice = pkg?.invoice_id ? invoiceMap.get(pkg.invoice_id) : null;
        const member = c.member_id ? memberMap.get(c.member_id) : null;
        const total = Number(c.total_sale_amount ?? pkg?.price_paid ?? 0);
        const paid = Number(invoice?.amount_paid ?? 0);
        return {
          id: c.id,
          sale_date: c.sale_date || c.created_at,
          member_name: (member && nameByUser.get(member.user_id)) || member?.member_code || 'Member',
          member_code: member?.member_code ?? null,
          plan_months: Number(c.plan_duration_months || 1),
          package_name: pkg?.package_id ? (catalogMap.get(pkg.package_id) || 'PT Package') : 'PT Package',
          trainer_name: trainerName.get(c.trainer_id) || 'Trainer',
          total_amount: total,
          paid,
          due: Math.max(0, total - paid),
          percent: Number(c.percentage || 0),
          mode: c.payment_mode || '—',
          base_commission: Number(c.base_commission || 0),
          gst_deduction: Number(c.gst_deduction || 0),
          net_commission: Number(c.net_total_commission ?? c.amount ?? 0),
          installments: (installmentsByCommission.get(c.id) || []).sort((a, b) => a.month.localeCompare(b.month)),
        };
      });
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.member_name.toLowerCase().includes(term) ||
        (r.member_code || '').toLowerCase().includes(term) ||
        r.trainer_name.toLowerCase().includes(term) ||
        r.package_name.toLowerCase().includes(term),
    );
  }, [rows, search]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => {
          acc.sales += r.total_amount;
          acc.due += r.due;
          acc.net += r.net_commission;
          acc.pending += r.installments.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
          acc.blocked += r.installments.filter((i) => i.status === 'blocked').reduce((s, i) => s + i.amount, 0);
          return acc;
        },
        { sales: 0, due: 0, net: 0, pending: 0, blocked: 0 },
      ),
    [filtered],
  );


  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
              <Wallet className="h-4 w-4" aria-hidden />
            </span>
            Trainer Commission Ledger
          </CardTitle>
          <CardDescription>
            Commission is locked on the full package value at sale. Non-cash sales carry a 5% deduction, and the net is paid
            out in equal monthly instalments through payroll.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Search commissions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Member, trainer or plan"
              className="w-56 rounded-xl pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-xl"
            disabled={filtered.length === 0}
            onClick={() =>
              exportToCSV(
                filtered.map((r) => ({
                  Date: r.sale_date ? formatISTDate(r.sale_date) : '',
                  Member: r.member_name,
                  'Member Code': r.member_code || '',
                  Plan: r.package_name,
                  Months: r.plan_months,
                  Trainer: r.trainer_name,
                  'Total Amount': r.total_amount,
                  Paid: r.paid,
                  Due: r.due,
                  'Comm %': r.percent,
                  Mode: r.mode,
                  'Base Commission': r.base_commission,
                  GST: r.gst_deduction,
                  'Net Commission': r.net_commission,
                })),
                'pt_commission_ledger',
              )
            }
          >
            <Download className="h-4 w-4" aria-hidden /> Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-destructive">Could not load the commission ledger. Please retry.</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Wallet className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-3 text-sm font-medium text-slate-900">No PT commissions yet</p>
            <p className="text-sm text-slate-500">Sell a personal training package and the commission will appear here.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                ['PT Sales', totals.sales, 'text-slate-900'],
                ['Outstanding Dues', totals.due, 'text-red-600'],
                ['Net Commission', totals.net, 'text-slate-900'],
                ['Payable Now', totals.pending, 'text-emerald-700'],
                ['Held (member dues)', totals.blocked, 'text-amber-700'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label as string}</p>
                  <p className={`text-xl font-bold ${tone as string}`}>{inr(value as number)}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Trainer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead className="text-right">Comm %</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Instalments</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <TableCell className="whitespace-nowrap text-sm text-slate-600">
                        {r.sale_date ? formatISTDate(r.sale_date) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium text-slate-900">{r.member_name}</div>
                        <div className="text-xs text-slate-500">{r.member_code || '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {r.package_name}
                        <span className="ml-1 text-xs text-slate-400">({r.plan_months} mo)</span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{r.trainer_name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{inr(r.total_amount)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-emerald-700">{inr(r.paid)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-600">{inr(r.due)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.percent}%</TableCell>
                      <TableCell>
                        <Badge
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${MODE_BADGE[r.mode] || 'bg-slate-100 text-slate-600'}`}
                        >
                          {r.mode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{inr(r.base_commission)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-700">
                        {r.gst_deduction > 0 ? `-${inr(r.gst_deduction)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-slate-900">
                        {inr(r.net_commission)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.installments.map((i) => (
                            <Badge
                              key={`${r.id}-${i.month}`}
                              title={
                                i.status === 'blocked'
                                  ? 'Held until the member clears their PT dues'
                                  : i.status === 'paid'
                                    ? 'Paid out through payroll'
                                    : 'Payable in this payroll month'
                              }
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                i.status === 'paid'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : i.status === 'blocked'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {formatISTDate(i.month).slice(3)} · {inr(i.amount)}
                              {i.status === 'blocked' ? ' · held' : ''}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>

                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
