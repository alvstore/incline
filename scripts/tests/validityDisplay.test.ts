import { describe, expect, test } from 'bun:test';
import { membershipValidity } from '../../src/lib/memberships/validityDisplay';

const today = '2026-10-25';

describe('membership validity labels', () => {
  test('plan starting tomorrow reads "Starts tomorrow", not 0 days', () => {
    expect(membershipValidity({ status: 'scheduled', startDate: '2026-10-26', todayISO: today }).label).toBe('Starts tomorrow');
  });
  test('plan starting in 5 days', () => {
    expect(membershipValidity({ status: 'scheduled', startDate: '2026-10-30', todayISO: today }).label).toBe('Starts in 5 days');
  });
  test('active plan 25 Oct – 24 Jan shows 92 days left', () => {
    expect(membershipValidity({ status: 'active', endDate: '2027-01-24', todayISO: today }).label).toBe('92 days left');
  });
  test('plan ending today is its last day', () => {
    expect(membershipValidity({ status: 'active', endDate: today, todayISO: today }).label).toBe('Last day today');
  });
  test('7 days left is critical, 20 is warning', () => {
    expect(membershipValidity({ status: 'active', endDate: '2026-10-31', todayISO: today }).tone).toBe('critical');
    expect(membershipValidity({ status: 'active', endDate: '2026-11-13', todayISO: today }).tone).toBe('warning');
  });
});
