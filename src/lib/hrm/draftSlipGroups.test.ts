// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { groupDraftSlips } from './draftSlipGroups';

const s = (id: string, month: string, net: number) => ({ id, user_id: id, name: id, final_net: net, period_start: `${month}-01` });

describe('groupDraftSlips', () => {
  it('groups by month newest first with totals', () => {
    const g = groupDraftSlips([s('a', '2026-08', 100), s('b', '2026-09', 50.5), s('c', '2026-08', 200)]);
    expect(g.map(x => x.month)).toEqual(['2026-09', '2026-08']);
    expect(g[1].total).toBe(300);
    expect(g[1].slips.length).toBe(2);
  });
});
