# Exercise demos: owner-controlled, compact player, protected media

## What changes for people
- **Members:** no "Exercise demos" switch. They see demo pictures/videos only when an owner/admin turns it on for the branch. When off, members see exercise name, machine, sets/reps only (PT stays the way to learn form).
- **Owner/admin:** new switch in Settings (per branch): "Show exercise demos to members". Each change is audit-logged.
- **Managers/trainers:** always see demos while building or previewing plans, with auto-suggested exercise + video as they type (existing library search, made automatic). Their personal "show previews" switch stays in the plan preview only.
- **Player size:** replaces the full-width video with a compact card: small WebP thumbnail (~96px) in the exercise row; tapping opens an inline player capped at ~320px wide / 16:9 (full width only on phones, max ~220px tall), muted, looping, no download/picture-in-picture/remote buttons, plus a close button. Respects reduced-motion (no auto-loop).
- **Protection:** members can no longer read the media folder directly. Videos are handed out by a backend function only when the branch switch is on and the member owns the plan, via very short links (about 2 minutes). Right-click save, download button and PiP are disabled.

Honest limit: anything a browser plays can still be captured by a determined person (screen recording, network tab during the 2-minute window). This makes casual downloading and link-sharing impractical; it cannot make it impossible. Full DRM is not available for this setup.

## Technical details
- Setting: `settings` row `member_exercise_demos_enabled` (per `branch_id`, default false), edited via audited RPC `set_member_exercise_demos(branch, on)` guarded by owner/admin capability; read via `can_view_exercise_demos()` (member: branch flag; staff/trainer/manager/owner: true).
- Storage: drop member SELECT policy on `inclineexercisedb` (migration 0112); keep staff/trainer read. New edge fn `exercise-media-sign` (validate JWT, check role/flag + plan ownership, return signed URLs, TTL 120s, batched per day to avoid N calls).
- Frontend: `exerciseMedia.ts` — role-aware hook; members use the edge fn, staff keep direct signing; remove localStorage pref for members. Remove `ExercisePreviewToggle` from `WorkoutPlanViewer`; new `ExerciseDemosSettingsCard` in Settings (owner/admin via `can.X`). `DaySessionCard` compact player with `controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu=preventDefault`, `preload="none"`, poster-first.
- Trainer builder: `ManualWorkoutEditor`/`VideoAttachmentControl` auto-suggest (debounced 300ms) from library on exercise-name entry; machine name never changed.
- Analytics: `exercise_demo_played`, `member_exercise_demos_toggled` (owner), `exercise_video_suggested_accepted`.
- Performance: signed-URL calls only on tap; one batch call per day card; cached until expiry.
- Docs: update Flutter guide §15 (members call the sign function; no direct bucket read). Tests for role/flag visibility rule.
- Verify with Playwright: member view (flag off/on), mobile 375px player size, trainer builder suggestion.
