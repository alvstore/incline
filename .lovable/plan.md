# PT attendance, member drawer, and communication reliability

## Confirmed diagnosis

- All 10 active PT packages are monthly packages and correctly store `0` sessions because they are date-based. Two interfaces still print that raw value as “0 left”, so the wording is wrong rather than the package data.
- “Today’s Sessions” reads only pre-scheduled `pt_sessions`. The database has no PT rows today and only seven older rows, so the tab is blank even though active monthly clients exist.
- The existing PT attendance roster already models the required daily workflow: active clients are listed by trainer and staff can record Present, Late, Absent, or Holiday without pre-scheduling. However, staff are deliberately view-only in the UI and the server routine authorizes only owner/admin/manager/trainer, which conflicts with the requested front-desk workflow.
- The member profile drawer renders the list-row `member` object while its keyed detail queries load. That causes the visible default/stale-to-fresh swap. It also starts many secondary queries immediately instead of gating detail sections.
- The attendance dashboard duplicates the same navigation twice: a pill row above search and the authoritative tabs inside “Attendance Management”.
- Trainer photos exist for Bhagirath, Govind, Ritesh, and Harshwardhan. Revenue rows discard the avatar URL and the insights component renders initials only.
- Shubham Pandey’s profile has a real name. The active `diet_plan_document_v1` template requires three variables, while the plan sender supplies semantic variables that map cleanly to only the two standard plan slots; pre-flight therefore blocks slot 3. This is a template-contract mismatch, not missing member data.
- Attachment-free emails are reaching the managed email queue, but PDF emails are forced through the SMTP fallback and recent PDF sends timed out. Several non-attachment rows remain `sending`, so stuck-send lifecycle handling also needs verification.
- Owner-report WhatsApp entries are intentionally suppressed by the existing 24-hour Meta 131049 cooldown. They should not be bypassed; email should remain the reliable report channel while WhatsApp is unhealthy.

## Implementation plan

### 1. Make monthly PT date-based everywhere
- Replace “0 left” in both schedule selectors with “Valid until <date>” for monthly packages; retain remaining-session labels only for session packs.
- Treat the schedule drawer as optional appointment booking, not the attendance prerequisite. Clarify this in the UI and completion messages.
- Keep one attendance row per client/date through the existing atomic `log_pt_session` routine; do not pre-create a database row for every day through expiry. This gives the requested automatic daily roster without generating thousands of empty sessions.

### 2. Turn Personal Training into the operational attendance surface
- Replace the blank scheduled-only default with the existing trainer/client roster for the selected day, including all active monthly packages even when no appointment exists.
- Allow owner/admin/manager/staff/trainer to record PT attendance in the UI, while restricting trainers to their own clients and management/staff to their visible branch.
- Update the server authorization contract to permit branch-scoped staff, retain trainer ownership checks, date/package validation, duplicate-day protection, and member/trainer gym-attendance verification.
- Keep scheduled appointments as a secondary section and show an explicit empty state rather than a visually blank tab.
- Use IST date boundaries for roster/session queries and manual-date defaults.

### 3. Stabilize Member Profile Drawer loading
- Introduce a member-scoped profile query hook with exact query keys, a short stale window, cancellation when the selected member changes, and no previous-member placeholder data.
- Render a stable identity/header skeleton until the new member’s core record is available; never mix the incoming list row with another query state.
- Fetch core identity, membership/PT summary, and first-view financial summary in parallel; lazy-enable heavy tab queries only when that tab is opened.
- Preserve dimensions during loading so the header and KPI strip do not jump when fresh data arrives. Split the oversized drawer into focused tab components while retaining the right-side drawer pattern.

### 4. Remove duplicate attendance navigation
- Remove the upper pill navigation only.
- Keep the main tab list as the single source of navigation, and make the search control adapt to the selected tab.

### 5. Show trainer photos in revenue insights
- Carry `trainer_avatar_url` through the revenue aggregation and type.
- Render the existing profile photo in the top-performer and ranked-trainer rows, with initials as fallback.

### 6. Repair plan-message template and email contracts
- Make the plan sender build variables from the selected approved template’s declared slots, including explicit `full_name`/`recipient_name` aliases, and fail locally with the exact unresolved semantic field.
- Normalize the active diet document template to the canonical plan-document contract; avoid silently choosing another active template for the same trigger.
- Route PDF plan emails through a durable queue-compatible path: store the attachment reference and let the email worker fetch/attach it, instead of holding a synchronous SMTP invocation until it times out. Keep Hostinger as fallback, with bounded timeout and a new idempotency key per retry.
- Reconcile stale `sending` rows into terminal sent/failed states and ensure retries create a new attempt without duplicating successful sends.
- Keep the Meta pacing circuit breaker intact; when WhatsApp is suppressed, surface “Email delivered / WhatsApp paused by Meta” rather than presenting the whole multi-channel action as failed.

## Technical verification

- Database tests: monthly and session-based PT logging; staff branch isolation; trainer ownership; duplicate same-day attendance; missing member/trainer check-in; backdated seven-day limit.
- UI tests at mobile and desktop widths: monthly labels, populated daily roster with zero pre-scheduled sessions, role-based attendance controls, member-to-member drawer switching without stale flashes, one attendance tab bar, and trainer photos.
- Communication tests with non-customer test recipients: diet and workout document template component arrays; attachment email queue/fallback; timeout recovery; idempotent retry; and accurate partial-delivery status.
- Verify the latest build, runtime logs, relevant database rows, and delivery logs before marking complete.

## Scope boundary

This work will not generate automatic “Present” attendance without a human or verified MIPS event, and it will not bypass Meta’s healthy-engagement cooldown. Both would create inaccurate attendance or increase WhatsApp enforcement risk.