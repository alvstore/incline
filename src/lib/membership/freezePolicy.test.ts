// @ts-expect-error bun test runtime
import { describe, expect, it } from 'bun:test';
import { actualFreezeDays, freezeNeedsApproval, freezeValidation, shiftFreezeDate } from './freezePolicy';
const base = { mode: 'plan' as const, days: 7, reason: 'Medical leave', remaining: 30, minDays: 7, maxDays: 30, exceptionsEnabled: true, fee: 500 };
describe('membership freeze policy', () => {
  it('no assigned plan allowance means zero, not a default 30 days', () => {
    expect(freezeValidation({ ...base, remaining: 0 })).toBe('Duration exceeds the remaining plan allowance.');
  });
  it('staff can freeze within allowance without approval', () => {
    expect(freezeNeedsApproval('plan', false)).toBe(false);
  });
  it('staff exceptions require approval', () => {
    expect(freezeNeedsApproval('override', false)).toBe(true);
    expect(freezeNeedsApproval('paid', false)).toBe(true);
  });
  it('management can override quota with a recorded reason', () => {
    expect(freezeNeedsApproval('override', true)).toBe(false);
    expect(freezeValidation({ ...base, mode: 'override', remaining: 0, days: 60 })).toBeNull();
    expect(freezeValidation({ ...base, mode: 'override', reason: '' })).toBe('Enter a reason of at least 6 characters.');
  });
  it('the kill switch blocks exceptions but not plan freezes', () => {
    expect(freezeValidation({ ...base, mode: 'override', exceptionsEnabled: false })).toBe('Freeze exceptions are disabled for this branch.');
    expect(freezeValidation({ ...base, exceptionsEnabled: false })).toBeNull();
  });
  it('early resume credits five actual days, not the requested thirty', () => {
    const days = actualFreezeDays('2026-11-18', '2026-12-17', '2026-11-23');
    expect(days).toBe(5);
    expect(shiftFreezeDate('2027-09-01', days)).toBe('2027-09-06');
  });
  it('same-day resume credits zero and the complete inclusive period credits 30', () => {
    expect(actualFreezeDays('2026-11-18', '2026-12-17', '2026-11-18')).toBe(0);
    expect(actualFreezeDays('2026-11-18', '2026-12-17', '2026-12-18')).toBe(30);
    expect(actualFreezeDays('2026-11-18', '2026-12-17', '2026-12-25')).toBe(30);
    expect(shiftFreezeDate('2027-09-01', 30)).toBe('2027-10-01');
  });
  it('paid freezes require a saved fee and branch duration limits', () => {
    expect(freezeValidation({ ...base, mode: 'paid', fee: 0 })).toBe('No paid freeze fee is configured.');
    expect(freezeValidation({ ...base, days: 31 })).toBe('Choose 7–30 days for this branch.');
  });
});