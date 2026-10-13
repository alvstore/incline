/**
 * Parses a supplier purchase sheet (rows already read from Excel/CSV) into
 * bills grouped by invoice number. Pure — no I/O, so it is unit-tested.
 * Rates in the sheet are PURCHASE costs, never selling prices.
 */
export interface PurchaseLine {
  key: string;
  item_name: string;
  hsn_code: string;
  quantity: number;
  rate: number;
  gst_rate: number;
  product_id: string | null;
  warnings: string[];
}
export interface PurchaseBill {
  bill_number: string;
  bill_date: string; // yyyy-mm-dd
  vendor: string;
  vendor_gstin: string;
  lines: PurchaseLine[];
  sheet_total: number | null;
}

export const VALID_GST_RATES = [0, 5, 12, 18, 28];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9%]/g, '');
const num = (v: unknown) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const toISODate = (v: unknown): string => {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
};

/** Split a taxable amount into equal CGST/SGST halves (intra-state). */
export function splitGst(taxable: number, gstRate: number) {
  const half = Math.round(taxable * gstRate * 0.5) / 100;
  return { cgst: half, sgst: half, total: Math.round((taxable + half * 2) * 100) / 100 };
}

export function lineWarnings(l: Pick<PurchaseLine, 'item_name' | 'hsn_code' | 'gst_rate' | 'quantity' | 'rate'>): string[] {
  const w: string[] = [];
  const hsn = l.hsn_code.replace(/\D/g, '');
  if (!hsn) w.push('HSN missing');
  else if (hsn.length < 6) w.push('Short HSN (4 digits)');
  const name = l.item_name.toLowerCase();
  if (/peanut\s*butter/.test(name) && hsn && !hsn.startsWith('2008')) w.push('HSN looks wrong for peanut butter (usually 2008)');
  if (/oats/.test(name) && hsn && !hsn.startsWith('1904') && !hsn.startsWith('1104')) w.push('HSN looks wrong for oats');
  if (/masala oats/.test(name) && hsn.startsWith('1104')) w.push('Masala oats are usually 1904, not 1104');
  if (!VALID_GST_RATES.includes(l.gst_rate)) w.push('GST rate not valid');
  if (!(l.quantity > 0)) w.push('Quantity must be more than 0');
  if (!(l.rate >= 0)) w.push('Rate missing');
  return w;
}

export function parsePurchaseRows(rows: unknown[][]): { bills: PurchaseBill[]; errors: string[] } {
  const errors: string[] = [];
  const headerIdx = rows.findIndex((r) => r.some((c) => norm(c).includes('invoiceno')));
  if (headerIdx < 0) return { bills: [], errors: ['Could not find the "Invoice No" column header.'] };
  const header = rows[headerIdx].map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const c = {
    inv: col('invoiceno'), date: col('invoicedate'), vendor: col('vendorname'), gstin: col('vendorgstin'),
    item: col('itemname'), hsn: col('hsn'), qty: col('qty', 'quantity'), rate: col('rate'),
    cgst: col('cgst'), igst: col('igst'), gst: col('gstrate', 'gst%'), total: col('totalamount'),
  };
  for (const [k, v] of Object.entries({ inv: c.inv, item: c.item, qty: c.qty, rate: c.rate })) {
    if (v < 0) errors.push(`Missing column: ${k}`);
  }
  if (errors.length) return { bills: [], errors };
  // Infer GST rate from header like "CGST (2.5%)" when no explicit column.
  let headerRate = NaN;
  const cg = c.cgst >= 0 ? String(rows[headerIdx][c.cgst]) : '';
  const m = cg.match(/([\d.]+)\s*%/);
  if (m) headerRate = Number(m[1]) * 2;
  const ig = c.igst >= 0 ? String(rows[headerIdx][c.igst]).match(/([\d.]+)\s*%/) : null;
  if (isNaN(headerRate) && ig) headerRate = Number(ig[1]);

  const map = new Map<string, PurchaseBill>();
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const inv = String(r[c.inv] ?? '').trim();
    const item = String(r[c.item] ?? '').trim();
    if (!inv || !item) return; // totals / blank rows
    const vendor = c.vendor >= 0 ? String(r[c.vendor] ?? '').trim() : '';
    const gstin = c.gstin >= 0 ? String(r[c.gstin] ?? '').trim().toUpperCase() : '';
    const key = `${gstin || vendor}|${inv}`;
    let bill = map.get(key);
    if (!bill) {
      bill = { bill_number: inv, bill_date: c.date >= 0 ? toISODate(r[c.date]) : '', vendor, vendor_gstin: gstin, lines: [], sheet_total: 0 };
      if (gstin && !GSTIN_RE.test(gstin)) errors.push(`Bill ${inv}: vendor GSTIN "${gstin}" looks invalid`);
      map.set(key, bill);
    }
    const gst = c.gst >= 0 ? num(r[c.gst]) : headerRate;
    const line: PurchaseLine = {
      key: `${key}#${i}`,
      item_name: item,
      hsn_code: String(r[c.hsn] ?? '').trim(),
      quantity: num(r[c.qty]),
      rate: num(r[c.rate]),
      gst_rate: Number.isFinite(gst) ? gst : 0,
      product_id: null,
      warnings: [],
    };
    line.warnings = lineWarnings(line);
    bill.lines.push(line);
    const t = c.total >= 0 ? num(r[c.total]) : NaN;
    bill.sheet_total = Number.isFinite(t) && bill.sheet_total !== null ? bill.sheet_total + t : null;
  });
  const bills = [...map.values()].map((b) => ({ ...b, sheet_total: b.sheet_total === null ? null : Math.round(b.sheet_total * 100) / 100 }));
  return { bills, errors };
}

export function billTotals(b: PurchaseBill) {
  return b.lines.reduce(
    (acc, l) => {
      const taxable = Math.round(l.quantity * l.rate * 100) / 100;
      const g = splitGst(taxable, l.gst_rate);
      return { taxable: acc.taxable + taxable, gst: acc.gst + g.cgst + g.sgst, total: acc.total + g.total };
    },
    { taxable: 0, gst: 0, total: 0 },
  );
}

/** A product can be offered for sale only with a photo and a selling price. */
export function canActivateProduct(p: { image_url: string | null; price: number | null }) {
  return !!p.image_url && (p.price ?? 0) > 0;
}
