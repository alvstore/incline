import { expect, test } from 'bun:test';
import { isExpectedErrorOutcome } from '../../src/lib/audit/errorNoise';

test('expected invalid credentials and cancelled requests are excluded', () => {
  expect(isExpectedErrorOutcome('Invalid login credentials')).toBe(true);
  expect(isExpectedErrorOutcome('Fetch is aborted')).toBe(true);
});
test('real permission and database failures remain actionable', () => {
  expect(isExpectedErrorOutcome('Unauthorized')).toBe(false);
  expect(isExpectedErrorOutcome('column record_id is of type uuid but expression is of type text')).toBe(false);
});