import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileSpreadsheet, Package, FileText, Search, ReceiptText, BookOpen } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useGstReport } from '@/lib/finance/useGstReport';
import {
  exportAccountantPack, exportGstr1B2B, exportGstr1B2C, exportHsnSummary, exportSalesRegister,
  exportExemptSupplies, exportDocumentsIssued,
} from '@/lib/finance/csvExports';
import { toast } from 'sonner';

type Props = {
  branchId: string | undefined;
  range: { from: Date; to: Date } | null;
  formatCurrency: (n: number) => string;
};

const STREAM_LABELS: Record<string, string> = {
  membership: 'Memberships',
  pt_package: 'PT Packages',
  addon: 'Add-ons',
  class: 'Classes',
  pos: 'POS Retail',
  other: 'Other',
};

export function GstReportTab({ branchId, range, formatCurrency }: Props) {
  const { data, isLoading } = useGstReport(branchId, range);
  const [registerSearch, setRegisterSearch] = useState('');
  const [registerBucket, setRegisterBucket] = useState<'all' | 'taxable' | 'exempt'>('all');
  const [registerStream, setRegisterStream] = useState<string>('all');

  const registerRows = useMemo(() => {
    if (!data) return [] as any[];
    const tagged = [
      ...data.lines.map(l => ({ ...l, bucket: 'taxable' as const })),
      ...data.exemptLines.map(l => ({ ...l, bucket: 'exempt' as const })),
    ];
    const q = registerSearch.trim().toLowerCase();
    return tagged
      .filter(r => registerBucket === 'all' || r.bucket === registerBucket)
      .filter(r => registerStream === 'all' || r.source === registerStream)
      .filter(r => !q || r.invoice_number.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data, registerSearch, registerBucket, registerStream]);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const { totals, byRate, streams, lines, exemptLines, hsnBuckets, documentsIssued, cancelledInvoices, posSales } = data;
  const b2b = lines.filter(l => !!l.customer_gstin);
  const b2c = lines.filter(l => !l.customer_gstin);


  return (
    <div className="space-y-6">
      {/* Hero KPI strip */}
      <Card className="rounded-2xl border-none bg-gradient-to-r from-primary to-primary text-primary-foreground shadow-lg shadow-primary/20">
        <CardContent className="grid grid-cols-2 gap-6 p-6 md:grid-cols-6">
          <Kpi label="Taxable Value" value={formatCurrency(totals.taxable)} />
          <Kpi label="CGST" value={formatCurrency(totals.cgst)} />
          <Kpi label="SGST" value={formatCurrency(totals.sgst)} />
          <Kpi label="IGST" value={formatCurrency(totals.igst)} />
          <Kpi label="Total Tax" value={formatCurrency(totals.tax)} highlight />
          <Kpi label="Exempt / Nil Supply" value={formatCurrency(totals.exempt)} highlight />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Taxable supplies only include GST invoices with a rate above 0%. Exempt / nil-rated invoices are reported separately in Table 8 and
        {cancelledInvoices.length > 0 ? ` ${cancelledInvoices.length} cancelled/draft document(s) are excluded from all tax buckets.` : ' cancelled documents are excluded from all tax buckets.'}
      </p>

      {/* Accountant pack export */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-lg shadow-primary/10">
        <div>
          <p className="text-sm font-semibold text-foreground">Accountant Export Pack</p>
          <p className="text-xs text-muted-foreground">One click — B2B + B2C + HSN summary + Table 8 exempt + Table 13 documents + sales register.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { exportAccountantPack(lines, hsnBuckets, exemptLines, documentsIssued); toast.success('Accountant pack downloaded'); }}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Download Accountant Pack
          </Button>
        </div>
      </div>


      {/* Revenue by stream */}
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader>
          <CardTitle className="text-base font-bold">Revenue by Stream</CardTitle>
          <CardDescription>Memberships, PT, add-ons, POS retail breakdown — taxable + tax</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stream</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Gross</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Object.entries(streams) as [string, any][]).filter(([, v]) => v.count > 0).map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell><Badge variant="outline">{STREAM_LABELS[k] || k}</Badge></TableCell>
                  <TableCell className="text-right">{v.count}</TableCell>
                  <TableCell className="text-right">{formatCurrency(v.taxable)}</TableCell>
                  <TableCell className="text-right text-primary">{formatCurrency(v.tax)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(v.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* By rate */}
      {Object.keys(byRate).length > 0 && (
        <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
          <CardHeader>
            <CardTitle className="text-base font-bold">GST Rate Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">Total Tax</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(byRate).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, v]: any) => (
                  <TableRow key={rate}>
                    <TableCell><Badge variant="outline">{rate}%</Badge></TableCell>
                    <TableCell className="text-right">{v.count}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.taxable)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.tax / 2)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(v.tax / 2)}</TableCell>
                    <TableCell className="text-right font-medium text-primary">{formatCurrency(v.tax)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(v.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* HSN Summary (GSTR-1 Table 12) */}
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Package className="h-4 w-4 text-primary" />
              HSN / SAC Summary
            </CardTitle>
            <CardDescription>GSTR-1 Table 12 layout — group by HSN code</CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={!hsnBuckets.length} onClick={() => exportHsnSummary(hsnBuckets)}>
            <Download className="mr-2 h-4 w-4" /> Download CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>HSN</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>UQC</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hsnBuckets.map(b => (
                  <TableRow key={`${b.hsn}-${b.rate}`}>
                    <TableCell className="font-mono text-xs">{b.hsn}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">{b.description}</TableCell>
                    <TableCell>{b.uqc}</TableCell>
                    <TableCell className="text-right">{b.qty}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{b.rate}%</Badge></TableCell>
                    <TableCell className="text-right">{formatCurrency(b.taxable)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.cgst)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.sgst)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(b.total)}</TableCell>
                  </TableRow>
                ))}
                {!hsnBuckets.length && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      No HSN data for selected period
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* B2B */}
      <InvoiceTable
        title={`B2B Invoices (${b2b.length})`}
        description="Tax invoices with customer GSTIN — included in GSTR-1 B2B"
        rows={b2b}
        onExport={() => exportGstr1B2B(lines)}
        formatCurrency={formatCurrency}
        showGstin
      />

      {/* B2C */}
      <InvoiceTable
        title={`B2C Invoices & POS (${b2c.length})`}
        description="Includes POS retail sales without GSTIN — combined into GSTR-1 B2C"
        rows={b2c}
        onExport={() => exportGstr1B2C(lines)}
        formatCurrency={formatCurrency}
      />

      {/* Table 8 — exempt / nil-rated supplies */}
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Exempt / Nil-Rated Supplies ({exemptLines.length})
            </CardTitle>
            <CardDescription>GSTR-1 Table 8 — bills of supply and 0% invoices. No tax is charged or reported on these.</CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={!exemptLines.length} onClick={() => exportExemptSupplies(exemptLines)}>
            <Download className="mr-2 h-4 w-4" /> Download CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Stream</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exemptLines.slice(0, 30).map(l => (
                <TableRow key={`${l.invoice_number}-${l.date}`}>
                  <TableCell className="font-medium">{l.invoice_number}</TableCell>
                  <TableCell>{format(new Date(l.date), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{l.customer_name}</TableCell>
                  <TableCell><Badge variant="outline">{STREAM_LABELS[l.source] || l.source}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(l.total)}</TableCell>
                </TableRow>
              ))}
              {!exemptLines.length && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No exempt supplies in this period</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {posSales.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Note: {posSales.length} POS sale(s) without a linked GST invoice are excluded from this return. Raise a GST invoice for any POS sale that must be reported.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Table 13 — documents issued */}
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <BookOpen className="h-4 w-4 text-primary" />
              Documents Issued
            </CardTitle>
            <CardDescription>GSTR-1 Table 13 — document series issued in the period. Only tax-invoice series (INV) are reported here; bills of supply (BOS) are internal exempt documents and are never included in GST filing output.</CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={!documentsIssued.length} onClick={() => exportDocumentsIssued(documentsIssued)}>
            <Download className="mr-2 h-4 w-4" /> Download CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Series</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Cancelled</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documentsIssued.map(d => (
                <TableRow key={d.series}>
                  <TableCell><Badge variant="secondary">{d.series}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{d.from}</TableCell>
                  <TableCell className="font-mono text-xs">{d.to}</TableCell>
                  <TableCell className="text-right">{d.issued}</TableCell>
                  <TableCell className="text-right text-destructive">{d.cancelled}</TableCell>
                  <TableCell className="text-right font-bold">{d.issued - d.cancelled}</TableCell>
                </TableRow>
              ))}
              {!documentsIssued.length && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No documents issued in this period</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Sales register */}
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader className="gap-3">
          <div className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <ReceiptText className="h-4 w-4 text-primary" />
                Sales Register ({registerRows.length})
              </CardTitle>
              <CardDescription>Every document in the period — taxable and exempt, with the full tax split</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => exportSalesRegister(lines, exemptLines)}>
              <Download className="mr-2 h-4 w-4" /> Download CSV
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search sales register"
                className="pl-9"
                placeholder="Search invoice # or customer..."
                value={registerSearch}
                onChange={e => setRegisterSearch(e.target.value)}
              />
            </div>
            <Select value={registerBucket} onValueChange={(v) => setRegisterBucket(v as typeof registerBucket)}>
              <SelectTrigger aria-label="Filter by supply type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All supplies</SelectItem>
                <SelectItem value="taxable">Taxable only</SelectItem>
                <SelectItem value="exempt">Exempt / nil only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={registerStream} onValueChange={setRegisterStream}>
              <SelectTrigger aria-label="Filter by stream"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All streams</SelectItem>
                {Object.entries(STREAM_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Supply</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registerRows.slice(0, 100).map(r => (
                  <TableRow key={`${r.invoice_number}-${r.date}`} className="transition-colors duration-150 hover:bg-muted/50">
                    <TableCell className="font-medium">{r.invoice_number}</TableCell>
                    <TableCell>{format(new Date(r.date), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{r.customer_name}</TableCell>
                    <TableCell><Badge variant="outline">{r.customer_gstin ? 'B2B' : 'B2C'}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={r.bucket === 'taxable' ? 'default' : 'secondary'}>
                        {r.bucket === 'taxable' ? 'Taxable' : 'Exempt'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(r.taxable)}</TableCell>
                    <TableCell className="text-right">{r.rate}%</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.cgst)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.sgst)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.igst)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(r.total)}</TableCell>
                  </TableRow>
                ))}
                {!registerRows.length && (
                  <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">No documents match these filters</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {registerRows.length > 100 && (
            <p className="mt-3 text-xs text-muted-foreground">Showing first 100 of {registerRows.length} rows — download the CSV for the full register.</p>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">{label}</p>
      <p className={`mt-1 ${highlight ? 'text-2xl font-bold' : 'text-xl font-semibold'} text-primary-foreground`}>{value}</p>
    </div>
  );
}

