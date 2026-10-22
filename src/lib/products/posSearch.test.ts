import { describe, it, expect } from 'vitest';
import { matchesProductSearch, computeManualDiscount } from './posSearch';

const glutamine = ['Muscletech™ Platinum Glutamine', null, 'MT26361'];

describe('counter product search', () => {
  it('finds the glutamine despite the ™ symbol and word order', () => {
    expect(matchesProductSearch('muscletech platinum', glutamine)).toBe(true);
    expect(matchesProductSearch('muscle tech glutamine', glutamine)).toBe(true);
    expect(matchesProductSearch('glutamine muscletech', glutamine)).toBe(true);
  });
  it('finds by SKU', () => {
    expect(matchesProductSearch('mt26361', glutamine)).toBe(true);
  });
  it('does not match unrelated words', () => {
    expect(matchesProductSearch('creatine', glutamine)).toBe(false);
  });
});

describe('manual discount', () => {
  it('selling ₹1,499 at ₹1,300 is a ₹199 discount', () => {
    expect(computeManualDiscount({ subtotal: 1499, couponDiscount: 0, mode: 'amount', value: 199 })).toBe(199);
  });
  it('percent discount is taken on the bill', () => {
    expect(computeManualDiscount({ subtotal: 1499, couponDiscount: 0, mode: 'percent', value: 10 })).toBe(149.9);
  });
  it('never takes the bill below zero after a coupon', () => {
    expect(computeManualDiscount({ subtotal: 1000, couponDiscount: 900, mode: 'amount', value: 500 })).toBe(100);
  });
});
