# Welcome messages + automatic face enrolment for new members

Kriti Sharma (INC-26-0074) registered at 13:51 UTC today. Two things did not happen. I checked both against live data.

## What the data shows

**1. No welcome message was ever sent — for anyone**
Her communication history has only the OTP email, plus the invoice receipt (email + WhatsApp) that staff triggered. There is no welcome record at all. Widening the search: zero welcome records exist in the entire history of the system, so this has never worked, not just for her. The self-registration function does fire welcome messages for WhatsApp, SMS and Email, but it does so as a "background task" after the reply has already been sent to the browser, and no trace of those calls reaches the message log or the error log. Exact cause is not yet proven (the background work is likely being dropped when the function shuts down), so verification is step one.

**2. She has no face photo in the biometric pipeline**
Her member record has an empty biometric photo path and no device person ID, and there is no entry in the face sync queue for her. Her profile picture was uploaded ~3 minutes after registration and landed only in the public avatar bucket.

The reason: there are two different photo upload paths in the app.
- The good path (member photo widget, staff profile widget) writes the public avatar **and** a private biometric copy, sets the member's biometric photo path, and adds a face sync queue entry. A database trigger then pushes it to the MIPS server and gates.
- The broken path (Edit Profile drawer) uploads only the public avatar. Nothing downstream fires — no biometric copy, no queue entry, no trigger, no gate enrolment.

Self-registration itself never captures a face photo at all, so a self-registered member is invisible to the gates until a staff member uploads one through the correct widget.

## The fix

### A. Welcome messages that actually go out
1. Verify first: call the message dispatcher directly for her welcome event and read the function logs, to confirm whether the dispatcher rejects the call or the background task was dropped.
2. Make welcome delivery durable rather than fire-and-forget: instead of invoking the dispatcher after the response, write the welcome sends into the existing communication queue as part of the registration transaction, so the scheduled worker delivers and logs them with normal retry behaviour.
3. Welcome content stays on all three channels and carries: member name, member code, branch, portal login link, and clear first-login instructions (set your password via the reset link).
4. Confirm a welcome template exists for the new-member event on WhatsApp/SMS/Email; if missing, add one so WhatsApp is not suppressed outside the 24-hour window.
5. Send Kriti's welcome now, once the path is proven.

### B. One photo path, always synced to MIPS
1. Rewrite the Edit Profile drawer's avatar upload to use the shared upload-and-sync helper (auto-correction, public avatar, private biometric copy, member biometric path, face sync queue, re-queue of any rejected enrolment). No component uploads to the avatar bucket on its own after this.
2. Add a self-healing sweep: any active member/staff/trainer that has a profile picture but no biometric photo path gets the copy made and a queue entry created automatically, so past gaps close without manual work. Run it on the existing automation schedule.
3. Add a face photo step to self-registration (camera or upload) so a self-registered member is gate-ready on day one. This can be optional-but-prompted if you prefer registration to stay short.
4. Backfill Kriti immediately: copy her existing photo into the biometric bucket, set her biometric path, queue the sync, and confirm enrolment on both gates.

## Technical notes
- Welcome sends move from `EdgeRuntime.waitUntil` invocations in `register-member` to rows in the existing communication queue, keeping `dispatch-communication` as the single send path (dedupe keys unchanged).
- `EditProfileDrawer.handleAvatarUpload` is replaced by `uploadAndSyncPersonPhoto` from `src/lib/media/syncPersonPhoto.ts`.
- The sweep runs as a rule under the existing automation brain tick, reusing `uploadBiometricPhoto` server-side and the `trg_push_photo_to_mips_*` triggers already on `members`, `employees`, `trainers`.
