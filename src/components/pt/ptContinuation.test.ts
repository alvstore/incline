import { describe, it, expect } from 'vitest';
import { successorOf } from './ptContinuation';
import type { PTMemberPackageRow } from './ptTypes';

const row = (o: Partial<PTMemberPackageRow>): PTMemberPackageRow => ({ id: 'x', expiry_date: '2026-10-19', ...o });

describe('successorOf', () => {
  it('expired package with a newer active package for the same member is continued', () => {
    const old = row({ id: 'a', member_id: 'm1', status: 'expired', expiry_date: '2026-10-19' });
    const next = row({ id: 'b', member_id: 'm1', status: 'active', start_date: '2026-10-20', expiry_date: '2026-11-19' });
    expect(successorOf(old, [old, next])?.id).toBe('b');
  });
  it('expired package with no follow-on stays a lapse', () => {
    const old = row({ id: 'a', member_id: 'm1', status: 'expired' });
    const other = row({ id: 'c', member_id: 'm2', status: 'active', expiry_date: '2027-01-01' });
    expect(successorOf(old, [old, other])).toBeNull();
  });
});
