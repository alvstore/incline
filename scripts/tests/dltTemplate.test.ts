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

import { smsActivationBlocker } from '../../src/lib/templates/dlt';
import { renderPreview } from '../../src/lib/templates/eventRegistry';

test('SMS template cannot be turned on without DLT ID and header', () => {
  expect(smsActivationBlocker({ dlt_template_id: '', dlt_header: 'INCLIF' })).not.toBeNull();
  expect(smsActivationBlocker({ dlt_template_id: '1707168923456789012', dlt_header: '' })).not.toBeNull();
  expect(smsActivationBlocker({ dlt_template_id: 'abc', dlt_header: 'INCLIF' })).not.toBeNull();
  expect(smsActivationBlocker({ dlt_template_id: '1707168923456789012', dlt_header: 'INCLIF' })).toBeNull();
});

test('live preview fills brand as Incline, never the DLT sample brand', () => {
  const out = renderPreview('Happy Birthday {{member_name}}! Team {{brand_name}}', 'birthday_wish');
  expect(out).toContain('Team Incline');
  expect(out).not.toContain('{{');
});

import { dltIssues, cleanDltSpaces, toSmartpingRow } from '../../src/lib/templates/dlt';

test('Smartping: extra spaces flagged and cleaned', () => {
  expect(dltIssues('Hi  {{member_name}}. Team {{brand_name}}').length).toBe(1);
  expect(cleanDltSpaces(' Hi  there ')).toBe('Hi there');
});

test('Smartping: transactional is banks-only, promotional needs numeric sender', () => {
  const ok = 'Hi {{member_name}}. Team {{brand_name}}';
  expect(dltIssues(ok, { category: 'TRANSACTIONAL' }).length).toBe(1);
  expect(dltIssues(ok, { category: 'PROMOTIONAL', header: 'INCLIF' }).length).toBe(1);
  expect(dltIssues(ok, { category: 'SERVICE_IMPLICIT', header: 'INCLIF' })).toEqual([]);
});

test('Smartping sheet row uses one header only', () => {
  expect(toSmartpingRow('t', 'Hi. Team {{brand_name}}', null, 'INCLIF').split('\t')[1]).toBe('INCLIF');
});
