# System Health cluster audit + four operational fixes

Six error clusters, four real root causes. Two clusters (2 and 3) are one bug. Two clusters (4 and 5) are one symptom.

---

## 1. The password loop (clusters 2 + 3) — one bug

**What happens today:** a new member signs in with the temporary password, is sent to "Set password", types a password, and lands right back on the same screen — forever.

**Confirmed cause:** two safety rules were added to the accounts table and they contradict each other.
`complete_password_setup()` sets a one-shot flag (`app.password_setup`) that the first guard understands, but the *second* guard, `tg_profiles_block_privileged_self_update`, doesn't know about that flag and hard-rejects any change to `must_set_password` by a non-owner. So the "I'm done setting my password" write always fails with *Not allowed to modify protected account fields* (cluster 3), the flag never clears, and the member is bounced back to the screen (the loop). Cluster 2 is the same journey: the member re-enters the temp password, the auth service refuses it with a raw 422 *New password should be different from the old password*, and the screen shows a scary error instead of plain guidance.

**Fix**
- Database: teach `tg_profiles_block_privileged_self_update` the same exemption the other guard has — allow `must_set_password` to go from true to false on your own row when `app.password_setup` is set. Everything else stays blocked.
- `src/components/auth/SetPasswordForm.tsx`: catch the "same as old password" case and show *"Please choose a password different from the one we sent you"* instead of the raw server text; keep the member on the form with the field focused.
- `src/contexts/AuthContext.tsx`: after `complete_password_setup` succeeds, refresh the profile in place so the redirect happens immediately; if the call fails, surface it instead of silently returning to the form.

---

## 2. Face photo rejected during registration (cluster 6)

**Confirmed cause:** when a new member uploads their photo at `/register`, the app updates their profile picture. A database trigger (`mirror_profile_avatar_to_member`) copies that picture onto the member record's face-photo column, which trips the staff-only guard `tg_guard_biometric_photo_write` → *Face photos can only be set by gym staff* → the whole profile update fails with a 400.

**Fix (also delivers the "first-time face capture at /register" requirement)**
- Database: allow exactly one self-service face write — the member's own row, when no face photo exists yet, and only while `hardware_access_enabled` has never been granted a photo. Every later change stays staff-only. Add a `face_photo_source` stamp (`self_registration` / `staff`) so the desk can see which is which.
- Make the mirror trigger set a local marker so the guard recognises trigger-originated copies rather than treating them as a member edit.
- `src/pages/PublicRegistration.tsx` + `src/lib/media/preparePersonPhoto.ts`: strengthen capture quality before upload — live camera capture preferred over gallery, front-facing single face, minimum resolution and file size, brightness and blur checks, centred square crop, and a "retake" loop with plain-language reasons ("too dark", "face too small", "more than one face"). Only a passing photo is accepted as gate-quality; anything else is saved as a display picture with a note to visit reception.

---

## 3. MIPS terminals still rebooting — exact bug found

