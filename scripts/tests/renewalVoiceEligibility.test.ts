import { expect, test } from 'bun:test';
import { renewalVoiceBlockReason } from '../../src/lib/renewal/voiceEligibility';
const row = { claimed_by: null, stage: 'eligible', voice_attempts_count: 0 };
test('claimed cases remain with staff', () => {
  expect(renewalVoiceBlockReason({ ...row, claimed_by: 'staff-id' })).not.toBeNull();
});
test('callbacks require staff review', () => {
  expect(renewalVoiceBlockReason({ ...row, stage: 'callback' })).not.toBeNull();
});
test('staff follow-up cannot restart AI calling', () => {
  expect(renewalVoiceBlockReason({ ...row, stage: 'staff_followup' })).not.toBeNull();
});
test('three calls exhaust the cycle budget', () => {
  expect(renewalVoiceBlockReason({ ...row, voice_attempts_count: 3 })).not.toBeNull();
  expect(renewalVoiceBlockReason({ ...row, voice_attempts_count: 2 })).toBeNull();
});
test('unclaimed eligible case can request a call, subject to server cooldown', () => {
  expect(renewalVoiceBlockReason(row)).toBeNull();
});