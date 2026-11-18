// @ts-expect-error bun test runtime
import { describe, expect, it } from 'bun:test';
import { actualFreezeDays, freezeNeedsApproval, freezeValidation, shiftFreezeDate } from './freezePolicy'
import { freezeFeeQuote } from './freezePolicy';
const base = { mode: 'plan' as const, days: 7, reason: 'Medical leave', remaining: 30, minDays: 7, maxDays: 30, exceptionsEnabled: true, fee: 500 };
describe('membership freeze policy', () => {
  it('open-ended exceptions need no duration and bypass the 30-day allowance', () => {
    expect(freezeValidation({ ...base, mode: 'override', openEnded: true, days: NaN, remaining: 0 })).toBeNull();
  });
  it('open-ended freezes cannot consume plan days or create a paid freeze', () => {
    expect(freezeValidation({ ...base, openEnded: true })).toBe('Plan days need a set duration; choose Paid or Exception to freeze until return.');
    expect(freezeValidation({ ...base, mode: 'paid', openEnded: true, days: NaN })).toBeNull();
    expect(freezeValidation({ ...base, mode: 'paid', openEnded: true, fee: 0 })).toBe('Enter a freeze fee above ₹0.');
  });
  it('open-ended exceptions require a reason and an enabled branch policy', () => {
    expect(freezeValidation({ ...base, mode: 'override', openEnded: true, reason: '' })).toBe('Enter a reason of at least 6 characters.');
    expect(freezeValidation({ ...base, mode: 'override', openEnded: true, exceptionsEnabled: false })).toBe('Freeze exceptions are disabled for this branch.');
  });
  it('open-ended resume credits 112 actual days with no thirty-day cap', () => {
    expect(actualFreezeDays('2026-11-18', null, '2027-03-10')).toBe(112);
    expect(shiftFreezeDate('2027-09-01', 112)).toBe('2027-12-22');
    expect(actualFreezeDays('2026-11-18', null, '2026-11-18')).toBe(0);
  });
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
    expect(freezeValidation({ ...base, mode: 'paid', fee: 0 })).toBe('Enter a freeze fee above ₹0.');
    expect(freezeValidation({ ...base, days: 31 })).toBe('Choose 7–30 days for this branch.');
  });
});
describe('paid freeze fee', () => {
  it('₹3,500 with GST is ₹4,130 on an INV bill', () => { expect(freezeFeeQuote(3500, true)).toEqual({ base: 3500, tax: 630, total: 4130, series: 'INV' }); });
  it('₹3,500 without GST stays ₹3,500 on a BOS bill', () => { expect(freezeFeeQuote(3500, false)).toEqual({ base: 3500, tax: 0, total: 3500, series: 'BOS' }); });
  it('blocks a paid freeze with no fee', () => { expect(freezeValidation({ mode: 'paid', days: 10, reason: 'Travel abroad', remaining: 0, minDays: 7, maxDays: 30, exceptionsEnabled: true, fee: 0 })).toMatch(/fee/); });
});
