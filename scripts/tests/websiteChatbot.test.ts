import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeIndianMobile, isValidEmail, conciergeReply, conciergeTopic, FIXED_PRICING_POLICY, ESCALATION_TEL,
  INTEREST_CATEGORIES, type ConciergeState,
} from '../../src/lib/leads/websiteChatbot';

const s0: ConciergeState = { discountAsks: 0, awaitingVisit: false, plans: ['Quarterly Plan'] };
const all = (r: { messages: { text: string }[] }) => r.messages.map((m) => m.text).join(' ');

test('Indian mobile and required email validation', () => {
  assert.equal(normalizeIndianMobile('98290 12345'), '+919829012345');
  assert.equal(normalizeIndianMobile('5829012345'), null);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail('aarav@example.com'), true);
});
test('first discount request gets the fixed-pricing policy without the phone', () => {
  const r = conciergeReply('Can I get a discount?', s0);
  assert.equal(r.messages[0].text, FIXED_PRICING_POLICY);
  assert.ok(!r.messages.some((m) => m.tel));
  const r2 = conciergeReply('Please, any special deal? negotiate a bit', r.state);
  assert.ok(r2.messages.some((m) => m.tel && /call our team directly on 8298293003/.test(m.text)));
});
test('group pricing goes straight to the phone escalation', () => {
  const r = conciergeReply('Do you have a group membership rate for 4 friends?', s0);
  assert.ok(r.messages[0].tel);
  assert.equal(ESCALATION_TEL, 'tel:8298293003');
});
test('standard price question explains policy and invites a visit, no amount, no phone', () => {
  const r = conciergeReply('How much is membership?', s0);
  assert.ok(!r.messages.some((m) => m.tel));
  assert.doesNotMatch(all(r), /₹|\d{3,}/);
  assert.match(all(r), /visit/);
});
test('facility answers are short and grounded', () => {
  const rec = conciergeReply('tell me about sauna and cold plunge', s0);
  assert.equal(rec.topic, 'recovery');
  assert.match(all(rec), /carbon heaters/);
  assert.match(all(rec), /7-wavelength red-light/);
  assert.ok(rec.messages.every((m) => m.text.length < 260));
  assert.match(all(conciergeReply('lockers?', s0)), /digital lockers/);
  assert.match(all(conciergeTopic('membership', s0)), /Quarterly Plan/);
  assert.doesNotMatch(all(conciergeTopic('membership', s0)), /₹/);
  assert.match(all(conciergeReply('do you have a swimming pool?', s0)), /rather not guess/);
});
test('visit preference is noted but never confirmed as a booking', () => {
  const a = conciergeReply('I want to visit', s0);
  const b = conciergeReply('Saturday 11am', a.state);
  assert.equal(b.visitPreference, 'Saturday 11am');
  assert.match(all(b), /not a confirmed booking/);
});
test('chatbot has no WhatsApp redirection, links, CTA or consent', () => {
  const src = readFileSync('src/components/common/WebsiteLeadChatbot.tsx', 'utf8') + readFileSync('src/lib/leads/websiteChatbot.ts', 'utf8');
  assert.doesNotMatch(src, /wa\.me|whatsapp|window\.open|press Send/i);
  assert.ok(INTEREST_CATEGORIES.length === 5);
});
