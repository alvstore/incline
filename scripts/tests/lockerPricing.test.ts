import { describe, it, expect } from 'bun:test';
import { lockerPricing, LOCKER_SIZES } from '../../src/components/member/requests/requestTypes';

describe('dedicated locker pricing', () => {
  it('medium defaults to ₹2,500 + 18% GST', () => {
    expect(lockerPricing('Medium')).toMatchObject({ base: 2500, gst: 450, total: 2950 });
  });
  it('large defaults to ₹3,500 + 18% GST', () => {
    expect(lockerPricing('Large')).toMatchObject({ base: 3500, gst: 630, total: 4130 });
  });
  it('uses admin-set prices', () => {
    expect(lockerPricing('Large', { medium_fee: 2000, large_fee: 4000, gst_enabled: true, gst_rate: 18 }).total).toBe(4720);
  });
  it('GST off charges the base fee only', () => {
    expect(lockerPricing('Medium', { medium_fee: 2500, large_fee: 3500, gst_enabled: false, gst_rate: 18 })).toMatchObject({ gst: 0, total: 2500 });
  });
  it('members can only request medium or large', () => {
    expect([...LOCKER_SIZES]).toEqual(['Medium', 'Large']);
  });
});
