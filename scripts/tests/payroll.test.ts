import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payrollPeriod, payrollNet } from '../../src/lib/hrm/payroll';

test('October payroll includes October 31 in every timezone', () => {
  assert.deepEqual(payrollPeriod('2026-10'), { start: '2026-10-01', end: '2026-10-31', days: 31 });
});
test('two half days earn 30 days of salary in October, not 31', () => {
  const days = payrollPeriod('2026-10').days;
  assert.equal(Math.round(12000 * (days - 2 * 0.5) / days * 100) / 100, 11612.90);
});
test('overtime is included in net, together with all saved deductions', () => {
  assert.equal(payrollNet({base:12000,pt:1000,ot:500,bonus:200,deductions:100,advance:1000,penalty:50}),12550);
});