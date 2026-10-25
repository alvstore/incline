import { expect, test } from 'bun:test';
import { isTransferDateValid, minimumTransferDate, TRANSFER_FINAL_SESSION_STATUSES } from '../../src/lib/trainers/transferDate';

test('transfer cannot precede the last completed session on 19 October', () => {
  expect(isTransferDateValid('2026-10-18', '2026-10-19')).toBe(false);
  expect(isTransferDateValid('2026-10-19', '2026-10-19')).toBe(true);
});
test('multi-package transfer uses the latest final session boundary', () => {
  expect(minimumTransferDate([null, '2026-10-19', '2026-10-24'])).toBe('2026-10-24');
  expect(minimumTransferDate([null])).toBeUndefined();
});
test('late, absent and no-show sessions retain the server transfer safeguard', () => {
  expect([...TRANSFER_FINAL_SESSION_STATUSES]).toEqual(['completed', 'late', 'absent', 'no_show']);
});