// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, expect, test } from 'bun:test';
import { logoToneFromPixels } from './logoTone';

const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];

describe('logoToneFromPixels', () => {
  test('black lettering on a transparent background is dark', () => {
    const data = [...px(0, 0, 0, 255), ...px(10, 10, 10, 255), ...px(255, 255, 255, 0), ...px(255, 255, 255, 0)];
    expect(logoToneFromPixels(data)).toBe('dark');
  });

  test('white lettering is light', () => {
    const data = [...px(250, 250, 250, 255), ...px(240, 240, 240, 255), ...px(0, 0, 0, 0)];
    expect(logoToneFromPixels(data)).toBe('light');
  });

  test('a bright orange mark is light enough to keep its colours', () => {
    expect(logoToneFromPixels([...px(249, 115, 22, 255)])).toBe('light');
  });

  test('a fully transparent image is unknown', () => {
    expect(logoToneFromPixels([...px(0, 0, 0, 0), ...px(0, 0, 0, 10)])).toBe('unknown');
  });
});
