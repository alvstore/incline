import { describe, it, expect } from 'bun:test';
import { lockerPricing, LOCKER_SIZES } from '../../src/components/member/requests/requestTypes';

describe('dedicated locker pricing', () => {
  it('medium is ₹2,500 + 18% GST', () => {
    expect(lockerPricing('Medium')).toEqual({ base: 2500, gst: 450, total: 2950 });
  });
  it('large is ₹3,500 + 18% GST', () => {
    expect(lockerPricing('Large')).toEqual({ base: 3500, gst: 630, total: 4130 });
  });
  it('members can only request medium or large', () => {
    expect([...LOCKER_SIZES]).toEqual(['Medium', 'Large']);
  });
});
