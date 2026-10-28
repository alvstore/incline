import { describe, expect, test } from 'bun:test';
import { cmToFeetInches, feetInchesToCm, isValidHeightCm } from '../../src/lib/scans/height';
import { bookingSourceMeta, isAppBooking, normalizeBookingSource } from '../../src/lib/bookings/bookingSource';

describe('scan height conversion', () => {
  test('5 ft 9 in is 175.3 cm', () => {
    expect(feetInchesToCm(5, 9)).toBe(175.3);
  });
  test('168 cm shows as 5 ft 6 in', () => {
    expect(cmToFeetInches(168)).toEqual({ feet: 5, inches: 6 });
  });
  test('inches roll over at 12 (182.6 cm -> 6 ft 0 in)', () => {
    expect(cmToFeetInches(182.6)).toEqual({ feet: 6, inches: 0 });
  });
  test('scanner accepts only 100-250 cm', () => {
    expect(isValidHeightCm(99.9)).toBe(false);
    expect(isValidHeightCm(100)).toBe(true);
    expect(isValidHeightCm(250)).toBe(true);
    expect(isValidHeightCm(250.1)).toBe(false);
  });
});

describe('booking source badges', () => {
  test('Android and iPhone app bookings get their own labels', () => {
    expect(bookingSourceMeta('app_android').label).toBe('Android app');
    expect(bookingSourceMeta('app_ios').label).toBe('iPhone app');
    expect(isAppBooking('app_ios')).toBe(true);
    expect(isAppBooking('member_portal')).toBe(false);
  });
  test('missing or unknown source is treated as the web portal', () => {
    expect(normalizeBookingSource(null)).toBe('member_portal');
    expect(normalizeBookingSource('mobile_app')).toBe('member_portal');
  });
});
