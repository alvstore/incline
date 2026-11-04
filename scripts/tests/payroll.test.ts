import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payrollPeriod, payrollNet, payrollPaymentBlocker, preferredPayrollRun } from '../../src/lib/hrm/payroll';

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
test('bank remittance needs its UTR before recording payment', () => {
  assert.equal(payrollPaymentBlocker('bank_transfer', ' ', '2026-11-04', '2026-11-04'), 'Enter the UTR / payment reference');
  assert.equal(payrollPaymentBlocker('bank_transfer', 'UTR-123', '2026-11-04', '2026-11-04'), null);
});
test('cash payment does not require a bank reference', () => {
  assert.equal(payrollPaymentBlocker('cash', '', '2026-11-04', '2026-11-04'), null);
});
test('future remittance cannot be marked paid', () => {
  assert.equal(payrollPaymentBlocker('cash', '', '2026-11-05', '2026-11-04'), 'Choose a payment date no later than today');
});
test('historical paid run is preferred over newer unpaid duplicate', () => {
  const runs = [{id:'new-draft',status:'calculated'}, {id:'saved-paid',status:'calculated'}];
  assert.equal(preferredPayrollRun(runs, new Set(['saved-paid']), null), 'saved-paid');
  assert.equal(preferredPayrollRun(runs, new Set(['saved-paid']), 'new-draft'), 'new-draft');
});