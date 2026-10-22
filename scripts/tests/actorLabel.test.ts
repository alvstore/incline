import { describe, expect, test } from 'bun:test';
import { actorFallback, discountPercent, isHighDiscount } from '../../src/lib/audit/actorLabel';

describe('discount audit', () => {
  test('₹1,499 sold at ₹1,300 is a 13.28% discount and flagged above 10%', () => {
    expect(discountPercent(199, 1499)).toBe(13.28);
    expect(isHighDiscount(199, 1499, 10)).toBe(true);
  });
  test('a 10% discount is not flagged', () => {
    expect(isHighDiscount(100, 1000, 10)).toBe(false);
  });
});

describe('missing person label', () => {
  test('records before 22 Oct 2026 show Not recorded', () => {
    expect(actorFallback('2026-10-01T10:00:00Z')).toBe('Not recorded (before 22 Oct)');
  });
  test('newer records without a person are automatic', () => {
    expect(actorFallback('2026-10-23T10:00:00Z')).toBe('Automatic (online / system)');
  });
});
