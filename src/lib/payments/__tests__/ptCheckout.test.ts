import { describe, it, expect } from 'vitest';
import { computePtCheckout } from '../ptCheckout';

describe('computePtCheckout', () => {
  it('18% exclusive on ₹10,000 → subtotal 10000 · tax 1800 · total 11800', () => {
    expect(computePtCheckout({ price: 10000, gstPct: 18, gstInclusive: false }))
      .toEqual(expect.objectContaining({ subtotal: 10000, tax: 1800, total: 11800 }));
  });

  it('5% exclusive on ₹10,000 → 10000 · 500 · 10500', () => {
    expect(computePtCheckout({ price: 10000, gstPct: 5, gstInclusive: false }))
      .toEqual(expect.objectContaining({ subtotal: 10000, tax: 500, total: 10500 }));
  });

  it('18% inclusive on ₹11,800 → backs out to 10000 + 1800', () => {
    const r = computePtCheckout({ price: 11800, gstPct: 18, gstInclusive: true });
    expect(r.subtotal).toBe(10000);
    expect(r.tax).toBe(1800);
    expect(r.total).toBe(11800);
  });

  it('handles zero price safely', () => {
    expect(computePtCheckout({ price: 0, gstPct: 18, gstInclusive: false }))
      .toEqual(expect.objectContaining({ subtotal: 0, tax: 0, total: 0 }));
  });
});
