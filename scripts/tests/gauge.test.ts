import { expect, test } from 'bun:test';
import { gaugePercent, scoreTone, scoreLabel } from '../../src/lib/ui/gauge';

test('gaugePercent clamps and handles empty', () => {
  expect(gaugePercent(50)).toBe(50);
  expect(gaugePercent(150)).toBe(100);
  expect(gaugePercent(-5)).toBe(0);
  expect(gaugePercent(null)).toBe(0);
  expect(gaugePercent(2, 4)).toBe(50);
});

test('score bands', () => {
  expect(scoreTone(83)).toBe('success');
  expect(scoreTone(60)).toBe('warning');
  expect(scoreTone(30)).toBe('destructive');
  expect(scoreLabel(null)).toBe('No scan');
});
