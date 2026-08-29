import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveHsn, HSN_FALLBACK, type HsnEntry } from './hsnDefaults';
import type { GstLine } from './csvExports';

type Range = { from: Date; to: Date } | null;

export type StreamKey = 'membership' | 'pt_package' | 'addon' | 'class' | 'pos' | 'other';

/** Invoices in these states never belong in a GST return. */
const EXCLUDED_STATUSES = new Set(['cancelled', 'draft', 'refunded']);

function classifyInvoice(inv: any): StreamKey {
  // invoice_type is the domain classifier; `source` only says how it was raised
  // (manual / payment_link) so it must never win over invoice_type.
  const src = `${inv.invoice_type || ''} ${inv.source || ''}`.toLowerCase();
  if (inv.pos_sale_id || src.includes('pos')) return 'pos';
  if (src.includes('pt') || src.includes('trainer')) return 'pt_package';
  if (src.includes('addon') || src.includes('add_on') || src.includes('benefit')) return 'addon';
  if (src.includes('class')) return 'class';
  if (src.includes('member')) return 'membership';
  return 'other';
}


const stateCode = (gstin?: string | null) =>
  gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null;

/** Document series inferred from the invoice number prefix (Table 13). */
function seriesOf(inv: any): string {
  if (inv.document_series) return String(inv.document_series);
  const num = String(inv.invoice_number || '');
  const m = num.match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : 'OTHER';
}

/** Bills of supply are internal exempt documents — never part of GST filing output. */
function isBos(inv: any): boolean {
  return seriesOf(inv) === 'BOS' || String(inv.invoice_number || '').toUpperCase().startsWith('BOS');
}

/** A genuine GST tax invoice: flagged, positive rate AND positive tax amount. */
function isTaxableInvoice(inv: any): boolean {
  return Boolean(inv.is_gst_invoice) && Number(inv.gst_rate) > 0 && Number(inv.tax_amount) > 0 && !isBos(inv);
}

