# All Bookings: prep-window visibility, reschedule with approvals, redesign, and two bugs

## 1. See upcoming bookings, not just one date

Today every query on `/all-bookings` is pinned to a single `dateFilter`, so Rehan's 7 Aug ice bath is invisible until you switch the date. Cold plunge needs a 6–9 hour prep lead time, so the desk must see what is coming before it lands.

Changes:
- Replace the single date input with a **range selector**: Today · Next 3 days · Next 7 days · Custom range. Default to **Next 7 days**.
- Widen all three queries (classes, benefits, PT) to `gte(start) / lte(end)` instead of `eq(date)`, and group results by day with sticky day headers.
- Add a **Prep Queue** panel at the top: any facility booking whose slot needs advance preparation, sorted by "prep start time" = slot start minus that facility's lead time. Each row shows member, facility, slot time, prep-start time, and a countdown ("start chiller in 2h 15m").
- Store the lead time per facility (new `prep_lead_minutes` column on `facilities`, default 0; ice bath set to 480). Only facilities with a non-zero lead time appear in the Prep Queue.
- KPI cards become range-aware: Upcoming, Needs prep now, Confirmed, Attended, No-shows.

## 2. Reschedule with maker-checker approval

There is no reschedule path today — a failed session (equipment down, power cut, staff absence) leaves the booking to expire as `no_show` and the credit stays consumed.

Backend:
- New enum value `booking_reschedule` on `approval_type`.
- New RPC `request_booking_reschedule(booking_id, new_slot_id, reason, blame)` — staff call it; it validates the new slot has capacity and is not under maintenance, then writes an `approval_requests` row scoped to the booking's branch. No credit movement yet.
- New RPC `decide_booking_reschedule(request_id, approve, notes)` — restricted to owner/admin and the branch's manager. On approve it atomically moves the booking to the new slot, keeps the same consumed credit (no double deduction), releases the old slot count, logs to `booking_audit_log`, and fires a `facility_rescheduled` notification through the dispatcher. On reject it leaves the booking untouched.
- When the reason is "gym fault" (equipment/power/staff), approval also **restores the credit** if the member chooses not to rebook — handled by a `cancel_with_credit_restore` branch inside the same RPC.
- Both RPCs are `SECURITY DEFINER`, pinned `search_path`, with capability checks; `GRANT EXECUTE` to `authenticated`.

Frontend:
- `RescheduleBookingDrawer.tsx` (right-side Sheet): shows current booking, a reason selector (Equipment failure · Power outage · Staff unavailable · Facility maintenance · Member request), a fault attribution toggle (Gym fault / Member fault), and a slot picker for the new date/time with live capacity.
- Staff see "Reschedule (needs approval)"; owner/admin/manager see "Reschedule now" which submits and auto-approves in one call, still writing the audit trail.
- Pending reschedules surface as an amber badge on the booking row and in the existing approvals surface for the branch.

## 3. Page redesign

Applying the ui-ux-pro-max pass within the existing Vuexy tokens (indigo/violet, `rounded-2xl`, soft slate shadows — no new palette):
- Header row: title, range selector, view switcher (List · Prep Queue · Timeline · Calendar), Export/Print, New Booking.
- Prep Queue as a dedicated first-class view and a condensed strip in List view.
- List view grouped by day → then by type, with denser rows, member avatar + code, source badge, and a right-aligned action cluster (Check in · Reschedule · Cancel).
- Timeline view keeps `SlotAvailabilityTimeline` but gains a day strip so you can scan 7 days without leaving the page.
- Calendar day cells split counts by type instead of one lump "54 bookings", and clicking a day sets the range to that day.
- Proper skeletons, empty states, and error fallbacks for each view; all icon buttons get `aria-label`s.

## 4. Two bugs

**`COALESCE types benefit_type and text cannot be matched`** — in `ensure_facility_slots`, `v_safe_bt` is built as
`COALESCE(NULLIF(safe_benefit_enum(bt_code), 'other'), NULLIF(settings.benefit_type::TEXT, 'other'), 'other')`.
`safe_benefit_enum` returns `benefit_type`, the other branches are `text`, so Postgres refuses the COALESCE. Fix: cast the first branch to `TEXT` (`safe_benefit_enum(...)::TEXT`) so all three arms are text, keeping the existing `::benefit_type` cast at insert time. This is what makes the timeline 400 on `/all-bookings`.

**`/fitness/create/manual` — "Load failed"** — `App.tsx` uses plain `React.lazy` for all 78 routes; the project already ships `lazyWithRetry` (which specifically handles Safari's opaque "Load failed" stale-chunk error) but no route uses it. Fix: swap `lazy(` for `lazyWithRetry(` across the route definitions in `App.tsx` so a stale deploy chunk retries once and then cache-busts instead of crashing the route.

## Verification

- Book an ice bath for a future date and confirm it appears in the default 7-day range and in the Prep Queue with the correct prep-start countdown.
- Reschedule as staff → request lands in approvals for that branch only; approve as owner → booking moves, old slot frees, no second credit is consumed, member gets a WhatsApp/email notification.
- Reject a request → booking unchanged.
- Load `/all-bookings` timeline and confirm `ensure_facility_slots` returns 200.
- Hard-reload `/fitness/create/manual` and confirm it renders.
