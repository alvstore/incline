import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Building2, ChevronDown, CloudUpload, FileSpreadsheet, Loader2,
  PackageCheck, Receipt, IndianRupee,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { track } from '@/lib/analytics';
import { ImportPurchaseBillDrawer } from '@/components/products/ImportPurchaseBillDrawer';

interface VendorBill {
  id: string;
  bill_number: string | null;
  vendor: string | null;
  vendor_gstin: string | null;
  expense_date: string;
  amount: number;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  gst_rate: number | null;
  is_paid: boolean;
  payment_method: string | null;
  paid_at: string | null;
  receipt_url: string | null;
}
interface BillLine {
  id: string;
  item_name: string;
  hsn_code: string | null;
  quantity: number;
  rate: number;
  gst_rate: number | null;
  total_amount: number | null;
}

const inr = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

function MarkPaidForm({ bill, onDone }: { bill: VendorBill; onDone: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('expenses').update({
        is_paid: true,
        paid_at: new Date().toISOString(),
        payment_method: method as 'cash',
        payment_reference: ref || null,
      }).eq('id', bill.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`Bill ${bill.bill_number} marked as paid`);
      track('vendor_bill_marked_paid', { method });
      qc.invalidateQueries({ queryKey: ['vendor-bills'] });
      qc.invalidateQueries({ queryKey: ['expenses-console'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor={`pm-${bill.id}`}>Payment method</Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger id={`pm-${bill.id}`} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="upi">UPI</SelectItem>
            <SelectItem value="bank_transfer">Bank transfer</SelectItem>
            <SelectItem value="card">Card</SelectItem>
            <SelectItem value="cheque">Cheque</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`ref-${bill.id}`}>Reference (optional)</Label>
        <Input id={`ref-${bill.id}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UPI ref / cheque no." className="w-48" />
      </div>
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}
        Confirm payment
      </Button>
    </div>
  );
}

export function VendorBillsPanel({ branchId }: { branchId?: string | null }) {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  // Feature switch: purchase_bill_import (default on).
  const { data: importEnabled = true } = useQuery({
    queryKey: ['flag-purchase-bill-import'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'purchase_bill_import').is('branch_id', null).maybeSingle();
      if (error) return true;
      return (data?.value as string | undefined) !== 'false';
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: bills = [], isLoading, isError } = useQuery({
    queryKey: ['vendor-bills', branchId],
    queryFn: async () => {
      let q = supabase.from('expenses').select('id, bill_number, vendor, vendor_gstin, expense_date, amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, gst_rate, is_paid, payment_method, paid_at, receipt_url')
        .eq('expense_type', 'vendor_bill').order('expense_date', { ascending: false }).limit(200);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as VendorBill[];
    },
  });

  const billIds = useMemo(() => bills.map((b) => b.id), [bills]);
  const { data: syncedIds = new Set<string>() } = useQuery({
    queryKey: ['vendor-bills-zoho', billIds],
    enabled: billIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('zoho_sync_log').select('entity_id').eq('entity_type', 'bill').eq('status', 'synced').in('entity_id', billIds);
      if (error) return new Set<string>();
      return new Set((data ?? []).map((r) => r.entity_id as string));
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['vendor-bill-lines', openId],
    enabled: !!openId,
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_items').select('id, item_name, hsn_code, quantity, rate, gst_rate, total_amount').eq('expense_id', openId!);
      if (error) throw error;
      return (data ?? []) as BillLine[];
    },
  });

  const pushZoho = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('zoho-books-sync', { body: { mode: 'bills' } });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Zoho sync failed');
      return data as { bills_synced: number; bills_failed: number; errors: string[] };
    },
    onSuccess: (r) => {
      if (r.bills_failed > 0) toast.warning(`${r.bills_synced} pushed, ${r.bills_failed} failed: ${r.errors[0] ?? ''}`);
      else toast.success(r.bills_synced > 0 ? `${r.bills_synced} bill(s) pushed to Zoho Books` : 'All bills are already in Zoho Books');
      track('vendor_bills_pushed_zoho', { synced: r.bills_synced, failed: r.bills_failed });
      qc.invalidateQueries({ queryKey: ['vendor-bills-zoho'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stats = useMemo(() => {
    const unpaid = bills.filter((b) => !b.is_paid);
    return {
      count: bills.length,
      taxable: bills.reduce((s, b) => s + Number(b.taxable_amount ?? 0), 0),
      gst: bills.reduce((s, b) => s + Number(b.cgst_amount ?? 0) + Number(b.sgst_amount ?? 0) + Number(b.igst_amount ?? 0), 0),
      unpaidTotal: unpaid.reduce((s, b) => s + Number(b.amount), 0),
    };
  }, [bills]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-6 lg:col-span-3"><StatCard title="Vendor bills" value={String(stats.count)} icon={Receipt} /></div>
        <div className="col-span-6 lg:col-span-3"><StatCard title="Taxable value" value={inr(stats.taxable)} icon={IndianRupee} /></div>
        <div className="col-span-6 lg:col-span-3"><StatCard title="GST credit" value={inr(stats.gst)} icon={PackageCheck} /></div>
        <div className="col-span-6 lg:col-span-3"><StatCard title="Unpaid to vendors" value={inr(stats.unpaidTotal)} icon={Building2} /></div>
      </div>

      <Card className="rounded-2xl border-border/50 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
            <span>Vendor bills ({bills.length})</span>
            <div className="flex gap-2">
              {importEnabled && (
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileSpreadsheet className="h-4 w-4 mr-1.5" aria-hidden />Import purchase bill
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={pushZoho.isPending} onClick={() => pushZoho.mutate()}>
                {pushZoho.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4 mr-1.5" aria-hidden />}
                Push to Zoho
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={4} columns={7} />
          ) : isError ? (
            <p className="py-10 text-center text-sm text-destructive">Could not load vendor bills. Please retry.</p>
          ) : bills.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <div className="h-16 w-16 rounded-full bg-muted/80 flex items-center justify-center"><Receipt className="h-8 w-8 opacity-40" /></div>
              <div className="text-center">
                <p className="font-medium text-foreground/70">No vendor bills yet</p>
                <p className="text-sm mt-1">Import a supplier purchase sheet to create vendor bills, stock and products in one step.</p>
              </div>
              {importEnabled && <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="h-4 w-4 mr-1.5" aria-hidden />Import your first bill</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Bill</TableHead>
                  <TableHead scope="col">Vendor</TableHead>
                  <TableHead scope="col">Date</TableHead>
                  <TableHead scope="col">Taxable</TableHead>
                  <TableHead scope="col">GST</TableHead>
                  <TableHead scope="col">Total</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => {
                  const gst = Number(b.cgst_amount ?? 0) + Number(b.sgst_amount ?? 0) + Number(b.igst_amount ?? 0);
                  const open = openId === b.id;
                  return (
                    <>
                      <TableRow key={b.id} className="hover:bg-muted/40 transition-colors">
                        <TableCell className="font-medium">#{b.bill_number ?? '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{b.vendor ?? '—'}</span>
                            {b.vendor_gstin && <span className="text-xs text-muted-foreground">{b.vendor_gstin}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{format(new Date(b.expense_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>{inr(b.taxable_amount)}</TableCell>
                        <TableCell>{inr(gst)}</TableCell>
                        <TableCell className="font-semibold">{inr(b.amount)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            {b.is_paid
                              ? <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Paid{b.payment_method ? ` · ${b.payment_method.replace('_', ' ')}` : ''}</Badge>
                              : <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20">Unpaid</Badge>}
                            {syncedIds.has(b.id)
                              ? <Badge className="bg-muted text-muted-foreground border border-border text-[10px]">In Zoho</Badge>
                              : <Badge className="bg-muted text-muted-foreground border border-border text-[10px]">Not in Zoho</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            {!b.is_paid && (
                              <Button variant="ghost" size="sm" onClick={() => setPayingId(payingId === b.id ? null : b.id)}>
                                Mark paid
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`lines-${b.id}`} onClick={() => setOpenId(open ? null : b.id)}>
                              <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                              <span className="sr-only">{open ? 'Hide items' : 'Show items'}</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${b.id}-lines`}>
                          <TableCell colSpan={8} id={`lines-${b.id}`} className="bg-muted/20 p-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead scope="col">Item</TableHead>
                                  <TableHead scope="col">HSN</TableHead>
                                  <TableHead scope="col">Qty</TableHead>
                                  <TableHead scope="col">Rate</TableHead>
                                  <TableHead scope="col">GST %</TableHead>
                                  <TableHead scope="col">Total</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {lines.map((l) => (
                                  <TableRow key={l.id}>
                                    <TableCell>{l.item_name}</TableCell>
                                    <TableCell className="text-xs">{l.hsn_code || '—'}</TableCell>
                                    <TableCell>{l.quantity}</TableCell>
                                    <TableCell>{inr(l.rate)}</TableCell>
                                    <TableCell>{l.gst_rate ?? 0}%</TableCell>
                                    <TableCell>{inr(l.total_amount)}</TableCell>
                                  </TableRow>
                                ))}
                                {lines.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-4">No item lines recorded.</TableCell></TableRow>}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      )}
                      {payingId === b.id && (
                        <TableRow key={`${b.id}-pay`}>
                          <TableCell colSpan={8} className="p-3">
                            <MarkPaidForm bill={b} onDone={() => setPayingId(null)} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ImportPurchaseBillDrawer open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
