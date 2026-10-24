import { describe, expect, test } from 'bun:test';
import { computeAddonTotals, daysUntil } from '../../src/lib/benefits/addonPricing';

describe('add-on pricing', () => {
  test('non-GST sale: 6 sessions for ₹7,000 cash has no tax', () => {
    expect(computeAddonTotals(7000, false, 5)).toEqual({ subtotal: 7000, tax: 0, total: 7000, rate: 0 });
  });
  test('tax invoice at 5% extracts GST from the same ₹7,000', () => {
    const t = computeAddonTotals(7000, true, 5);
    expect(t.total).toBe(7000);
    expect(t.subtotal).toBe(6666.67);
    expect(t.tax).toBe(333.33);
  });
  test('validity synced to membership end date counts remaining days', () => {
    expect(daysUntil('2026-10-30', new Date('2026-10-24T10:00:00'))).toBe(7);
  });
});
