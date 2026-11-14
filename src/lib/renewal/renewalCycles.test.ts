// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, expect, it } from 'bun:test';
import { cycleLabel, isSuperseded, periodSince, urgencyBucket } from './renewalCycles';

describe('renewal cycles', () => {
  it('buckets urgency: lapsed, within 3 days, upcoming', () => {
    expect(urgencyBucket(-1)).toBe('lapsed');
    expect(urgencyBucket(0)).toBe('soon');
    expect(urgencyBucket(3)).toBe('soon');
    expect(urgencyBucket(4)).toBe('upcoming');
  });
  it('labels repeat cycles only', () => {
    expect(cycleLabel(1, 0)).toBeNull();
    expect(cycleLabel(3, 2)).toBe('Cycle 3 · renewed 2x before');
    expect(cycleLabel(2, 0)).toBe('Cycle 2');
  });
  it('this month starts on the IST first of the month', () => {
    expect(periodSince('month', new Date('2026-11-30T20:00:00Z'))).toBe('2026-12-01');
    expect(periodSince('30d', new Date('2026-11-14T10:00:00Z'))).toBe('2026-10-15');
  });
  it('treats superseded cycles as history', () => {
    expect(isSuperseded('superseded')).toBe(true);
    expect(isSuperseded('renewed')).toBe(false);
  });
});
