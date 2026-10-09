import { describe, expect, test } from 'bun:test';
import { mergeMemberEntitlements } from '../../src/lib/benefits/memberEntitlements';

const scanType = {
  name: 'Body Composition & Posture Scan',
  code: '3d_body_scanning',
  icon: 'scan',
  is_bookable: false,
};

describe('member entitlement aggregation', () => {
  test('shows a gift-only assessment with one remaining use', () => {
    const result = mergeMemberEntitlements([], [], [{
      id: 'gift-1', benefit_type_id: 'scan-1', comp_sessions: 1, used_sessions: 0,
      expires_at: '2026-11-11T00:00:00Z', benefit_types: scanType,
    }], [], new Date('2026-10-09T00:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0]?.giftRemaining).toBe(1);
    expect(result[0]?.remaining).toBe(1);
    expect(result[0]?.isGiftOnly).toBe(true);
    expect(result[0]?.isScannerAssessment).toBe(true);
    expect(result[0]?.canBookRecovery).toBe(false);
  });

  test('merges plan, gift, add-on and usage balances by benefit type id', () => {
    const result = mergeMemberEntitlements(
      [{ id: 'plan-benefit', benefit_type_id: 'scan-1', frequency: 'per_membership', limit_count: 2, benefit_types: scanType }],
      [{ benefit_type_id: 'scan-1', usage_count: 1 }],
      [{ id: 'gift-1', benefit_type_id: 'scan-1', comp_sessions: 2, used_sessions: 1, expires_at: null, benefit_types: scanType }],
      [{ id: 'credit-1', benefit_type_id: 'scan-1', credits_total: 3, credits_remaining: 2, expires_at: null, benefit_type: scanType }],
    );

    expect(result[0]?.total).toBe(7);
    expect(result[0]?.remaining).toBe(4);
    expect(result[0]?.giftRemaining).toBe(1);
    expect(result[0]?.addOnRemaining).toBe(2);
  });

  test('excludes expired and exhausted gifts from available balances', () => {
    const result = mergeMemberEntitlements([], [], [
      { id: 'expired', benefit_type_id: 'scan-1', comp_sessions: 1, used_sessions: 0, expires_at: '2026-10-01T00:00:00Z', benefit_types: scanType },
      { id: 'used', benefit_type_id: 'scan-1', comp_sessions: 1, used_sessions: 1, expires_at: null, benefit_types: scanType },
    ], [], new Date('2026-10-09T00:00:00Z'));

    expect(result).toHaveLength(0);
  });
});