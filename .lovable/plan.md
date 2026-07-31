## What I verified (not guesses)

- **Love kumar paliwal (INC-26-0004)**: `biometric_photo_path` is **NULL** — only a public `avatars/...` URL exists. The 14:20 sync log says: `Photo upload: ✗ Photo too large: 448KB (max 400KB)` → the person record was created/updated in MIPS (personId 132), but **no face image** was pushed.
- **Akansha budhraj (INC-26-0038)**: has a proper `biometric/members/....jpg` path and personId 140, so she reached the MIPS *employee* list too.
- **Queue rows for both are `status = succeeded`** even though the photo never uploaded — the sync reports success when only the person record lands.
- **`process-biometric-sync-queue` calls `sync-to-mips` with `server_only: true`**, and `sync-to-mips` then does: `dispatchResult = { skipped: true, reason: "server_only_sync — cron will dispatch" }`. The cron that was supposed to dispatch (`mips_personnel_delta_sync`) is **`is_active = false` and has never run** (`last_run_at` NULL). So nothing ever pushes the person to Gate 1 / Gate 2 — exactly the symptom: present in MIPS employees, absent on devices.
- Upload paths differ: `MemberAvatarUpload` / `StaffBiometricsTab` / `PersonnelSyncTab` write a compressed biometric path, but plain profile-avatar uploads (`AvatarUpload.tsx`, `Profile.tsx`, `EditProfileDrawer`, `StaffAvatarUpload`) upload the **raw file to `avatars/`** with no compression and no `biometric_photo_path` — those are the ones that end up 448KB and get rejected.

## Fix plan

### 1. Stop the silent "server_only" dead end (root cause of "not on devices")
- In `process-biometric-sync-queue`, drop `server_only: true` so every drained row performs a real `dispatchToDevices` to all active devices of the person's branch.
- In `sync-to-mips`, treat "person upserted but dispatch skipped/zero devices" as **not fully successful**: return `dispatched_device_ids` and `photo_uploaded` in the response.
- Queue drainer marks a row `succeeded` only when the person upsert **and** photo upload **and** at least one device dispatch succeeded; otherwise it stays `pending` with a readable `error_message` so the Personnel Sync tab shows real drift.

### 2. Server-side photo normalisation (root cause of "photo too large")
- In `sync-to-mips`, before pushing the face image: if the resolved image is over ~380KB, re-encode it server-side (downscale to max 640×640, iterative JPEG quality) instead of aborting. No upload should ever fail purely on size again.
- When the source was an avatar (not a biometric path), also persist the normalised image to `member-photos` at `biometric/{members|employees|trainers}/{id}.jpg` and backfill `biometric_photo_path`, so future syncs use the private high-quality path.

### 3. Make *every* photo upload auto-queue (no manual trigger anywhere)
- Add a shared client helper used by all avatar uploaders: compress → upload avatar → upload biometric copy → write `biometric_photo_path` → enqueue sync.
- Wire it into `AvatarUpload.tsx`, `Profile.tsx`, `StaffAvatarUpload.tsx` and `EditEmployeeDrawer` (member/trainer/employee/admin/owner paths), matching what `MemberAvatarUpload` already does.
- Keep the DB trigger `tg_push_photo_to_mips` as the safety net for any server-side photo change.

### 4. Cron & backfill
- Keep `process_biometric_sync_queue` at every 5 min (already active and healthy) as the single dispatcher; leave the dormant `mips_personnel_delta_sync` rule removed/disabled so there is one owner of dispatch.
- One-off backfill: re-enqueue Love kumar paliwal and Akansha budhraj (and any member/staff whose `mips_person_id` exists but has no successful device dispatch), then verify on-device presence via the existing `mips-face-parity` check.

### 5. Verification
- Curl `sync-to-mips` for both people and confirm the response reports `photo_uploaded: true` and non-empty `dispatched_device_ids` for Gate 1 and Gate 2.
- Re-run `mips-face-parity` and confirm both gates report the same face count.

## Technical notes
Files touched: `supabase/functions/sync-to-mips/index.ts`, `supabase/functions/process-biometric-sync-queue/index.ts`, `src/utils/imageCompression.ts` (reuse), a new `src/lib/media/syncPersonPhoto.ts`, plus the four upload components above. One small migration only if the backfill/enqueue is done in SQL.
