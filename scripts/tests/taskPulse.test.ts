import { describe, it, expect } from 'bun:test';
import { taskTypeOf, rankTasks, previewTasks } from '../../src/lib/tasks/taskType';

describe('task pulse helpers', () => {
  it('maps request titles to types', () => {
    expect(taskTypeOf({ title: 'Diet plan request from Amit' })).toBe('diet');
    expect(taskTypeOf({ title: 'Trainer request from Mohit' })).toBe('trainer');
    expect(taskTypeOf({ title: 'Call vendor' })).toBe('general');
  });
  const t = (id: string, priority: string, due: string | null, created: string) => ({ id, priority, due_date: due, created_at: created });
  it('ranks overdue, then high priority, then oldest', () => {
    const r = rankTasks([
      t('new', 'medium', null, '2026-10-15'),
      t('old', 'medium', null, '2026-10-01'),
      t('high', 'high', null, '2026-10-14'),
      t('late', 'low', '2026-10-10', '2026-10-12'),
    ], '2026-10-16');
    expect(r.map((x) => x.id)).toEqual(['late', 'high', 'old', 'new']);
  });
  it('caps preview at 3', () => {
    const list = Array.from({ length: 6 }, (_, i) => t(String(i), 'medium', null, `2026-10-0${i + 1}`));
    expect(previewTasks(list, '2026-10-16')).toHaveLength(3);
  });
});
