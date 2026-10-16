import { describe, expect, test } from 'bun:test';
import { categoryMismatch } from '../../src/lib/comms/messageCategory';

// Trainer-assignment and plan-assigned notices are utility messages:
// a marketing template must never be accepted for them.
describe('trainer assignment WhatsApp template category', () => {
  test('utility notice rejects a marketing template', () => {
    expect(categoryMismatch('utility', 'MARKETING')).toBe(true);
  });
  test('utility notice accepts a utility template', () => {
    expect(categoryMismatch('utility', 'UTILITY')).toBe(false);
  });
});
