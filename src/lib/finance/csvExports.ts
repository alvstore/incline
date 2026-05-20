import { format } from 'date-fns';

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => {
    const s = c == null ? '' : String(c);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export type GstLine = {
  invoice_number: string;
  date: string | Date;
  customer_name: string;
  customer_gstin: string | null;
  hsn: string;
  taxable: number;
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  source: string;
};

const fmtDate = (d: string | Date) => format(new Date(d), 'yyyy-MM-dd');
const stamp = () => format(new Date(), 'yyyy-MM');

export function exportGstr1B2B(lines: GstLine[]) {
  const b2b = lines.filter(l => !!l.customer_gstin);
  downloadCsv(`GSTR1_B2B_${stamp()}.csv`, [
    ['Invoice #', 'Date', 'Customer', 'GSTIN', 'HSN/SAC', 'Taxable Value', 'Rate %', 'CGST', 'SGST', 'IGST', 'Total'],
    ...b2b.map(l => [
      l.invoice_number, fmtDate(l.date), l.customer_name, l.customer_gstin || '',
      l.hsn, l.taxable.toFixed(2), l.rate, l.cgst.toFixed(2), l.sgst.toFixed(2),
      l.igst.toFixed(2), l.total.toFixed(2),
    ]),
  ]);
}

export function exportGstr1B2C(lines: GstLine[]) {
  const b2c = lines.filter(l => !l.customer_gstin);
  downloadCsv(`GSTR1_B2C_${stamp()}.csv`, [
    ['Invoice #', 'Date', 'Customer', 'HSN/SAC', 'Taxable Value', 'Rate %', 'CGST', 'SGST', 'Total', 'Source'],
    ...b2c.map(l => [
      l.invoice_number, fmtDate(l.date), l.customer_name, l.hsn,
      l.taxable.toFixed(2), l.rate, l.cgst.toFixed(2), l.sgst.toFixed(2),
      l.total.toFixed(2), l.source,
    ]),
  ]);
}

export function exportHsnSummary(
  buckets: Array<{ hsn: string; description: string; uqc: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; rate: number }>,
) {
  downloadCsv(`GSTR1_HSN_Summary_${stamp()}.csv`, [
    ['HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate %', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total'],
    ...buckets.map(b => [
      b.hsn, b.description, b.uqc, b.qty, b.rate,
      b.taxable.toFixed(2), b.cgst.toFixed(2), b.sgst.toFixed(2), b.igst.toFixed(2), b.total.toFixed(2),
    ]),
  ]);
}

export function exportSalesRegister(lines: GstLine[]) {
  downloadCsv(`Sales_Register_${stamp()}.csv`, [
    ['Date', 'Invoice #', 'Customer', 'GSTIN', 'Source', 'HSN', 'Taxable', 'Tax', 'Total'],
    ...lines.map(l => [
      fmtDate(l.date), l.invoice_number, l.customer_name, l.customer_gstin || '',
      l.source, l.hsn, l.taxable.toFixed(2), (l.cgst + l.sgst + l.igst).toFixed(2), l.total.toFixed(2),
    ]),
  ]);
}

export function exportAccountantPack(lines: GstLine[], hsnBuckets: Parameters<typeof exportHsnSummary>[0]) {
  exportGstr1B2B(lines);
  exportGstr1B2C(lines);
  exportHsnSummary(hsnBuckets);
  exportSalesRegister(lines);
}

export function exportDailySales(rows: Array<{ date: string; txns: number; gross: number; tax: number; net: number; refunds: number }>) {
  downloadCsv(`Daily_Sales_${stamp()}.csv`, [
    ['Date', 'Transactions', 'Gross', 'Tax', 'Net (ex-GST)', 'Refunds'],
    ...rows.map(r => [r.date, r.txns, r.gross.toFixed(2), r.tax.toFixed(2), r.net.toFixed(2), r.refunds.toFixed(2)]),
  ]);
}

export function exportStreamSales(rows: Array<{ stream: string; txns: number; gross: number; tax: number; net: number }>) {
  downloadCsv(`Sales_By_Stream_${stamp()}.csv`, [
    ['Stream', 'Transactions', 'Gross', 'Tax', 'Net (ex-GST)'],
    ...rows.map(r => [r.stream, r.txns, r.gross.toFixed(2), r.tax.toFixed(2), r.net.toFixed(2)]),
  ]);
}
