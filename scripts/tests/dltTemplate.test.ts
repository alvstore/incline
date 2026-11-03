import { expect, test } from 'bun:test';
import { toDlt, inferDltType } from '../../src/lib/templates/dlt';

test('every placeholder becomes a positional {#var#} with brand sample as DLT entity', () => {
  const d = toDlt('Dear {{member_name}}, OTP is {{code}}. Team {{brand_name}}');
  expect(d.dltContent).toBe('Dear {#var#}, OTP is {#var#}. Team {#var#}');
  expect(d.variables.map((v) => v.type)).toEqual(['Alphanumeric', 'NUMBER', 'Alphanumeric']);
  expect(d.variables[2].sample).toBe('Muscle Garaage');
  expect(d.issues).toEqual([]);
});

test('hard-coded brand and missing brand variable are flagged', () => {
  expect(toDlt('Hi {{member_name}}, welcome to Incline').issues.length).toBe(2);
});

test('variable types follow TRAI categories', () => {
  expect(inferDltType('document_link')).toBe('URL');
  expect(inferDltType('support_phone')).toBe('Phone Number');
});
