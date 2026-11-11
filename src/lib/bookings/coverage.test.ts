import { describe, it, expect } from 'vitest';
import { isDayCovered, hasMembershipEnded, friendlyError } from './coverage';

describe('membership coverage', () => {
  it('allows booking on the membership end date', () => {
    expect(isDayCovered('2026-11-11', '2026-11-11')).toBe(true);
  });
  it('refuses booking the day after the end date', () => {
    expect(isDayCovered('2026-11-12', '2026-11-11')).toBe(false);
  });
  it('refuses everything without a membership', () => {
    expect(isDayCovered('2026-11-11', null)).toBe(false);
    expect(hasMembershipEnded(null)).toBe(true);
  });
  it('treats the membership as ended the day after its end date (IST)', () => {
    // 12 Nov 2026 10:00 IST
    const now = new Date('2026-11-12T04:30:00Z');
    expect(hasMembershipEnded('2026-11-11', now)).toBe(true);
    expect(hasMembershipEnded('2026-11-12', now)).toBe(false);
  });
  it('strips the internal code from server refusals', () => {
    expect(friendlyError('membership_not_covering_date: Renew to continue.', 'x')).toBe('Renew to continue.');
  });
});
