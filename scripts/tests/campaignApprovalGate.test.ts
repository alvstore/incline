import { expect, test } from 'bun:test';
import { campaignNeedsApproval } from '../../src/lib/campaigns/approvalGate';
test('manager campaign waits until owner approval', () => {
  expect(campaignNeedsApproval({ approval_required: true, approved_at: null })).toBe(true);
});
test('approved manager campaign is released for dispatch', () => {
  expect(campaignNeedsApproval({ approval_required: true, approved_at: '2026-11-01T06:43:00Z' })).toBe(false);
});
test('campaigns not requiring approval retain normal dispatch', () => {
  expect(campaignNeedsApproval({ approval_required: false, approved_at: null })).toBe(false);
});