**Evidence (from this project's own sync ledger, last 8 hours, one member as the example):** the same person's face photo was uploaded to the MIPS server *every hour at :30* — 12:31, 13:30, 13:31, 14:30, 14:30, 15:30, 15:30, 16:30, 16:30, 17:30, 17:30, 18:30 — and almost every gate hand-off in that list is marked **failed**. Across all people that is 77 photo uploads and 45 failed gate hand-offs in six hours. Each upload writes a brand-new photo file on the server and re-saves the person, which forces both terminals to re-download and rebuild that face template. That constant rebuild is what reboots the Android units.

**The exact loop:**
1. `sync-to-mips` uploads the photo unconditionally on every run — there is no check for "this exact photo is already on the server".
2. When the gate hand-off fails (mostly `dispatch slot busy after retries`, i.e. the new per-gate throttle rejecting itself), the person is stamped `mips_sync_status = 'failed'`.
3. The hourly `mips_personnel_delta_sync` rule selects exactly the people stamped `failed` and re-drives the **entire** sync — person save **plus a fresh photo upload** — even though the photo was already on the server.
4. Go to 1. The loop only ends when a hand-off happens to succeed (18:30 in the trace above).

**Fix**
- `supabase/functions/sync-to-mips/index.ts`: record a photo fingerprint (hash + uploaded-at) per person per server; skip the upload entirely when the fingerprint is unchanged, unless `force` is passed. Photo bytes go to the terminals only when the photo actually changed.
- Stop conflating the stages: a failed gate hand-off must **not** set `mips_sync_status = 'failed'` (the person and photo landed fine). Track hand-off state separately so the hourly delta only re-drives people whose *person record* failed.
- `supabase/functions/_shared/mipsDispatch.ts`: make `waitForDispatchSlot` queue instead of giving up — a busy gate should wait its turn, not fail and trigger a re-sync next hour.
- Add a hard per-person ceiling: at most one photo push per person per 24 h unless forced, enforced in the shared helper so every caller inherits it.
- Migration: add `mips_photo_hash`, `mips_photo_synced_at`, `mips_dispatch_status` to `members`, `employees`, `trainers`.

---

## 4. Voice AI has no controls (`/voice-ai`)

Today the queue tab is read-only by design and there is no way to retry a skipped or failed call, pause the automation, or see why someone was skipped.

**Fix — `src/pages/VoiceAI.tsx`, new `src/components/voice/QueueControlsBar.tsx`, `src/hooks/useVoiceOps.ts`**
- Automation switch in the header: **Running / Paused**, with the pause reason and who paused it. Backed by a settings flag the `auto_tick` worker checks first.
- Queue rows gain a **Why skipped** column (cooldown, do-not-contact, outside calling window, daily cap reached, unknown last visit) and a per-row **Retry now** action that re-queues one member for the next tick.
- A **Retry all failed** action, scoped to today, with a confirmation dialog and a cap so it can never blow the daily budget.
- A **Failed / skipped** tab listing today's non-connected attempts with disposition, attempt count and next eligible time.
- Server side: `voice_requeue_member(member_id)` and `voice_requeue_failed(branch, date)` RPCs plus a pause flag honoured by `sarvam-voice` `auto_tick`. All owner/admin/manager only.

---

## 5. Database timeouts (clusters 4 + 5) — one symptom, not two bugs

Both timeouts landed within one second of each other (18:03:02 and 18:03:03) on tables that are tiny — 2,332 message rows and 166 accounts. Nothing about those queries is slow on that data volume, so the database was momentarily saturated, and the MIPS re-upload loop above is running the heaviest work at exactly those times.

**Fix**
- Fixing item 3 removes the load source; verify afterwards that the timeouts stop.
- Independently, make the two calls cheap and resilient: replace the `not.ilike` filters on the announcements feed with an indexed condition, add a covering index for that feed, and give the registration profile lookup a retry with a short timeout instead of surfacing a raw database error.

---

## 6. "Invalid time value" on the members screen (cluster 1)

A date field that can legitimately be empty (invoice due date is the most likely one) is passed straight into `format(new Date(...))`, which throws and blanks the panel.

**Fix**
- Add `src/lib/utils/safeDate.ts` with a `fmtDate(value, pattern, fallback = '—')` helper that returns the fallback for null, empty and unparseable values.
- Replace the unguarded `format(new Date(...))` / `format(parseISO(...))` calls across the member drawers (`InvoiceDetailDrawer`, `CancelMembershipDrawer`, `TransferMembershipDrawer`, `UnfreezeMembershipDrawer`, `CompGiftDrawer`, `RewardsWalletCard`, `MeasurementMetricsTab`, `UpgradeMembershipDrawer`) with that helper.

---

## Technical notes

- Guard functions to amend: `tg_profiles_block_privileged_self_update`, `tg_guard_biometric_photo_write`, `mirror_profile_avatar_to_member`.
- New RPCs: `voice_requeue_member`, `voice_requeue_failed`; new settings key `voice_automation_paused`.
- Edge functions to redeploy: `sync-to-mips`, `sarvam-voice`, plus anything importing `_shared/mipsDispatch.ts` (`mips-access`, `mips-face-parity`).
- No change to the full-roster path — it stays manual, confirmation-gated and capped at once per gate per 24 h.
- Verification after deploy: the sync ledger should show at most one photo upload per person per day and near-zero `dispatch slot busy` failures; the MIPS operation log should show no bursts on the old bulk endpoint.
