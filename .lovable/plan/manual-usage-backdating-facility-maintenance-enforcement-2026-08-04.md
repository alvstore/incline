# Manual Usage Backdating + Facility Maintenance Enforcement

## What the audit found

**1. Record Usage is always "now"**
`record_benefit_usage` hard-codes `CURRENT_DATE` when writing to `benefit_usage`, and the table has no time column at all (`id, membership_id, benefit_type, usage_date, usage_count, notes, recorded_by, created_at, benefit_type_id`). The drawer has no date or time field, so a session taken yesterday gets logged against today — which also charges the wrong daily/weekly/monthly allowance period.

**2. Maintenance is not enforced anywhere at booking time**
All four recovery facilities (Ice bath Male/Female, Sauna Therapy Male/Female) are flagged `under_maintenance = true`, yet they still have **324 active future slots** (72 + 72 + 90 + 90). `ensure_facility_slots` correctly skips maintenance facilities when generating new slots, but nothing deactivates slots already generated before the flag was set. `book_facility_slot` never reads `facilities.under_maintenance` — so member portal, concierge and backend booking all succeed. Slot listing queries (`getAvailableSlots`, All Bookings, Member booking, Concierge drawer, Member profile drawer) filter only on `benefit_slots.is_active`, so the slots keep showing up.

## The fix

### A. Backdated manual usage
- Add `usage_time time` (nullable) to `benefit_usage`.
- Extend `record_benefit_usage` with `p_usage_date date default current_date` and `p_usage_time time default null`:
  - Reject future dates and dates outside the membership's `start_date`–`end_date` window, with clear messages.
  - Compute the plan allowance period (daily/weekly/monthly/per-membership) relative to **the chosen date**, not today, so backdated entries consume the right period's quota.
  - Everything else (plan → gift → credit consumption, atomic decrements) stays exactly as it is today.
- `RecordBenefitUsageDrawer`: add a date picker (shadcn Popover + Calendar, `pointer-events-auto`, max = today, min = membership start) and an optional time input, defaulting to now. Pass both through `benefitService.recordBenefitUsageAtomic` and `useRecordBenefitUsage`.
- Usage history and the Benefit Tracking cards show date + time when a time is present.

### B. Facility maintenance enforcement
- **Hard block at the RPC**: `book_facility_slot` joins `facilities` and refuses when `under_maintenance = true` or `is_active = false`. Force-add by owner/admin/manager is still allowed but requires a non-empty `p_force_reason`, and the override is written to `audit_logs` and `booking_audit_log`.
- **Slot hygiene trigger**: on `facilities.under_maintenance` flipping to true, deactivate all future `benefit_slots` for that facility (`is_active = false`); on flipping back to false, re-activate future slots that have no cancellations and let `ensure_facility_slots` refill any gaps. Past slots are untouched.
- **Existing bookings are kept but flagged** (per your choice): confirmed future bookings stay in place; All Bookings, the Slot Detail drawer and the member portal show a "Facility under maintenance" warning badge so staff can decide per member. No auto-cancel, no auto-notification.
- **Listing consistency**: slot reads join facility state and exclude maintenance/inactive facilities, so the member portal and backend surfaces agree with the RPC instead of failing only at submit time.
- One-off cleanup: deactivate the 324 orphan future slots for the four facilities currently in maintenance.

## Technical notes

- Migration adds: `benefit_usage.usage_time`, updated `record_benefit_usage` (new optional params, backwards compatible with existing call sites), maintenance guard inside `book_facility_slot`, `tg_facility_maintenance_sync_slots` trigger, and the one-off slot cleanup.
- Files touched: `src/services/benefitService.ts`, `src/hooks/useBenefits.ts`, `src/components/benefits/RecordBenefitUsageDrawer.tsx`, `src/services/benefitBookingService.ts`, `src/pages/AllBookings.tsx`, `src/pages/MemberClassBooking.tsx`, `src/components/bookings/SlotDetailDrawer.tsx`, `src/components/bookings/SlotAvailabilityTimeline.tsx`, `src/components/bookings/ConciergeBookingDrawer.tsx`, `src/components/members/MemberProfileDrawer.tsx`.
- No changes to gift/credit ledger maths, so current balances and history stay intact.

## Verification

- Record a Sauna session for a past date within the membership: it saves, shows the chosen date/time, and deducts from that period's allowance; a future date is rejected.
- Member portal shows no bookable Ice Bath / Sauna slots while those facilities are in maintenance; the RPC also refuses if a stale slot id is replayed.
- Admin force-book with a reason succeeds and appears in the audit log; without a reason it is rejected.
- Existing future Ice Bath bookings still appear in All Bookings with a maintenance warning.
- Turning maintenance off restores the slots for those facilities.
