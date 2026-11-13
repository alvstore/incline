// @ts-expect-error bun types
import { expect, test } from 'bun:test';
import { computeRefund, remainingDue } from './cancellationMath';
test('full refund never exceeds received', () => expect(computeRefund({ choice: 'full', received: 1, totalDays: 180, daysRemaining: 150 })).toBe(1));
test('prorated is based on received, not plan price', () => expect(computeRefund({ choice: 'prorated', received: 9000, totalDays: 180, daysRemaining: 90 })).toBe(4500));
test('custom refund is capped at received', () => expect(computeRefund({ choice: 'custom', received: 5000, totalDays: 30, daysRemaining: 10, custom: 18000 })).toBe(5000));
test('no refund', () => expect(computeRefund({ choice: 'none', received: 5000, totalDays: 30, daysRemaining: 10 })).toBe(0));
test('write-off clears dues', () => expect(remainingDue(17999, 'write_off')).toBe(0));
test('keep-due leaves the balance', () => expect(remainingDue(17999, 'keep')).toBe(17999));
