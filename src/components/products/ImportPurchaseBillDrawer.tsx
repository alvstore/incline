import { useMemo, useRef, useState } from 'react';
import readXlsxFile from 'read-excel-file/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { billTotals, parsePurchaseRows, type PurchaseBill, VALID_GST_RATES } from '@/lib/purchases/parsePurchaseSheet';
import { track } from '@/lib/analytics';

interface Props { open: boolean; onOpenChange: (o: boolean) => void }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TEMPLATE = 'Invoice No,Invoice Date,Vendor Name,Vendor GSTIN,Item Name,HSN Code,Qty,Rate,Taxable Amount,CGST (2.5%),SGST (2.5%),Total Amount\n';

export function ImportPurchaseBillDrawer({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { effectiveBranchId } = useBranchContext();
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [branchId, setBranchId] = useState<string>('');
  const [isPaid, setIsPaid] = useState(false);
  const [method, setMethod] = useState('bank_transfer');
  const [announce, setAnnounce] = useState('');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches').select('id, name').eq('is_active', true);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });
  const branch = branchId || (effectiveBranchId && effectiveBranchId !== 'all' ? effectiveBranchId : branches[0]?.id || '');

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-purchase', branch],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const reset = () => { setBills([]); setErrors([]); setFileName(''); setIsPaid(false); };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    try {
      let rows: unknown[][];
      if (/\.csv$/i.test(f.name)) {
        rows = (await f.text()).split(/\r?\n/).map((l) => l.split(','));
      } else {
        const res = (await readXlsxFile(f)) as unknown;
        const first = Array.isArray(res) ? res[0] : null;
        rows = (first && !Array.isArray(first) && typeof first === 'object' && 'data' in first ? (first as { data: unknown[][] }).data : res) as unknown[][];
      }
      const res = parsePurchaseRows(rows);
      // auto-match existing products by exact name
      const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p.id]));
      res.bills.forEach((b) => b.lines.forEach((l) => { l.product_id = byName.get(l.item_name.toLowerCase()) ?? null; }));
      setBills(res.bills);
      setErrors(res.errors);
      track('purchase_import_started', { bills: res.bills.length, lines: res.bills.reduce((s, b) => s + b.lines.length, 0) });
    } catch (e) {
      setErrors([`Could not read the file: ${(e as Error).message}`]);
    }
  };

  const updateLine = (bi: number, li: number, patch: Partial<PurchaseBill['lines'][number]>) => {
    setBills((prev) => prev.map((b, i) => i !== bi ? b : { ...b, lines: b.lines.map((l, j) => j !== li ? l : { ...l, ...patch }) }));
  };

  const grand = useMemo(() => bills.reduce((a, b) => { const t = billTotals(b); return { taxable: a.taxable + t.taxable, gst: a.gst + t.gst, total: a.total + t.total }; }, { taxable: 0, gst: 0, total: 0 }), [bills]);
  const blocking = bills.some((b) => b.lines.some((l) => !(l.quantity > 0) || !(l.rate >= 0) || !VALID_GST_RATES.includes(l.gst_rate))) || !branch;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        branch_id: branch, is_paid: isPaid, payment_method: isPaid ? method : null,
        bills: bills.map((b) => ({
          bill_number: b.bill_number, bill_date: b.bill_date, vendor: b.vendor, vendor_gstin: b.vendor_gstin, bill_total: b.sheet_total,
          lines: b.lines.map((l) => ({ product_id: l.product_id, item_name: l.item_name, hsn_code: l.hsn_code, quantity: l.quantity, rate: l.rate, gst_rate: l.gst_rate })),
        })),
      };
      const { data, error } = await supabase.rpc('import_purchase_bill', { p_payload: payload });
      if (error) throw new Error(error.message);
      return data as { bills: number; lines: number; new_products: number };
    },
    onSuccess: (r) => {
      const msg = `Imported ${r.bills} bills, ${r.lines} stock lines, ${r.new_products} new products (hidden from sale until activated).`;
      toast.success(msg); setAnnounce(msg);
      track('purchase_import_completed', { bills: r.bills, lines: r.lines, new_products: r.new_products });
      ['products', 'inventory', 'expenses', 'products-to-activate', 'product-batches'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      reset(); onOpenChange(false);
    },
    onError: (e: Error) => { toast.error(e.message); setAnnounce(e.message); },
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent className="w-full sm:max-w-5xl p-0 flex flex-col">
        <SheetHeader className="p-6 border-b border-border">
          <SheetTitle>Import purchase bill</SheetTitle>
          <SheetDescription>Upload a supplier sheet. Rates are saved as purchase cost — not selling price. Stock is added and a vendor bill with GST is recorded.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="sr-only" aria-live="polite">{announce}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pb-branch">Branch</Label>
              <Select value={branch} onValueChange={setBranchId}>
                <SelectTrigger id="pb-branch"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-file">Supplier sheet (.xlsx or .csv)</Label>
              <div className="flex gap-2">
                <Button id="pb-file" type="button" variant="outline" className="flex-1 justify-start" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" aria-hidden />{fileName || 'Choose file'}
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Download blank template" asChild>
                  <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="purchase-bill-template.csv"><Download className="h-4 w-4" /></a>
                </Button>
              </div>
              <input ref={fileRef} type="file" className="hidden" accept=".xlsx,.csv" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 pt-7">
                <Switch id="pb-paid" checked={isPaid} onCheckedChange={setIsPaid} />
                <Label htmlFor="pb-paid">Already paid to supplier</Label>
              </div>
              {isPaid && (
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive space-y-1">
              {errors.map((e) => <p key={e} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{e}</p>)}
            </div>
          )}

          {bills.length === 0 && errors.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2" aria-hidden />
              <p className="text-sm">Columns: Invoice No, Invoice Date, Vendor Name, Vendor GSTIN, Item Name, HSN Code, Qty, Rate, CGST (x%), SGST (x%), Total Amount.</p>
            </div>
          )}

          {bills.length > 0 && (
            <div className="grid gap-4 grid-cols-12">
              {[['Bills', String(bills.length)], ['Taxable', inr(grand.taxable)], ['GST (input credit)', inr(grand.gst)], ['Total', inr(grand.total)]].map(([k, v]) => (
                <div key={k} className="col-span-6 md:col-span-3 rounded-xl border border-border bg-card p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{k}</p>
                  <p className="text-xl font-bold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
          )}

          {bills.map((b, bi) => {
            const t = billTotals(b);
            return (
              <section key={`${b.vendor_gstin}-${b.bill_number}`} className="rounded-xl border border-border bg-card" aria-label={`Bill ${b.bill_number}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-border">
                  <div>
                    <p className="font-semibold">Bill {b.bill_number} · {b.vendor}</p>
                    <p className="text-xs text-muted-foreground">{b.bill_date} · GSTIN {b.vendor_gstin || '—'}</p>
                  </div>
                  <p className="text-sm tabular-nums">Taxable {inr(t.taxable)} · GST {inr(t.gst)} · <span className="font-semibold">{inr(b.sheet_total ?? t.total)}</span></p>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead scope="col">Item</TableHead>
                        <TableHead scope="col">Product</TableHead>
                        <TableHead scope="col" className="w-28">HSN</TableHead>
                        <TableHead scope="col" className="w-20">Qty</TableHead>
                        <TableHead scope="col" className="w-28">Cost/unit</TableHead>
                        <TableHead scope="col" className="w-24">GST %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.lines.map((l, li) => (
                        <TableRow key={l.key} className="hover:bg-muted/50 transition-colors duration-150 align-top">
                          <TableCell>
                            <p className="font-medium">{l.item_name}</p>
                            {l.warnings.map((w) => (
                              <Badge key={w} variant="outline" className="mt-1 mr-1 bg-amber-500/10 text-amber-500 border-amber-500/20 gap-1">
                                <AlertTriangle className="h-3 w-3" aria-hidden />{w}
                              </Badge>
                            ))}
                          </TableCell>
                          <TableCell className="min-w-48">
                            <Select value={l.product_id ?? '__new'} onValueChange={(v) => updateLine(bi, li, { product_id: v === '__new' ? null : v })}>
                              <SelectTrigger aria-label={`Product for ${l.item_name}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__new">Create new product</SelectItem>
                                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell><Input aria-label={`HSN for ${l.item_name}`} value={l.hsn_code} onChange={(e) => updateLine(bi, li, { hsn_code: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></TableCell>
                          <TableCell><Input aria-label={`Quantity for ${l.item_name}`} type="number" min={1} value={l.quantity} onChange={(e) => updateLine(bi, li, { quantity: Number(e.target.value) })} /></TableCell>
                          <TableCell className="tabular-nums pt-5">{inr(l.rate)}</TableCell>
                          <TableCell>
                            <Select value={String(l.gst_rate)} onValueChange={(v) => updateLine(bi, li, { gst_rate: Number(v) })}>
                              <SelectTrigger aria-label={`GST rate for ${l.item_name}`}><SelectValue /></SelectTrigger>
                              <SelectContent>{VALID_GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            );
          })}
        </div>
        <div className="flex gap-3 p-6 border-t border-border">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="flex-1" disabled={!bills.length || blocking || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
            {save.isPending ? 'Importing…' : `Import ${bills.length || ''} bill${bills.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
