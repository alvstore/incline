// @ts-expect-error bun test runtime
import { describe, expect, test } from 'bun:test';
import { resolvePaymentLinkAmount as r } from '../../../supabase/functions/_shared/paymentLinkAmount';

describe('payment link amount is server-derived', () => {
  test('defaults to the invoice balance', () => {
    expect(r({ due: 15000, isStaff: true })).toEqual({ ok: true, amount: 15000, partial: false, reason: null });
  });
  test('part payment without a reason is refused', () => {
    expect(r({ due: 15000, isStaff: true, mode: 'partial', partialAmount: 5000 }).ok).toBe(false);
  });
  test('part payment with a reason is allowed for staff', () => {
    expect(r({ due: 15000, isStaff: true, mode: 'partial', partialAmount: 5000, partialReason: 'Rest on 30 Nov' }))
      .toEqual({ ok: true, amount: 5000, partial: true, reason: 'Rest on 30 Nov' });
  });
  test('more than the balance is refused', () => {
    const res = r({ due: 15000, isStaff: true, mode: 'partial', partialAmount: 20000, partialReason: 'too much' });
    expect(res.ok === false && res.code).toBe('AMOUNT_EXCEEDS_DUE');
  });
  test('members cannot request a part payment', () => {
    const res = r({ due: 15000, isStaff: false, legacyAmount: 1 });
    expect(res.ok === false && res.code).toBe('FULL_AMOUNT_REQUIRED');
  });
  test('nothing due is refused', () => {
    expect(r({ due: 0, isStaff: true }).ok).toBe(false);
  });
});
