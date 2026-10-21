# Fix missing member photos on dashboards

## What's wrong (confirmed from live data)
The two screens pick a photo in opposite order, and some saved photo links have expired:

- **Today's Check-ins** (dashboard) uses the profile photo first, then the gate photo.
- **Live Access Feed / Access Presence** uses the gate photo first, then the profile photo.
- **55 members** have a gate photo saved as a temporary link. Those links expire after 1 hour, so the photo is broken in the Live Access Feed even though a good profile photo exists.
- **3 members** (for example Irfan Khan, INC-26-0009) have a profile photo that is also an expired temporary link, so they show initials on the dashboard too.
- All 216 members with photos still have the original gate photo in storage, so every photo can be recovered.

## Fix
1. **One shared photo picker** used by every attendance screen (Today's Check-ins, Live Access Feed, Access Presence, personnel sync list):
   - Use a permanent profile photo if one exists.
   - Never use an expired temporary link.
   - Otherwise get a fresh view link for the stored gate photo, in batches of up to 100 per screen load, cached for about 50 minutes.
   - Fall back to initials only when there is no photo at all.
2. **Repair the 3 broken profile photos** by copying each member's stored gate photo into the regular profile photos, so they show everywhere, including the member app.
3. **Stop new broken links**: when a gate photo is saved, store the photo's location only, never a temporary link.

## Check
- Open the dashboard and the Live Access Feed. The same members show the same photo on both, including Irfan Khan and Priyansh Motwani.
- Add a small test for the photo-picking order: permanent photo first, temporary links skipped, gate photo next, then initials.

## Technical details
- New `src/lib/media/personAvatar.ts`: `pickAvatar({ profileAvatar, biometricUrl, biometricPath })` plus a `useSignedBiometricBatch(paths)` hook (one `createSignedUrls` call on `member-photos`).
- `get_todays_checkins` RPC: also return `biometric_photo_path`, and stop sending `biometric_photo_url` when it contains `/object/sign/`.
- `src/lib/devices/accessSessions.ts`: carry `biometricPath`; the avatar order matches the shared picker.
- `TodaysCheckinsCard.tsx` and `LiveAccessLog.tsx` render through the shared picker.
- `uploadBiometricPhoto` callers persist the path, and write `biometric_photo_url = null` instead of a signed link (backfill: null out the 55 expired signed values).
- Test: `scripts/tests/personAvatar.test.ts`.
