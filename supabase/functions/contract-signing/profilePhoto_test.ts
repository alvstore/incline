import { assertEquals } from 'https://deno.land/std@0.190.0/testing/asserts.ts';
import { profilePhotoPath, photoDimensions } from './profilePhoto.ts';

Deno.test('display photos use only this backend avatars bucket, including expired links', () => {
  const origin = 'https://backend.example';
  assertEquals(profilePhotoPath(`${origin}/storage/v1/object/public/avatars/person/photo.jpg`, origin), 'person/photo.jpg');
  assertEquals(profilePhotoPath(`${origin}/storage/v1/object/sign/avatars/person/photo.jpg?token=expired`, origin), 'person/photo.jpg');
  assertEquals(profilePhotoPath('https://other.example/storage/v1/object/public/avatars/photo.jpg', origin), null);
  assertEquals(profilePhotoPath(`${origin}/storage/v1/object/public/member-photos/photo.jpg`, origin), null);
  assertEquals(profilePhotoPath(null, origin), null);
});

Deno.test('portrait and landscape photos retain their proportions inside the PDF space', () => {
  assertEquals(photoDimensions(200, 400), { width: 32, height: 64 });
  assertEquals(photoDimensions(400, 200), { width: 64, height: 32 });
});