// @ts-expect-error bun test runtime
import { describe, expect, it } from 'bun:test';
import { quoteLockerAssignment, validateLockerAssignment } from './assignPricing';
const base = { listFee: 3500, gstRate: 18, mode: 'standard' as const, discountKind: 'flat' as const, discountValue: 0, planIncluded: false };
describe('locker assignment pricing', () => {
  it('standard uses the set price plus GST', () => {
    expect(quoteLockerAssignment(base).total).toBe(4130);
  });
  it('percent discount comes off the set price before GST', () => {
    const q = quoteLockerAssignment({ ...base, mode: 'discount', discountKind: 'percent', discountValue: 20 });
    expect(q.taxable).toBe(2800);
    expect(q.total).toBe(3304);
  });
  it('complimentary is zero', () => {
    expect(quoteLockerAssignment({ ...base, mode: 'complimentary' }).total).toBe(0);
  });
  it('complimentary needs a reason', () => {
    expect(validateLockerAssignment({ ...base, mode: 'complimentary', reason: '' })).not.toBeNull();
    expect(validateLockerAssignment({ ...base, mode: 'complimentary', reason: 'Founder guest' })).toBeNull();
  });
  it('discount needs a reason', () => {
    expect(validateLockerAssignment({ ...base, mode: 'discount', discountValue: 500, reason: '' })).not.toBeNull();
  });
  it('plan-included needs no reason', () => {
    expect(validateLockerAssignment({ ...base, planIncluded: true, mode: 'complimentary', reason: '' })).toBeNull();
  });
});
