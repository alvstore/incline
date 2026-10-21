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

describe('trainer GST cut on commission', () => {
  test('₹12,000 at 50% = ₹6,000, minus 5% = ₹5,700', () => {
    expect(ptCommission(12000, 50, 5).net).toBe(5700);
  });
  test('trainer with 0% deduction keeps full commission', () => {
    expect(ptCommission(12000, 50, 0).net).toBe(6000);
  });
});

import { describe as d2, it as i2, expect as e2 } from 'bun:test';
d2('non-tax PT sale', () => {
  i2('₹10,000 cash/non-tax sale at 40% pays full ₹4,000 — no GST cut', () => {
    const c = ptCommission(10000, 40, 5, false);
    e2(c.deduction).toBe(0);
    e2(c.net).toBe(4000);
  });
});