function numericSuffix(num: string): number | null {
  const m = String(num || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

export function useGstReport(branchId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ['gst-report', branchId, range?.from?.toISOString(), range?.to?.toISOString()],
    queryFn: async () => {
      const from = range?.from?.toISOString();
      const to = range?.to?.toISOString();

      let invQ = supabase
        .from('invoices')
        .select('id, invoice_number, document_series, created_at, total_amount, subtotal, tax_amount, gst_rate, is_gst_invoice, customer_gstin, customer_name, source, invoice_type, pos_sale_id, status, branch_id, member:members(member_code, gstin, profiles:user_id(full_name))')
        .order('created_at', { ascending: false });
      if (branchId && branchId !== 'all') invQ = invQ.eq('branch_id', branchId);
      if (from && to) invQ = invQ.gte('created_at', from).lte('created_at', to);

      let posQ = supabase
        .from('pos_sales')
        .select('id, sale_date, total_amount, payment_method, items, customer_name, customer_phone, invoice_id, members(member_code)')
        .is('invoice_id', null);
      if (branchId && branchId !== 'all') posQ = posQ.eq('branch_id', branchId);
      if (from && to) posQ = posQ.gte('sale_date', from).lte('sale_date', to);

      let branchQ = supabase.from('branches').select('id, name, gstin, state');
      if (branchId && branchId !== 'all') branchQ = branchQ.eq('id', branchId);

      const [invRes, posRes, branchRes, itemsRes] = await Promise.all([
        invQ, posQ, branchQ, fetchInvoiceItems(branchId, from, to),
      ]);
      if (invRes.error) throw invRes.error;
      if (posRes.error) throw posRes.error;

      const allInvoices = invRes.data || [];
      const posSales = posRes.data || [];
      const items = itemsRes;
      const branches = branchRes.data || [];

      // Home state code — used to decide CGST/SGST vs IGST
      const homeStateCode = stateCode(branches[0]?.gstin) || '08';

      // Documents issued (Table 13) — computed on EVERY invoice incl. cancelled
      const seriesMap = new Map<string, { series: string; from: string; to: string; issued: number; cancelled: number }>();
      allInvoices.forEach((inv: any) => {
        if (isBos(inv)) return; // BOS never appears in GST filing / Documents Issued
        const key = seriesOf(inv);
        const entry = seriesMap.get(key) || { series: key, from: inv.invoice_number, to: inv.invoice_number, issued: 0, cancelled: 0 };
        entry.issued += 1;
        if (inv.status === 'cancelled') entry.cancelled += 1;
        const n = numericSuffix(inv.invoice_number);
        if (n != null) {
          if (numericSuffix(entry.from) == null || n < (numericSuffix(entry.from) as number)) entry.from = inv.invoice_number;
          if (numericSuffix(entry.to) == null || n > (numericSuffix(entry.to) as number)) entry.to = inv.invoice_number;
        }
        seriesMap.set(key, entry);
      });
      const documentsIssued = Array.from(seriesMap.values()).sort((a, b) => a.series.localeCompare(b.series));

      // BOS (bills of supply) are excluded from every GST report surface.
      const filingInvoices = allInvoices.filter((i: any) => !isBos(i));
      const cancelledInvoices = filingInvoices.filter((i: any) => EXCLUDED_STATUSES.has(String(i.status)));
      const invoices = filingInvoices.filter((i: any) => !EXCLUDED_STATUSES.has(String(i.status)));

      // ---- Taxable supplies (B2B/B2C) vs exempt/nil-rated supplies (Table 8) ----
      const lines: GstLine[] = [];
      const exemptLines: GstLine[] = [];

      invoices.forEach((inv: any) => {
        const rate = Number(inv.gst_rate) || 0;
        const isTaxable = isTaxableInvoice(inv);
        const total = Number(inv.total_amount || 0);
        const taxable = isTaxable
          ? (Number(inv.subtotal) || total / (1 + rate / 100))
          : total;
        const tax = isTaxable ? total - taxable : 0;
        const stream = classifyInvoice(inv);
        const gstin = inv.customer_gstin || inv.member?.gstin || null;
        const interState = !!gstin && stateCode(gstin) !== homeStateCode;

        const line: GstLine = {
          invoice_number: inv.invoice_number || '-',
          date: inv.created_at,
          customer_name: inv.customer_name || inv.member?.profiles?.full_name || '-',
          customer_gstin: gstin,
          hsn: HSN_FALLBACK.code,
          taxable,
          rate: isTaxable ? rate : 0,
          cgst: interState ? 0 : tax / 2,
          sgst: interState ? 0 : tax / 2,
          igst: interState ? tax : 0,
          total,
          source: stream,
        };

        (isTaxable ? lines : exemptLines).push(line);
      });

      // POS sales without a GST invoice are NOT injected into the GST return —
      // only genuine GST tax invoices feed the taxable buckets.

      // ---- HSN buckets (Table 12) — taxable supplies only ----
      // Buckets are keyed by HSN **and** rate: the same SAC can legitimately be
      // billed at different rates, and collapsing them printed one wrong rate.
      const hsnMap = new Map<string, { key: string; hsn: string; description: string; uqc: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; rate: number }>();

      const addBucket = (h: HsnEntry, rate: number, qty: number, taxable: number, interState: boolean) => {
        const tax = (taxable * rate) / 100;
        const key = `${h.code}@${rate}`;
        const entry = hsnMap.get(key) || { key, hsn: h.code, description: h.description, uqc: h.uqc, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, rate };
        entry.qty += qty;
        entry.taxable += taxable;
        if (interState) entry.igst += tax;
        else { entry.cgst += tax / 2; entry.sgst += tax / 2; }
        entry.total += taxable + tax;
        hsnMap.set(key, entry);
      };

      // Group line items by invoice so each invoice's taxable value is allocated
      // across its items. Item-level tax_rate is unreliable (often 0 or a stale
      // 18 default), so the invoice's gst_rate is authoritative.
      const itemsByInvoice = new Map<string, any[]>();
      items.forEach((it: any) => {
        const id = it.invoice?.id;
        if (!id) return;
        const list = itemsByInvoice.get(id) || [];
        list.push(it);
        itemsByInvoice.set(id, list);
      });

      invoices.forEach((inv: any) => {
        const rate = Number(inv.gst_rate) || 0;
        if (!isTaxableInvoice(inv)) return; // exempt supplies → Table 8
        const total = Number(inv.total_amount || 0);
        const invoiceTaxable = Number(inv.subtotal) || total / (1 + rate / 100);
        const gstin = inv.customer_gstin || inv.member?.gstin || null;
        const interState = !!gstin && stateCode(gstin) !== homeStateCode;

        const its = itemsByInvoice.get(inv.id) || [];
        const weightBase = its.reduce((s, it) => s + Math.abs(Number(it.total_amount || 0)), 0);

        if (!its.length || weightBase <= 0) {
          const h = resolveHsn({ category: classifyInvoice(inv), source: inv.source, rateOverride: rate });
          addBucket(h, rate, 1, invoiceTaxable, interState);
          return;
        }

        its.forEach((it: any, idx: number) => {
          const share = idx === its.length - 1
            ? invoiceTaxable - its.slice(0, -1).reduce((s, x) => s + (invoiceTaxable * Math.abs(Number(x.total_amount || 0))) / weightBase, 0)
            : (invoiceTaxable * Math.abs(Number(it.total_amount || 0))) / weightBase;
          const h = resolveHsn({ itemHsn: it.hsn_code, category: it.reference_type || classifyInvoice(inv), rateOverride: rate });
          addBucket(h, rate, Number(it.quantity || 1), share, interState);
        });
      });

      // Un-invoiced POS sales are excluded from HSN buckets (no GST invoice = not in this return).


      // ---- Stream totals (taxable + exempt so revenue reconciles) ----
      const emptyBucket = () => ({ count: 0, taxable: 0, tax: 0, total: 0 });
      const streamMap: Record<StreamKey, { count: number; taxable: number; tax: number; total: number }> = {
        membership: emptyBucket(),
        pt_package: emptyBucket(),
        addon: emptyBucket(),
        class: emptyBucket(),
        pos: emptyBucket(),
        other: emptyBucket(),
      };
      [...lines, ...exemptLines].forEach(l => {
        const k = (l.source as StreamKey) in streamMap ? (l.source as StreamKey) : 'other';
        streamMap[k].count += 1;
        streamMap[k].taxable += l.taxable;
        streamMap[k].tax += l.cgst + l.sgst + l.igst;
        streamMap[k].total += l.total;
      });

      const sum = (rows: GstLine[], pick: (l: GstLine) => number) => rows.reduce((s, l) => s + pick(l), 0);

      const taxableTotal = sum(lines, l => l.taxable);
      const cgstTotal = sum(lines, l => l.cgst);
      const sgstTotal = sum(lines, l => l.sgst);
      const igstTotal = sum(lines, l => l.igst);
      const grossTotal = sum(lines, l => l.total);
      const exemptTotal = sum(exemptLines, l => l.total);

      // by rate — taxable supplies only
      const byRate: Record<number, { count: number; taxable: number; tax: number; total: number }> = {};
      lines.forEach(l => {
        if (!byRate[l.rate]) byRate[l.rate] = emptyBucket();
        byRate[l.rate].count += 1;
        byRate[l.rate].taxable += l.taxable;
        byRate[l.rate].tax += l.cgst + l.sgst + l.igst;
        byRate[l.rate].total += l.total;
      });

      const exemptInvoices = invoices.filter((i: any) => !isTaxableInvoice(i));

      return {
        lines,
        exemptLines,
        hsnBuckets: Array.from(hsnMap.values()).sort((a, b) => b.total - a.total),
        streams: streamMap,
        totals: {
          taxable: taxableTotal,
          cgst: cgstTotal,
          sgst: sgstTotal,
          igst: igstTotal,
          gross: grossTotal,
          exempt: exemptTotal,
          nonGst: exemptTotal,
          tax: cgstTotal + sgstTotal + igstTotal,
        },
        byRate,
        documentsIssued,
        homeStateCode,
        branchGstin: branches[0]?.gstin || null,
        rawInvoices: invoices,
        cancelledInvoices,
        nonGstInvoices: exemptInvoices,
        posSales,
      };
    },
    staleTime: 60_000,
  });
}

async function fetchInvoiceItems(branchId: string | undefined, from?: string, to?: string) {
  // Pull line items joined to invoices in range (needed for HSN bucketing)
  let q = supabase
    .from('invoice_items')
    .select('id, hsn_code, tax_rate, quantity, total_amount, reference_type, invoice:invoices!inner(id, branch_id, created_at, is_gst_invoice, status)');
  if (from && to) {
    q = q.gte('invoice.created_at', from).lte('invoice.created_at', to);
  }
  if (branchId && branchId !== 'all') q = q.eq('invoice.branch_id', branchId);
  const { data, error } = await q;
  if (error) return [];
  return (data || []).filter((r: any) => r.invoice?.is_gst_invoice && !EXCLUDED_STATUSES.has(String(r.invoice?.status)));
}
