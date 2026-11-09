// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { foldRepeats } from './foldRepeats';

const row = (id: string, seconds: number, changes = {}) => ({
  id, created_at: new Date(Date.UTC(2026, 10, 9, 12, 0, seconds)).toISOString(),
  action: 'UPDATE', table_name: 'members', record_id: 'member-1', user_id: 'actor-1',
  branch_id: 'branch-1', old_data: { status: 'pending' }, new_data: { status: 'active' }, ...changes,
});

describe('audit repeat folding', () => {
  it('combines identical events at exactly one minute and retains every raw row', () => {
    const groups = foldRepeats([row('a', 59), row('b', 119)]);
    expect(groups.length).toBe(1);
    expect(groups[0].occurrences.map(r => r.id)).toEqual(['b', 'a']);
  });
  it('does not chain a group beyond one minute', () => {
    expect(foldRepeats([row('a', 0), row('b', 40), row('c', 80)]).map(g => g.occurrences.length)).toEqual([2, 1]);
  });
  it('keeps different actors, targets, branches, actions and payloads separate', () => {
    const rows = [row('a', 0), row('b', 1, { user_id: 'actor-2' }),
      row('c', 2, { record_id: 'member-2' }), row('d', 3, { branch_id: 'branch-2' }),
      row('e', 4, { action: 'DELETE' }), row('f', 5, { new_data: { status: 'inactive' } })];
    expect(foldRepeats(rows).length).toBe(6);
  });
  it('folds across a raw page boundary and ignores JSON object key order', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(String(i), i, { record_id: `m-${i}` }));
    rows.push(row('repeat', 30, { record_id: 'm-0', new_data: { status: 'active' } }));
    expect(foldRepeats(rows).length).toBe(25);
    expect(foldRepeats([row('x', 0, { new_data: { a: 1, b: 2 } }), row('y', 1, { new_data: { b: 2, a: 1 } })])[0].occurrences.length).toBe(2);
  });
});