function InvoiceTable({ title, description, rows, onExport, formatCurrency, showGstin }: {
  title: string; description: string; rows: any[]; onExport: () => void;
  formatCurrency: (n: number) => string; showGstin?: boolean;
}) {
  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-bold">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={!rows.length} onClick={onExport}>
          <Download className="mr-2 h-4 w-4" /> Download CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                {showGstin && <TableHead>GSTIN</TableHead>}
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 50).map(l => (
                <TableRow key={l.invoice_number + l.date}>
                  <TableCell className="font-medium">{l.invoice_number}</TableCell>
                  <TableCell>{format(new Date(l.date), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{l.customer_name}</TableCell>
                  {showGstin && <TableCell className="font-mono text-xs">{l.customer_gstin || '-'}</TableCell>}
                  <TableCell><Badge variant="outline">{STREAM_LABELS[l.source] || l.source}</Badge></TableCell>
                  <TableCell className="text-right">{formatCurrency(l.taxable)}</TableCell>
                  <TableCell className="text-right"><Badge variant="secondary">{l.rate}%</Badge></TableCell>
                  <TableCell className="text-right text-primary">{formatCurrency(l.cgst + l.sgst + l.igst)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(l.total)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={showGstin ? 9 : 8} className="py-8 text-center text-muted-foreground">
                    No invoices in this bucket for the selected period
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
