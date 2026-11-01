import { expect, test } from 'bun:test';
import { dumbbellPose } from '../../src/components/3d/dumbbellMotion';

test('hero stays left and within narrow and wide viewports', () => {
  for (const [width, height, compact] of [[1.7, 4.6, true], [3.2, 4.6, false], [8, 4.6, false]] as const) {
    const pose = dumbbellPose(0, width, height, compact);
    expect(pose.x).toBeLessThan(0);
    expect(pose.x - pose.scale).toBeGreaterThan(-width / 2);
    expect(pose.x + pose.scale).toBeLessThan(0);
  }
});

test('scroll transitions are continuous at every story boundary', () => {
  for (const boundary of [0.25, 0.5, 0.75]) {
    const before = dumbbellPose(boundary - 0.00001, 8, 4.6, false);
    const after = dumbbellPose(boundary + 0.00001, 8, 4.6, false);
    expect(Math.abs(before.x - after.x)).toBeLessThan(0.001);
    expect(Math.abs(before.spread - after.spread)).toBeLessThan(0.001);
  }
});