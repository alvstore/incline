import { describe, expect, test } from 'bun:test';
import { clickOnActivateKey } from './clickable';

function fakeEvent(key: string, sameTarget = true) {
  let clicked = 0;
  let prevented = false;
  const el = { click: () => { clicked += 1; } };
  const e = {
    key,
    target: sameTarget ? el : {},
    currentTarget: el,
    preventDefault: () => { prevented = true; },
  } as any;
  return { e, get clicked() { return clicked; }, get prevented() { return prevented; } };
}

describe('clickOnActivateKey', () => {
  test('Enter clicks the element once', () => {
    const f = fakeEvent('Enter');
    clickOnActivateKey(f.e);
    expect(f.clicked).toBe(1);
    expect(f.prevented).toBe(true);
  });

  test('Space clicks the element once and does not scroll', () => {
    const f = fakeEvent(' ');
    clickOnActivateKey(f.e);
    expect(f.clicked).toBe(1);
    expect(f.prevented).toBe(true);
  });

  test('other keys do nothing', () => {
    const f = fakeEvent('Tab');
    clickOnActivateKey(f.e);
    expect(f.clicked).toBe(0);
    expect(f.prevented).toBe(false);
  });

  test('keys pressed on an inner control are left alone', () => {
    const f = fakeEvent('Enter', false);
    clickOnActivateKey(f.e);
    expect(f.clicked).toBe(0);
  });
});
