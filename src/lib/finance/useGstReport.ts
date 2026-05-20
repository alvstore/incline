import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveHsn, HSN_FALLBACK, type HsnEntry } from './hsnDefaults';
import type { GstLine } from './csvExports';

type Range = { from: Date; to: Date } | null;

export type StreamKey = 'membership' | 'pt_package' | 'addon' | 'class' | 'pos' | 'other';

function classifyInvoice(inv: any): StreamKey {
  const src = (inv.source || inv.invoice_type || '').toLowerCase();
  if (src.includes('member')) return 'membership';
  if (src.includes('pt') || src.includes('trainer')) return 'pt_package';
  if (src.includes('addon')) return 'addon';
  if (src.includes('class')) return 'class';
  if (src.includes('pos') || inv.pos_sale_id) return 'pos';
  return 'other';
}

export function useGstReport(branchId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ['gst-report', branchId, range?.from?.toISOString(), range?.to?.toISOString()],
    queryFn: async () => {
      const from = range?.from?.toISOString();
      const to = range?.to?.toISOString();

      let invQ = supabase
        .from('invoices')
        .select('id, invoice_number, created_at, total_amount, subtotal, tax_amount, gst_rate, is_gst_invoice, customer_gstin, customer_name, source, invoice_type, pos_sale_id, status, member:members(member_code, gstin, profiles:user_id(full_name))')
        .order('created_at', { ascending: false });
      if (branchId && branchId !== 'all') invQ = invQ.eq('branch_id', branchId);
      if (from && to) invQ = invQ.gte('created_at', from).lte('created_at', to);

      let posQ = supabase
        .from('pos_sales')
        .select('id, sale_date, total_amount, payment_method, items, customer_name, customer_phone, invoice_id, members(member_code)')
        .is('invoice_id', null);
      if (branchId && branchId !== 'all') posQ = posQ.eq('branch_id', branchId);
      if (from && to) posQ = posQ.gte('sale_date', from).lte('sale_date', to);

      const [invRes, posRes, itemsRes] = await Promise.all([invQ, posQ, fetchInvoiceItems(branchId, from, to)]);
      if (invRes.error) throw invRes.error;
      if (posRes.error) throw posRes.error;

      const invoices = invRes.data || [];
      const posSales = posRes.data || [];
      const items = itemsRes;

      // GST lines from invoices (one row per invoice; tax split by branch state)
      const lines: GstLine[] = [];

      invoices.forEach((inv: any) => {
        const rate = Number(inv.gst_rate) || (inv.is_gst_invoice ? 18 : 0);
        const total = Number(inv.total_amount || 0);
        const taxable = Number(inv.subtotal) || (rate > 0 ? total / (1 + rate / 100) : total);
        const tax = rate > 0 ? total - taxable : 0;
        const stream = classifyInvoice(inv);
        const hsn = HSN_FALLBACK; // refined below by items if present

        lines.push({
          invoice_number: inv.invoice_number || '-',
          date: inv.created_at,
          customer_name: inv.customer_name || inv.member?.profiles?.full_name || '-',
          customer_gstin: inv.customer_gstin || inv.member?.gstin || null,
          hsn: hsn.code,
          taxable,
          rate,
          cgst: tax / 2,
          sgst: tax / 2,
          igst: 0, // single-state default
          total,
          source: stream,
        });
      });

      // POS sales without invoice → treat as B2C @ 18% (HSN from items if known)
      posSales.forEach((p: any) => {
        const total = Number(p.total_amount || 0);
        const rate = 18;
        const taxable = total / 1.18;
        const tax = total - taxable;
        const firstItem = Array.isArray(p.items) && p.items[0];
        const hsnCode = firstItem?.hsn_code || HSN_FALLBACK.code;
        lines.push({
          invoice_number: `POS-${String(p.id).slice(0, 8)}`,
          date: p.sale_date,
          customer_name: p.customer_name || (p as any).members?.member_code || 'Walk-in',
          customer_gstin: null,
          hsn: hsnCode,
          taxable,
          rate,
          cgst: tax / 2,
          sgst: tax / 2,
          igst: 0,
          total,
          source: 'pos',
        });
      });

      // HSN buckets — from invoice_items where available, else inferred
      const hsnMap = new Map<string, { hsn: string; description: string; uqc: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; rate: number }>();

      const addBucket = (h: HsnEntry, qty: number, taxable: number) => {
        const tax = (taxable * h.rate) / 100;
        const existing = hsnMap.get(h.code);
        const entry = existing || { hsn: h.code, description: h.description, uqc: h.uqc, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, rate: h.rate };
        entry.qty += qty;
        entry.taxable += taxable;
        entry.cgst += tax / 2;
        entry.sgst += tax / 2;
        entry.total += taxable + tax;
        hsnMap.set(h.code, entry);
      };

      items.forEach((it: any) => {
        const total = Number(it.total_amount || 0);
        const rate = Number(it.tax_rate) || 18;
        const taxable = total / (1 + rate / 100);
        const h = resolveHsn({ itemHsn: it.hsn_code, category: it.reference_type, rateOverride: rate });
        addBucket(h, Number(it.quantity || 1), taxable);
      });

      // POS items breakdown
      posSales.forEach((p: any) => {
        const its = Array.isArray(p.items) ? p.items : [];
        its.forEach((it: any) => {
          const total = Number(it.total || it.unit_price * it.quantity || 0);
          const rate = 18;
          const taxable = total / 1.18;
          const h = resolveHsn({ itemHsn: it.hsn_code, source: 'pos' });
          addBucket(h, Number(it.quantity || 1), taxable);
        });
      });

      // Stream totals
      const streamMap: Record<StreamKey, { count: number; taxable: number; tax: number; total: number }> = {
        membership: { count: 0, taxable: 0, tax: 0, total: 0 },
        pt_package: { count: 0, taxable: 0, tax: 0, total: 0 },
        addon:      { count: 0, taxable: 0, tax: 0, total: 0 },
        class:      { count: 0, taxable: 0, tax: 0, total: 0 },
        pos:        { count: 0, taxable: 0, tax: 0, total: 0 },
        other:      { count: 0, taxable: 0, tax: 0, total: 0 },
      };
      lines.forEach(l => {
        const k = (l.source as StreamKey) in streamMap ? (l.source as StreamKey) : 'other';
        streamMap[k].count += 1;
        streamMap[k].taxable += l.taxable;
        streamMap[k].tax += l.cgst + l.sgst + l.igst;
        streamMap[k].total += l.total;
      });

      const taxableTotal = lines.reduce((s, l) => s + l.taxable, 0);
      const cgstTotal = lines.reduce((s, l) => s + l.cgst, 0);
      const sgstTotal = lines.reduce((s, l) => s + l.sgst, 0);
      const igstTotal = lines.reduce((s, l) => s + l.igst, 0);
      const grossTotal = lines.reduce((s, l) => s + l.total, 0);

      const nonGstInvoices = invoices.filter((i: any) => !i.is_gst_invoice);
      const nonGstTotal = nonGstInvoices.reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0);

      // by rate
      const byRate: Record<number, { count: number; taxable: number; tax: number; total: number }> = {};
      lines.forEach(l => {
        const k = l.rate;
        if (!byRate[k]) byRate[k] = { count: 0, taxable: 0, tax: 0, total: 0 };
        byRate[k].count += 1;
        byRate[k].taxable += l.taxable;
        byRate[k].tax += l.cgst + l.sgst + l.igst;
        byRate[k].total += l.total;
      });

      return {
        lines,
        hsnBuckets: Array.from(hsnMap.values()).sort((a, b) => b.total - a.total),
        streams: streamMap,
        totals: { taxable: taxableTotal, cgst: cgstTotal, sgst: sgstTotal, igst: igstTotal, gross: grossTotal, nonGst: nonGstTotal, tax: cgstTotal + sgstTotal + igstTotal },
        byRate,
        rawInvoices: invoices,
        nonGstInvoices,
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
    .select('id, hsn_code, tax_rate, quantity, total_amount, reference_type, invoice:invoices!inner(id, branch_id, created_at, is_gst_invoice)');
  if (from && to) {
    q = q.gte('invoice.created_at', from).lte('invoice.created_at', to);
  }
  if (branchId && branchId !== 'all') q = q.eq('invoice.branch_id', branchId);
  const { data, error } = await q;
  if (error) return [];
  return (data || []).filter((r: any) => r.invoice?.is_gst_invoice);
}
