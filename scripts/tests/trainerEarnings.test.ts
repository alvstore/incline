import { describe, expect, test } from 'bun:test';
import { installmentState, ptCommission, summarize, type EarningsInstallment } from '../../src/lib/trainers/earnings';

describe('trainer earnings', () => {
  test('₹10,000 PT sale at 40% = ₹4,000 commission, trainer pays 5% (₹200), nets ₹3,800', () => {
    const c = ptCommission(10000, 40, 5);
    expect(c.gross).toBe(4000);
    expect(c.deduction).toBe(200);
    expect(c.net).toBe(3800);
  });

  test('instalment is on hold while the PT invoice has a balance', () => {
    expect(installmentState({ status: 'pending', invoice_balance: 10000, payout_month: '2026-10-01' }, '2026-10-01')).toBe('on_hold');
    expect(installmentState({ status: 'pending', invoice_balance: 0, payout_month: '2026-10-01' }, '2026-10-01')).toBe('payable');
  });

  test('payout totals come only from instalments, never from sessions', () => {
    const row = (amount: number, status: string, bal: number): EarningsInstallment => ({
      installment_id: String(amount), payout_month: '2026-10-01', installment_index: 1, installment_count: 1, amount, status,
      blocked_reason: null, paid_at: null, member_name: 'x', package_name: null, sale_amount: null, commission_base: null,
      share_pct: null, gst_deduction: null, net_commission: null, invoice_balance: bal,
    });
    const t = summarize([row(3619.04, 'pending', 0), row(4000, 'blocked', 10000)], '2026-10-01');
    expect(t.payable).toBe(3619.04);
    expect(t.onHold).toBe(4000);
  });
});
