import { describe, it, expect } from 'vitest';
import { stockFor, stockState, groupStock } from './stockStatus';

describe('stock rule', () => {
  it('treats a missing stock row as 0, not available', () => {
    expect(stockFor({ inventory: [] }, 'b1')).toBe(0);
    expect(stockFor({ inventory: [{ branch_id: 'b2', quantity: 4 }] }, 'b1')).toBe(0);
  });
  it('reads the branch row', () => {
    expect(stockFor({ inventory: [{ branch_id: 'b1', quantity: 3 }] }, 'b1')).toBe(3);
  });
  it('uses batch quantity for batch-tracked products', () => {
    expect(stockFor({ requires_batch_tracking: true, inventory: [{ branch_id: 'b1', quantity: 9 }] }, 'b1', 2)).toBe(2);
  });
  it('sold to zero is out of stock; below minimum is low', () => {
    expect(stockState(0)).toBe('out');
    expect(stockState(2, 5)).toBe('low');
    expect(stockState(6, 5)).toBe('in');
  });
  it('a product with options is out only when all options are 0', () => {
    expect(groupStock([0, 0, 0])).toBe(0);
    expect(groupStock([0, 1, 0])).toBe(1);
  });
});
