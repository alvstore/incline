import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, eachDayOfInterval } from 'date-fns';

type Range = { from: Date; to: Date } | null;

export function useSalesReport(branchId: string | undefined, range: Range) {
  return useQuery({
    queryKey: ['sales-report', branchId, range?.from?.toISOString(), range?.to?.toISOString()],
    queryFn: async () => {
      const from = range?.from?.toISOString();
      const to = range?.to?.toISOString();

      let payQ = supabase
        .from('payments')
        .select('id, amount, payment_date, payment_method, status, collected_by, invoice:invoices(invoice_number, source, invoice_type, pos_sale_id, is_gst_invoice, gst_rate, refund_amount)')
        .eq('status', 'completed');
      if (branchId && branchId !== 'all') payQ = payQ.eq('branch_id', branchId);
      if (from && to) payQ = payQ.gte('payment_date', from).lte('payment_date', to);

      let posQ = supabase
        .from('pos_sales')
        .select('id, sale_date, total_amount, payment_method, items, sold_by, invoice_id, branch_id');
      if (branchId && branchId !== 'all') posQ = posQ.eq('branch_id', branchId);
      if (from && to) posQ = posQ.gte('sale_date', from).lte('sale_date', to);

      let invQ = supabase
        .from('invoices')
        .select('id, total_amount, refund_amount, source, invoice_type, branch_id, created_at, is_gst_invoice, gst_rate');
      if (branchId && branchId !== 'all') invQ = invQ.eq('branch_id', branchId);
      if (from && to) invQ = invQ.gte('created_at', from).lte('created_at', to);

      const [payRes, posRes, invRes, branchesRes] = await Promise.all([
        payQ, posQ, invQ,
        supabase.from('branches').select('id, name'),
      ]);
      if (payRes.error) throw payRes.error;
      if (posRes.error) throw posRes.error;
      if (invRes.error) throw invRes.error;

      const payments = payRes.data || [];
      const posSales = (posRes.data || []).filter((p: any) => !p.invoice_id); // avoid double-count
      const invoices = invRes.data || [];
      const branchesMap = new Map((branchesRes.data || []).map((b: any) => [b.id, b.name]));

      const refunds = invoices.reduce((s: number, i: any) => s + Number(i.refund_amount || 0), 0);

      type Txn = { id: string; date: string; amount: number; method: string; stream: string; branch_id?: string; collected_by?: string | null; rate: number };
      const txns: Txn[] = [];

      payments.forEach((p: any) => {
        const inv = p.invoice;
        const stream = streamFromInvoice(inv);
        const rate = Number(inv?.gst_rate) || 0;
        txns.push({
          id: p.id, date: p.payment_date, amount: Number(p.amount || 0),
          method: p.payment_method || 'other', stream, collected_by: p.collected_by, rate,
        });
      });
      posSales.forEach((p: any) => {
        txns.push({
          id: p.id, date: p.sale_date, amount: Number(p.total_amount || 0),
          method: p.payment_method || 'cash', stream: 'pos', branch_id: p.branch_id,
          collected_by: p.sold_by, rate: 18,
        });
      });

      const gross = txns.reduce((s, t) => s + t.amount, 0);
      const tax = txns.reduce((s, t) => s + (t.rate > 0 ? t.amount - t.amount / (1 + t.rate / 100) : 0), 0);
      const net = gross - tax;
      const aov = txns.length ? gross / txns.length : 0;

      // by day
      const dayMap = new Map<string, { date: string; txns: number; gross: number; tax: number; net: number; refunds: number }>();
      if (range) {
        eachDayOfInterval({ start: range.from, end: range.to }).forEach(d => {
          const key = format(d, 'yyyy-MM-dd');
          dayMap.set(key, { date: key, txns: 0, gross: 0, tax: 0, net: 0, refunds: 0 });
        });
      }
      txns.forEach(t => {
        const key = format(new Date(t.date), 'yyyy-MM-dd');
        const e = dayMap.get(key) || { date: key, txns: 0, gross: 0, tax: 0, net: 0, refunds: 0 };
        e.txns += 1;
        e.gross += t.amount;
        const tx = t.rate > 0 ? t.amount - t.amount / (1 + t.rate / 100) : 0;
        e.tax += tx;
        e.net += t.amount - tx;
        dayMap.set(key, e);
      });
      const daily = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // by stream
      const streamMap = new Map<string, { stream: string; txns: number; gross: number; tax: number; net: number }>();
      txns.forEach(t => {
        const e = streamMap.get(t.stream) || { stream: t.stream, txns: 0, gross: 0, tax: 0, net: 0 };
        e.txns += 1; e.gross += t.amount;
        const tx = t.rate > 0 ? t.amount - t.amount / (1 + t.rate / 100) : 0;
        e.tax += tx; e.net += t.amount - tx;
        streamMap.set(t.stream, e);
      });
      const byStream = Array.from(streamMap.values()).sort((a, b) => b.gross - a.gross);

      // by payment method
      const methodMap = new Map<string, number>();
      txns.forEach(t => {
        const key = normalizeMethod(t.method);
        methodMap.set(key, (methodMap.get(key) || 0) + t.amount);
      });
      const byMethod = Array.from(methodMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

      // by branch (only meaningful when 'all')
      const branchMap = new Map<string, { branch_id: string; name: string; gross: number; txns: number }>();
      [...payments, ...posSales].forEach((row: any) => {
        const bid = row.branch_id;
        if (!bid) return;
        const e = branchMap.get(bid) || { branch_id: bid, name: branchesMap.get(bid) || bid, gross: 0, txns: 0 };
        e.gross += Number(row.amount || row.total_amount || 0);
        e.txns += 1;
        branchMap.set(bid, e);
      });

      return {
        totals: { gross, tax, net, refunds, txns: txns.length, aov, netProfit: net - refunds },
        daily,
        byStream,
        byMethod,
        byBranch: Array.from(branchMap.values()).sort((a, b) => b.gross - a.gross),
      };
    },
    staleTime: 60_000,
  });
}

function streamFromInvoice(inv: any): string {
  if (!inv) return 'other';
  const src = (inv.source || inv.invoice_type || '').toLowerCase();
  if (inv.pos_sale_id || src.includes('pos')) return 'pos';
  if (src.includes('member')) return 'membership';
  if (src.includes('pt') || src.includes('trainer')) return 'pt_package';
  if (src.includes('addon')) return 'addon';
  if (src.includes('class')) return 'class';
  return 'other';
}

function normalizeMethod(m: string): string {
  const x = (m || '').toLowerCase();
  if (x.includes('upi') || x.includes('razorpay')) return 'UPI';
  if (x.includes('card') || x.includes('credit') || x.includes('debit')) return 'Card';
  if (x.includes('bank') || x.includes('neft') || x.includes('transfer')) return 'Bank';
  if (x.includes('cash')) return 'Cash';
  if (x.includes('wallet')) return 'Wallet';
  return 'Other';
}
