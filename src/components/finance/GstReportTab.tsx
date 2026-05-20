import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet, Package, FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useGstReport } from '@/lib/finance/useGstReport';
import {
  exportAccountantPack, exportGstr1B2B, exportGstr1B2C, exportHsnSummary, exportSalesRegister,
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

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const { totals, byRate, streams, lines, hsnBuckets, nonGstInvoices, posSales } = data;
  const b2b = lines.filter(l => !!l.customer_gstin);
  const b2c = lines.filter(l => !l.customer_gstin);

  return (
    <div className="space-y-6">
      {/* Hero KPI strip */}
      <Card className="rounded-2xl border-none bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
        <CardContent className="grid grid-cols-2 gap-6 p-6 md:grid-cols-6">
          <Kpi label="Taxable Value" value={formatCurrency(totals.taxable)} />
          <Kpi label="CGST" value={formatCurrency(totals.cgst)} />
          <Kpi label="SGST" value={formatCurrency(totals.sgst)} />
          <Kpi label="IGST" value={formatCurrency(totals.igst)} />
          <Kpi label="Total Tax" value={formatCurrency(totals.tax)} highlight />
          <Kpi label="Gross GST Sales" value={formatCurrency(totals.gross)} highlight />
        </CardContent>
      </Card>

      {/* Accountant pack export */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-lg shadow-primary/10">
        <div>
          <p className="text-sm font-semibold text-foreground">Accountant Export Pack</p>
          <p className="text-xs text-muted-foreground">One click — downloads B2B + B2C + HSN summary + sales register for selected period.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { exportAccountantPack(lines, hsnBuckets); toast.success('Accountant pack downloaded'); }}>
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
                  <TableRow key={b.hsn}>
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

      {/* Non-GST */}
      <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Non-GST Income ({nonGstInvoices.length})
            </CardTitle>
            <CardDescription>Excluded from GST returns — refunds, deposits, exempt items</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => exportSalesRegister(lines)}>
            <Download className="mr-2 h-4 w-4" /> Sales Register CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nonGstInvoices.slice(0, 30).map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoice_number || '-'}</TableCell>
                  <TableCell>{format(new Date(inv.created_at), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{inv.customer_name || inv.member?.profiles?.full_name || '-'}</TableCell>
                  <TableCell><Badge variant={inv.status === 'paid' ? 'default' : 'secondary'}>{inv.status}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(Number(inv.total_amount))}</TableCell>
                </TableRow>
              ))}
              {!nonGstInvoices.length && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No non-GST invoices</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {posSales.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Note: {posSales.length} POS sale(s) without linked invoice are reported as B2C taxable supplies @ 18% (HSN 2106 default).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{label}</p>
      <p className={`mt-1 ${highlight ? 'text-2xl font-bold' : 'text-xl font-semibold'} text-white`}>{value}</p>
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
