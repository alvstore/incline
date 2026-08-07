# Facility Schedule Enforcement, Attendance Marking, and Three System-Health Clusters

## 1. Facilities must respect their Weekly Schedule

What I found in the live data:

- `Ice bath Male` is configured for `{mon, wed, fri}` — but `benefit_slots` currently holds 12 slots on Thu 06 Aug and 12 on Sat 08 Aug for that facility.
- The slot generator (`ensure_facility_slots`) *does* check `available_days`. The stale slots were generated before the weekly schedule was narrowed, and nothing ever removed them.
- `book_facility_slot` never checks the day of week, so those orphan slots book successfully.

Fix, three layers:

- **Data cleanup**: deactivate future `benefit_slots` whose weekday is not in their facility's `available_days` and that have no live bookings. Slots that do have bookings are flagged, not silently dropped, so you can reschedule them.
- **Server guard**: `book_facility_slot` rejects any slot whose weekday falls outside the facility's `available_days` (privileged force-add can still override, with a reason — same pattern as the maintenance override).
- **Schedule edits self-heal**: a trigger on `facilities` prunes future off-schedule slots whenever `available_days` changes, so this can't drift again.
- **UI**: the Concierge drawer and the date pickers grey out and label non-scheduled days ("Ice bath Male runs Mon / Wed / Fri") instead of offering bookable times.

## 2. Mark attendance for a booking

`benefit_bookings` already has `check_in_at` and a `no_show_marked_at`, but no UI writes them. Add to the slot detail drawer and the preparation queue on All Bookings:

- **Mark attended** / **Mark no-show** / **Undo** per attendee, recording who marked it and when.
- The "Attended" KPI on All Bookings then counts real check-ins instead of always showing 0.
- Marking is done through a small RPC so the benefit ledger and no-show release trigger stay consistent.

## 3. System Health clusters

**Clusters 1 and 2 share one root cause.** Both are `mips_reconcile_pass_records` failing on the network hop to the MIPS box (`connection closed before message completed`, `error reading a body from connection`). `reconcile-mips-pass-records` calls `fetch` directly with no timeout and no retry, then returns HTTP 500, which the Automation Brain records as a rule failure. The MIPS server being briefly unreachable is an outage, not a bug in this rule.

- File: `supabase/functions/reconcile-mips-pass-records/index.ts`
- Fix: route the login and record calls through the existing `_shared/mipsHealth.ts` helpers (`mipsFetch` with a hard timeout, `classifyFailure`, the shared circuit breaker). On a transport failure, retry once, then return `200 { skipped: "mips_unreachable" }` and record the breaker state instead of a 500. Genuine data errors still fail loudly.

**Cluster 3 — `register-member` non-2xx.** The contract is mismatched, not flaky. `register-member` invokes `notify-staff-handoff` with `{ kind, member_id, branch_id, full_name, phone }`, but that function requires `member_phone` and returns 400 without it. Every self-registration logs this error while the registration itself succeeds.

- Files: `supabase/functions/register-member/index.ts` (send `member_phone` and `reason`), and `supabase/functions/notify-staff-handoff/index.ts` (accept `phone` as an alias so older callers don't break).

## 4. Faster OTP on /register

`register-member` is a single ~740-line function that imports `pdf-lib` and the whole onboarding-PDF builder at module load. That module graph is parsed on every cold start — including when all you want is to send a 6-digit code.

- Split the OTP path into a new lean `send-registration-otp` function: rate limit, hash, insert, dispatch. No PDF imports, no auth-admin work.
- `/register` calls the new function for send/resend; `register-member` keeps `verify_and_register` and continues to accept `send_otp` so nothing breaks mid-rollout.
- Also fire the WhatsApp dispatch without awaiting the email dispatch, so the code lands on the phone as fast as the provider allows.

## Technical notes

- Migration: prune off-schedule future slots, add the weekday guard inside `book_facility_slot`, add the `facilities.available_days` prune trigger, add `mark_benefit_booking_attendance(booking_id, state, staff_id)` RPC.
- UI: `src/components/bookings/ConciergeBookingDrawer.tsx`, `SlotAvailabilityTimeline.tsx`, `SlotDetailDrawer.tsx`, `AllBookings.tsx`.
- Weekday keys are the three-letter lowercase abbreviations already stored (`mon`…`sun`), evaluated in IST to match slot dates.
