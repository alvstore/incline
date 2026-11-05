import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIndianMobile, isValidEmail, buildWhatsAppDraft, buildWhatsAppUrl, WHATSAPP_HANDOFF_CONSENT, SAVED_NOTICE } from '../../src/lib/leads/websiteChatbot';

test('Indian mobile validation accepts common formats and rejects others', () => {
  assert.equal(normalizeIndianMobile('98290 12345'), '+919829012345');
  assert.equal(normalizeIndianMobile('+91-98290-12345'), '+919829012345');
  assert.equal(normalizeIndianMobile('09829012345'), '+919829012345');
  assert.equal(normalizeIndianMobile('5829012345'), null);
  assert.equal(normalizeIndianMobile('12345'), null);
});
test('optional email validation', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('nope'), false);
});
test('WhatsApp draft references the website enquiry and never includes email or phone', () => {
  const draft = buildWhatsAppDraft({ name: 'Aarav Shah', goal: 'Fat loss', timeframe: 'within_30_days', reference: 'WEB-AB12CD' });
  assert.match(draft, /Aarav/);
  assert.match(draft, /website \(ref WEB-AB12CD\)/);
  assert.match(draft, /Fat loss/);
  assert.match(draft, /Within 30 days/);
  assert.doesNotMatch(draft, /@|\d{10}/);
  const url = buildWhatsAppUrl(draft);
  assert.ok(url.startsWith('https://wa.me/918298293003?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), draft);
});
test('consent and saved wording tell the visitor they must press Send', () => {
  assert.match(WHATSAPP_HANDOFF_CONSENT, /nothing is sent until I press Send/);
  assert.match(SAVED_NOTICE, /press Send there/);
  assert.doesNotMatch(SAVED_NOTICE, /sent your message/i);
});
