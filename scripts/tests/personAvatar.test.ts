import { describe, expect, test } from 'bun:test';
import { avatarSrc, pickAvatar } from '../../src/lib/media/personAvatar';

const pub = 'https://x.co/storage/v1/object/public/avatars/a';
const sig = 'https://x.co/storage/v1/object/sign/member-photos/biometric/members/a.jpg?token=t';

describe('attendance photo picking', () => {
  test('permanent profile photo wins', () => {
    expect(pickAvatar({ profileAvatar: pub, biometricUrl: sig, biometricPath: 'p' })).toEqual({ url: pub, path: null });
  });
  test('expired temporary links are skipped in favour of the stored gate photo', () => {
    expect(pickAvatar({ profileAvatar: sig, biometricUrl: sig, biometricPath: 'p.jpg' })).toEqual({ url: null, path: 'p.jpg' });
    expect(avatarSrc({ profileAvatar: sig, biometricPath: 'p.jpg' }, { 'p.jpg': 'fresh' })).toBe('fresh');
  });
  test('initials when no photo at all', () => {
    expect(avatarSrc({ profileAvatar: null, biometricUrl: null, biometricPath: null }, {})).toBeNull();
  });
});
