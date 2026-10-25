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
test('weak-password feedback is excluded without hiding other auth failures', () => {
  expect(isExpectedErrorOutcome('Password is known to be weak and easy to guess, please choose a different one.')).toBe(true);
  expect(isExpectedErrorOutcome('Password should be at least 8 characters.')).toBe(true);
  expect(isExpectedErrorOutcome('Unable to update password: database failure')).toBe(false);
});