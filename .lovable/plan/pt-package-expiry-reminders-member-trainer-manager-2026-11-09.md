# PT package expiry reminders (member + trainer + manager)

## Audit findings
- **Settings → Notifications → Reminders** has only two cadences: Membership expiry and Payment dues. There is no PT setting.
- **The daily reminder job** sends PT *session* reminders ("PT session tomorrow") but **nothing when a PT package is about to end or run out of sessions**. The trainer and manager are never told.
- The cadence channels are WhatsApp, SMS, Email and In-app. **RCS is missing**, even though the message sender already supports it.
- The only hint today is the trainer's client rail. Nobody gets a message.

## What you will get
1. **New "PT package expiry" card under Reminders**, using the same design as the existing cards:
   - On/off switch, day chips (14 / 7 / 5 / 3 / 1 / on the day), primary channel plus fallback order.
   - A **"Low sessions" trigger** for session-based packages (default: 2 sessions left), so a package that runs out before its date is still caught.
   - **Audience toggles**: Member, Trainer, Branch manager. Each has its own channel list (In-app, Email, SMS, RCS, WhatsApp), because staff usually want in-app/email while members want WhatsApp/SMS.
   - A small preview line, e.g. "Rahul's Silver Package ends in 3 days, 4 sessions left".
2. **RCS added** as a selectable channel on all reminder cards (it falls back to SMS automatically when there is no approved template).
3. **Messages (utility, no pricing):**
   - Member: "Your PT package *{package}* with {trainer} ends on {date} ({n} sessions left). Speak to {trainer} or the front desk to continue." Opens My PT.
   - Trainer: "{member}'s PT package ends on {date} ({n} left). Please follow up." Opens the client in the PT workspace.
   - Manager: a single daily summary per branch, e.g. "5 PT packages end this week", linking to PT Clients → Expiring. This stops managers getting one message per client.
4. **No double nagging:**
   - Skipped when the member already has a next PT package (same rule as the fix just made on the Expired tab).
   - Skipped for blocked/inactive members (existing access policy).
   - Sent once per package per day-mark, and respects quiet hours and do-not-contact.
5. **Templates:** new events `pt_package_expiring` and `pt_package_low_sessions` appear in Communication Templates coverage, so WhatsApp/SMS (DLT)/RCS templates can be created there. Until an approved template exists, WhatsApp/RCS fall back down the chosen order and in-app always works.

## Technical details
- Reuse `reminder_configurations` with `reminder_type='pt_expiry'`. Add a nullable `settings jsonb` column (audiences, per-audience channels, low_sessions threshold) via an additive migration. Default stays off-safe: if no row exists, member + trainer get in-app only.
- `ReminderCadenceCard.tsx`: add the PT type, `rcs` channel and an audience sub-section, built with existing primitives (Switch, chips, 44px targets, labelled controls, live save status).
- `send-reminders`: new section 5b. Select `member_pt_packages` with status `active` where `expiry_date - today ∈ days_before` OR (`sessions_total>0` and `sessions_remaining <= threshold`). Exclude packages with a live successor. Resolve trainer user via `trainers.user_id` and managers via `branch_managers`. All sends go through `dispatchCommunication` with `category:'utility'`, `dedupe_key = pt_expiry:{pkg}:{audience}:{mark}:{date}`. Add `rcs` to VALID_CHANNELS.
- `systemEvents.ts`: add the two events with variables `member_name, package_name, trainer_name, expiry_date, sessions_left`.
- Tests: a Deno test for the selection/dedupe helper (expiring vs low-sessions vs has-successor).
- Verify with a dry run against live data (count only, no sends) before enabling.
