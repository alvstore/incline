import { expect, test } from 'bun:test';
import { metaDmOutcome } from '../../supabase/functions/_shared/metaDmOutcome';

test('closed-window refusals remain visible as delivery warnings', () => {
  expect(metaDmOutcome(10, 'This message is sent outside of allowed window.', 400)).toEqual({ severity: 'warning', status: 422, classification: 'closed_window' });
});
test('credentials, unknown refusals and provider failures remain actionable errors', () => {
  expect(metaDmOutcome(190, 'Invalid access token', 400).severity).toBe('error');
  expect(metaDmOutcome(100, 'Invalid parameter', 400).status).toBe(502);
  expect(metaDmOutcome(null, 'Unavailable', 503).severity).toBe('error');
});