// Trainer earnings come ONLY from PT commission instalments. Sessions never carry a rupee value.

export interface EarningsInstallment {
  installment_id: string;
  payout_month: string;
  installment_index: number;
  installment_count: number;
  amount: number;
  status: 'pending' | 'blocked' | 'paid' | string;
  blocked_reason: string | null;
  paid_at: string | null;
  member_name: string;
  package_name: string | null;
  sale_amount: number | null;
  commission_base: number | null;
  share_pct: number | null;
  gst_deduction: number | null;
  net_commission: number | null;
  invoice_balance: number | null;
}

export type InstallmentState = 'paid' | 'on_hold' | 'payable' | 'upcoming';

/** On hold whenever the PT invoice still has a balance, regardless of the stored status. */
export function installmentState(i: Pick<EarningsInstallment, 'status' | 'invoice_balance' | 'payout_month'>, monthStart: string): InstallmentState {
  if (i.status === 'paid') return 'paid';
  if (i.status === 'blocked' || (i.invoice_balance ?? 0) > 0) return 'on_hold';
  if (i.payout_month > monthStart) return 'upcoming';
  return 'payable';
}

/** Mirrors backend generate_pt_commission: gross = sale × share%, trainer pays GST% on the commission only — and only when the sale invoice charged GST. */
export function ptCommission(saleAmount: number, sharePct: number, trainerGstPct: number, invoiceTaxed = true) {
  const gross = round2(saleAmount * sharePct / 100);
  const deduction = invoiceTaxed ? round2(gross * trainerGstPct / 100) : 0;
  return { gross, deduction, net: round2(gross - deduction) };
}

export function summarize(rows: EarningsInstallment[], monthStart: string) {
  const t = { payable: 0, onHold: 0, paid: 0, upcoming: 0 };
  for (const r of rows) {
    const s = installmentState(r, monthStart);
    const a = Number(r.amount) || 0;
    if (s === 'payable') t.payable += a;
    else if (s === 'on_hold') t.onHold += a;
    else if (s === 'paid') t.paid += a;
    else t.upcoming += a;
  }
  return t;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
