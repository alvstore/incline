import { strict as assert } from 'node:assert';
import {
  conversionRate,
  referralMatches,
  rewardDisplayStatus,
  rewardMatches,
} from '../../src/components/referrals/referralWorkspaceUtils';

const referral = {
  referral_code: 'REF-ABC',
  referred_name: 'Mohit Gurjar',
  referred_phone: '+919876543210',
  referred_email: 'mohit@example.com',
  status: 'new',
  referrer: {
    member_code: 'INC-26-0014',
    profiles: { full_name: 'Sandeep Chouhan' },
  },
};

assert.equal(conversionRate(8, 3), 37.5);
assert.equal(conversionRate(0, 0), 0);
assert.equal(referralMatches(referral, 'mohit', 'all'), true);
assert.equal(referralMatches(referral, 'INC-26', 'new'), true);
assert.equal(referralMatches(referral, '', 'converted'), false);

const pendingReward = {
  is_claimed: false,
  claim_status: 'pending_approval',
  members: { member_code: 'INC-1', profiles: { full_name: 'Mohit' } },
  referrals: { referral_code: 'REF-1' },
};

assert.equal(rewardDisplayStatus(pendingReward), 'pending_approval');
assert.equal(rewardMatches(pendingReward, 'Mohit', 'pending_approval'), true);
assert.equal(rewardDisplayStatus({ ...pendingReward, is_claimed: true }), 'credited');

console.log('referral workspace tests passed');