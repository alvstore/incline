import { describe, it, expect } from 'vitest';
import { computePtCheckout } from './ptCheckout';

describe('computePtCheckout', () => {
  it('returns price as-is when GST is 0 (PT exempt)', () => {
    const r = computePtCheckout({ price: 10000, gstPct: 0, gstInclusive: false });
    expect(r.subtotal).toBe(10000);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(10000);
  });

  it('adds 18% GST exclusive', () => {
    const r = computePtCheckout({ price: 10000, gstPct: 18, gstInclusive: false });
    expect(r.subtotal).toBe(10000);
    expect(r.tax).toBe(1800);
    expect(r.total).toBe(11800);
  });

  it('extracts 18% GST from inclusive price', () => {
    const r = computePtCheckout({ price: 11800, gstPct: 18, gstInclusive: true });
    expect(r.subtotal).toBe(10000);
    expect(r.tax).toBe(1800);
    expect(r.total).toBe(11800);
  });

  it('handles 5% GST exclusive', () => {
    const r = computePtCheckout({ price: 10000, gstPct: 5, gstInclusive: false });
    expect(r.subtotal).toBe(10000);
    expect(r.tax).toBe(500);
    expect(r.total).toBe(10500);
  });

  it('clamps negative and non-numeric inputs to 0', () => {
    const r = computePtCheckout({ price: -50, gstPct: -10, gstInclusive: false });
    expect(r.subtotal).toBe(0);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(0);
  });
});
