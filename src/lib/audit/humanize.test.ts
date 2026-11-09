// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { sentenceText, formatValue, isNoise, specialActionLabel, actorLabel } from './humanize';

describe('audit humanize', () => {
  it('task status change reads as a sentence', () => {
    expect(sentenceText({ action: 'UPDATE', table_name: 'tasks', actor_name: 'Rajat Lekhari', target_name: 'Workout plan request',
      old_data: { status: 'pending' }, new_data: { status: 'completed' } })).toBe('Rajat Lekhari marked task Workout plan request as Completed');
  });
  it('money and booleans are formatted', () => {
    expect(formatValue('total_amount', 25000).text).toBe('₹25,000');
    expect(formatValue('is_late', false).text).toBe('No');
  });
  it('timestamp-only updates are noise', () => {
    expect(isNoise({ action: 'UPDATE', table_name: 'x', old_data: { updated_at: 'a', a: 1 }, new_data: { updated_at: 'b', a: 1 } })).toBe(true);
    expect(isNoise({ action: 'UPDATE', table_name: 'x', old_data: { a: 1 }, new_data: { a: 2 } })).toBe(false);
  });
  it('special events and gate actor are readable', () => {
    expect(specialActionLabel('CONTRACT_FIELDS_FILLED')).toBe('filled in contract details');
    expect(actorLabel({ action: 'UPDATE', table_name: 'staff_attendance', new_data: { source: 'gate' } })).toBe('Gate system');
  });
});
