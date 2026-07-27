## Root cause audit

### Bug 1 — admin uploads land at the wrong storage path (avatar 404 / not visible)
`src/components/members/MemberAvatarUpload.tsx` builds the object name as:

```
filePath = `avatars/${userId || Date.now()}-${Date.now()}.jpg`
supabase.storage.from('avatars').upload(filePath, ...)
```

The bucket is already `avatars`, so the object name becomes `avatars/<uid>-<ts>.jpg`. The only INSERT policy on the `avatars` bucket is:

```
(bucket_id = 'avatars') AND (auth.uid()::text = storage.foldername(name)[1])
```

For that name, `foldername(name)[1] = 'avatars'`, never the uid — so uploads either fail RLS outright, or (for owners with elevated grants) land at `avatars/avatars/<uid>-<ts>.jpg`, which the returned `getPublicUrl` and every consumer expects at `<uid>/…`. Net effect matches the report: "uploading successfully but not visible."

The sibling component `src/components/auth/AvatarUpload.tsx` already uses the correct shape `${user.id}/avatar.${ext}` — that's why the owner's own header photo works but admin-uploaded member photos don't.

### Bug 2 — member has no upload UI on their dashboard
`src/pages/MemberProfile.tsx` renders a static `<Avatar>` at line 175 with no camera / file input. `AvatarUpload` (which does work) is only mounted on the staff-facing `/profile` route, not on the member portal. So a member literally has no control to upload from `/member/profile`.

Related contributing gaps (found while auditing, small):
- In `MemberAvatarUpload`, the `profiles.avatar_url` write is skipped whenever the member row has no linked `user_id` — the avatar is stored only on `members.biometric_photo_url`, which the member's `AuthContext.profile` never reads, so even a "successful" admin upload can't render in the member portal.
- Member-portal `AuthContext` already has realtime subscription on `profiles`, so once `profiles.avatar_url` is written, the member sees it live — no extra plumbing needed.

## Fix plan

### 1. `src/components/members/MemberAvatarUpload.tsx`
- Change the object path to match the `avatars` bucket RLS shape:
  - `const fileName = \`avatar-${Date.now()}.jpg\``
  - `const filePath = \`${userId}/${fileName}\``  (require `userId` — early-return with a toast if missing).
- Keep `upsert: true`. Continue calling `getPublicUrl(filePath)` — it will now return the real object URL.
- Cache-bust the returned URL (`?v=${Date.now()}`) before calling `onAvatarChange` and before the `profiles.update`, so `<AvatarImage>` reloads immediately.
- Leave the private `member-photos` biometric upload (`uploadBiometricPhoto`) and MIPS queue as-is — that path is already correct.

### 2. Member self-serve upload on `/member/profile`
- In `src/pages/MemberProfile.tsx`, replace the static `<Avatar>` block (lines 174–180) with the existing `<AvatarUpload />` component when `profile?.id` matches the signed-in user. Fall back to the static avatar for view-only cases.
- No new component needed — `src/components/auth/AvatarUpload.tsx` already writes to `avatars/<uid>/avatar.<ext>` and updates `profiles.avatar_url`, both of which satisfy the RLS policies checked above (`Users can upload their own avatar`, `Users can update their own avatar`).

### 3. Ensure admin uploads reach the member's profile
- In `MemberAvatarUpload`, if `userId` is missing but `memberId` is present, look up `members.user_id` before uploading; if still null, surface a toast telling the operator to provision a login first (using the existing `provision-member-login` edge function). This prevents the silent "uploaded but member can't see it" case.
- No schema changes; no new policies.

### 4. Verification steps (done post-implementation)
- As an admin, upload a photo from the member drawer → confirm `profiles.avatar_url` for that user contains `avatars/<uid>/avatar-*.jpg`, image opens in a new tab, and it appears in `/members` and in the drawer header.
- Sign in as that member → `/member/profile` shows the same photo immediately; clicking the camera on the member's own avatar uploads a new photo and it becomes visible without reload.
- Confirm biometric flow untouched: `members.biometric_photo_path` still populates and `sync-to-mips` fires (queue row + trigger).

## Files touched
- `src/components/members/MemberAvatarUpload.tsx` — fix upload path, tighten guards, cache-bust.
- `src/pages/MemberProfile.tsx` — mount `AvatarUpload` for the signed-in member.

No migrations, no bucket/policy changes.