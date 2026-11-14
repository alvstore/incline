// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { detectPlatform, activityLevel, shouldBeat } from './platform';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

describe('detectPlatform', () => {
  it('installed on iPhone = ios', () => expect(detectPlatform(IPHONE, true)).toBe('ios'));
  it('installed on Android = android', () => expect(detectPlatform(ANDROID, true)).toBe('android'));
  it('phone browser tab = web_browser', () => expect(detectPlatform(ANDROID, false)).toBe('web_browser'));
  it('installed on desktop = web_pwa', () => expect(detectPlatform(DESKTOP, true)).toBe('web_pwa'));
  it('native hint wins', () => expect(detectPlatform(DESKTOP, false, 'android')).toBe('android'));
});

describe('activityLevel', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  it('4 minutes ago is online', () => expect(activityLevel('2026-11-14T11:56:00Z', now)).toBe('online'));
  it('6 minutes ago is active', () => expect(activityLevel('2026-11-14T11:54:00Z', now)).toBe('active'));
  it('31 days ago is inactive', () => expect(activityLevel('2026-10-14T11:00:00Z', now)).toBe('inactive'));
  it('never used', () => expect(activityLevel(null, now)).toBe('never'));
});

describe('shouldBeat', () => {
  it('beats first time', () => expect(shouldBeat(null, 0, true)).toBe(true));
  it('not before 2 minutes', () => expect(shouldBeat(0, 119_000, true)).toBe(false));
  it('beats after 2 minutes', () => expect(shouldBeat(0, 120_000, true)).toBe(true));
  it('never while hidden', () => expect(shouldBeat(null, 0, false)).toBe(false));
});
