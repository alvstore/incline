// Run: bun test src/lib/leads/websiteChatbot.test.ts
import { describe, expect, test } from 'bun:test';
import {
  conciergeReply, extractName, extractEmail, extractMobile, isQuestionLike, intakeAside,
  matchIntent, matchGoal, matchDuration, FIXED_PRICING_POLICY, ESCALATION_TEL, type ConciergeState,
} from './websiteChatbot';

const S = (o: Partial<ConciergeState> = {}): ConciergeState => ({ discountAsks: 0, awaitingVisit: false, plans: [], ...o });
const txt = (r: { messages: { text: string }[] }) => r.messages.map((m) => m.text).join(' | ');
const VISIT = /plan (a visit|one)/i;

describe('intake: name step understands input', () => {
  test('question is not taken as a name', () => {
    expect(extractName('WHAT IS PRICE')).toBeNull();
    expect(isQuestionLike('WHAT IS PRICE')).toBe(true);
  });
  test.each([['Rajat Lekhari', 'Rajat Lekhari'], ['my name is rajat', 'Rajat'], ["I'm Priya Sharma", 'Priya Sharma'], ['mera naam Amit hai', 'Amit'], ['hi, this is neha', 'Neha']])('%s → %s', (i, o) => expect(extractName(i)).toBe(o));
  test.each(['9828393003', 'abc@gmail.com', 'hi', 'yes', 'ok', 'how much is membership', 'where are you', 'a b c d e f'])('%s rejected', (i) => expect(extractName(i)).toBeNull());
});

describe('intake: phone/email extraction', () => {
  test.each([['+919828393003', '+919828393003'], ['my number is 98283 93003', '+919828393003'], ['09828393003', '+919828393003']])('%s', (i, o) => expect(extractMobile(i)).toBe(o));
  test.each(['12345', 'what is price', '1234567890'])('%s rejected', (i) => expect(extractMobile(i)).toBeNull());
  test('email inside a sentence', () => expect(extractEmail('mail me at ABC@Gmail.com')).toBe('abc@gmail.com'));
  test('bad email', () => expect(extractEmail('abc@gmail')).toBeNull());
});

describe('intake: typed choices are understood', () => {
  test.each([['i want to join the gym', 'Membership'], ['need a personal trainer', 'Personal training'], ['sauna and steam', 'Recovery & wellness'], ['pilates', 'Group classes & Pilates'], ['just looking', 'Just exploring']])('intent %s', (i, o) => expect(matchIntent(i)).toBe(o));
  test.each([['lose weight', 'Fat loss'], ['gain muscle', 'Build muscle'], ['stay healthy', 'General fitness'], ['marathon prep', 'Athletic performance'], ['back pain', 'Recovery & wellness']])('goal %s', (i, o) => expect(matchGoal(i)).toBe(o));
  test.each([['6 months', 'Half-Yearly'], ['yearly', 'Annual'], ['3 months', 'Quarterly'], ['monthly', 'Monthly'], ['half yearly', 'Half-Yearly']])('duration %s', (i, o) => expect(matchDuration(i)).toBe(o));
  test('nonsense does not match', () => expect(matchGoal('asdfgh')).toBeNull());
});

describe('intake aside: answers mid-intake questions without visit offers', () => {
  test('price asked at name step', () => {
    const a = intakeAside('WHAT IS PRICE', S());
    expect(txt(a)).toContain(FIXED_PRICING_POLICY);
    expect(txt(a)).not.toMatch(VISIT);
    expect(txt(a)).not.toMatch(/₹|wa\.me|whatsapp/i);
  });
  test('discount twice escalates to tel, counter carried', () => {
    const a1 = intakeAside('any discount?', S());
    const a2 = intakeAside('give me discount', a1.state);
    expect(a2.state.discountAsks).toBe(2);
    expect(a2.messages.some((m) => (m as { tel?: boolean }).tel)).toBe(true);
  });
  test('unknown question gets an honest holding line', () => expect(txt(intakeAside('do you have parking?', S()))).toMatch(/team will answer/i));
});

describe('concierge: no loops, understands objections', () => {
  test('pricing → visit offer, then "no" → never offered again', () => {
    const r1 = conciergeReply('what is the cost', S());
    expect(txt(r1)).toMatch(VISIT);
    const r2 = conciergeReply('no', r1.state);
    expect(r2.state.declinedVisit).toBe(true);
    const r3 = conciergeReply('tell me about recovery', r2.state);
    expect(txt(r3)).not.toMatch(VISIT);
    const r4 = conciergeReply('membership plans', r3.state);
    expect(txt(r4)).not.toMatch(VISIT);
  });
  test('never offers a visit two turns in a row', () => {
    const r1 = conciergeReply('price?', S());
    const r2 = conciergeReply('membership options', r1.state);
    expect(txt(r2)).not.toMatch(VISIT);
  });
  test('at most two visit offers per chat', () => {
    let st = S(); let offers = 0;
    for (const q of ['price', 'sauna', 'membership', 'recovery', 'cost', 'membership plans', 'fees']) {
      const r = conciergeReply(q, st); if (VISIT.test(txt(r))) offers++; st = r.state;
    }
    expect(offers).toBeLessThanOrEqual(2);
  });
  test.each(['i want price before visit', 'just tell me the price', "I can't visit", 'tell me fees on chat'])('objection: %s', (q) => {
    const r = conciergeReply(q, S());
    expect(r.topic).toBe('objection');
    expect(r.messages.some((m) => m.tel)).toBe(true);
    expect(txt(r)).not.toMatch(/₹|\d{3,}\s*(rs|inr)/i);
  });
  test('group pricing → tel escalation, never WhatsApp', () => {
    const r = conciergeReply('group membership for my office', S());
    expect(r.messages.some((m) => m.tel)).toBe(true);
    expect(ESCALATION_TEL).toBe('tel:8298293003');
    expect(txt(r)).not.toMatch(/wa\.me|whatsapp/i);
  });
  test('yes after offer asks for day/time; time is noted but not confirmed', () => {
    const r1 = conciergeReply('price', S());
    const r2 = conciergeReply('yes', r1.state);
    expect(txt(r2)).toMatch(/which day and time/i);
    const r3 = conciergeReply('saturday 11am', r2.state);
    expect(r3.visitPreference).toBe('saturday 11am');
    expect(txt(r3)).toMatch(/not a confirmed booking/i);
  });
  test('members never get tour offers', () => expect(txt(conciergeReply('membership cost', S({ isMember: true })))).not.toMatch(VISIT));
  test('hinglish price', () => expect(conciergeReply('fees kitna hai', S()).topic).toBe('pricing'));
});
