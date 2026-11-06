import { describe, it, expect } from 'vitest';
import { formatPace, formatDuration } from './treadmill';

describe('treadmill formatting', () => {
  it('30 min over 4.2 km is 7:09 per km', () => {
    expect(formatPace(1800, 4200)).toBe('7:09 /km');
  });
  it('no distance shows dash', () => {
    expect(formatPace(600, 0)).toBe('—');
  });
  it('formats durations', () => {
    expect(formatDuration(1800)).toBe('30m 00s');
    expect(formatDuration(3900)).toBe('1h 5m');
  });
});
