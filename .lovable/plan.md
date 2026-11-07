# Repair In-App audiences and scheduled alerts

## Confirmed issues
- In-App reduces detailed audience selections to broad presets. Pending dues, frozen and inactive segments become active members; staff-role and fitness-goal filters are lost.
- Scheduled In-App delivery saves only an announcement-board post. No current trigger or worker dispatches its bell, browser or Flutter alerts when due.
- Announcement read permissions are branch-wide, not recipient-specific. Fixing alerts alone would still expose targeted posts to other people in the branch.
- The shared campaign resolver also ignores fitness goals and legacy attendance-window filters in some paths. Reusing it unchanged would not fully fix audience matching.

## What will change
1. **Exact audience selection**
   - Pass the full audience filter instead of converting it into a preset.
   - Use one branch-authorized audience resolution contract for the In-App count and delivery, sharing member segment and staff-role rules with existing campaigns.
   - Preserve goals, legacy attendance filters and selected member/staff combinations; deduplicate by user account and exclude people without an app account.
   - Show resolution failures explicitly and block submission rather than substituting a broad or empty audience.
2. **Targeted announcement visibility**
   - Save recipient assignments for campaign-generated In-App posts and restrict member/staff reads to those assignments.
   - Keep authorized management access and existing general announcements working. Do not reconstruct audiences for old posts: their original detailed filters were never stored.
   - Preserve attachments and allow included staff/trainers to see members-and-staff notices.
3. **Scheduled delivery**
   - Store a durable In-App delivery job with its full filter, publication time and per-recipient delivery state.
   - Resolve and save recipients when the scheduled job becomes due; Send now uses the same delivery path immediately.
   - Dispatch through the existing communication dispatcher, so one notification continues to reach browser and Flutter devices through the existing web-push worker.
   - Track success/failure accurately; retry safely with stable announcement/user dedupe keys and atomic claims so concurrent or interrupted workers cannot duplicate alerts.
   - Prevent cancelled, inactive, expired or not-yet-due posts from starting delivery. Integrate with the existing Automation Brain rather than adding a separate polling system.
   - Existing scheduled board posts have no recoverable full audience: leave them unchanged, flag them as board-only, and require deliberate recreation to enable alerts. Never bulk-send historical notices.

## Technical approach
- Add additive schema fields/tables for full filters, recipient assignments and durable delivery state; include explicit grants, RLS, indexed due-work predicates and guarded application RPCs. Internal claim/worker helpers remain service-role-only.
- Replace campaign preset mapping in `CampaignWizard` and `inAppDelivery`; keep unrelated legacy preset callers compatible.
- Extend the shared member audience filtering where necessary without changing paid-channel providers, approval gates or existing campaign sender ownership of send state.
- Route the new delivery job through Automation Brain with an indexed pending-work gate covering due and stalled jobs. Publish the backend worker only after mock and authorization checks pass; publishing the website is separate.
- Preserve legacy announcement management permissions while adding recipient restrictions for new targeted posts; record structural rules in `AGENTS.md`.

## Verification
- Regression tests for pending dues, frozen, recently expired, inactive 30/60 days, goals, attendance windows, individual staff roles, combined audiences, duplicate accounts and branch authorization.
- Tests proving the preview and saved recipient set agree; untargeted users cannot read targeted board posts.
- Scheduling tests for future/due jobs, concurrent claims, repeated ticks, interrupted delivery, failed dispatches, cancellation and unchanged legacy board-only posts.
- Run focused existing campaign/dispatcher tests and review automatic build output.
- Signed-in browser checks for audience counts, error handling, schedule creation and board visibility; exercise complete delivery with mocked dispatcher/device providers only. Do not send real member alerts as a test.

## Scope and rollout
No changes to Firebase registration, browser device registration, paid SMS/WhatsApp/email providers or pricing. No live test broadcasts, historical notification backfills or website publishing. Both monitoring findings remain open until the approved implementation is verified.