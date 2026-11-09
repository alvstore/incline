import { describe, expect, it } from 'vitest';
import { slipStage, type OfficialSlip } from './payslip';

const base = { id: 'x', status: 'draft', run_status: 'calculated', final_net: 15600 } as OfficialSlip;

describe('slipStage', () => {
  it('no slip means no pay figure', () => expect(slipStage(null)).toBe('none'));
  it('paid slip shows Paid', () => expect(slipStage({ ...base, status: 'paid', run_status: 'draft' })).toBe('paid'));
  it('approved run shows Approved', () => expect(slipStage({ ...base, run_status: 'approved' })).toBe('approved'));
  it('otherwise Draft', () => expect(slipStage(base)).toBe('draft'));
});
