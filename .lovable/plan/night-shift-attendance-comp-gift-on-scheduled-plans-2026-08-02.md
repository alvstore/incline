# Night-shift attendance + Comp/Gift on scheduled plans

## 1. Kunal's night shift is being split into wrong days

### What the audit found

Kunal Prajapat's roster is a genuine overnight shift on every weekday:

| Day | Shift |
|---|---|
| Mon–Sat | 21:00 → 06:00 (next day) |
| Sunday | 22:00 → 10:00 (next day) |

His actual attendance rows look like this:

| Check-in (IST) | Check-out (IST) | Marked as | Late by | Hours |
|---|---|---|---|---|
| 02 Aug 00:40 | 02 Aug 20:56 | morning 06:00 | — | 20.3 |
| 01 Aug 00:06 | 01 Aug 23:43 | evening 21:00 | 186 min | 23.6 |
| 31 Jul 00:04 | 01 Aug 17:00 | evening 21:00 | 184 min | 40.9 |
| 30 Jul 05:15 | 31 Jul 13:54 | evening 21:00 | 495 min | 32.6 |

Three defects combine:

- **Open shift is only looked for "today".** The gate handler searches for an unclosed attendance row from midnight onward. When Kunal punches out at 06:00–10:00 the next morning, his open row from 21:00 the previous evening is invisible, so the exit is recorded as a brand-new check-in instead of a check-out.
- **That phantom check-in is judged against the wrong shift.** A 00:40 punch is scored against the same day's 21:00 (or 06:00) start, which is where the 180–500 minute "late" figures and the false late notifications come from.
- **Overnight shifts are not recognised at all when the roster uses the evening block.** The shift resolver only treats a shift as overnight when it is stored as a single morning block whose end is before its start. Kunal's shift is stored in the evening block, so 21:00 → 06:00 is read as an ordinary same-day evening shift, and the small-hours punch is never attached back to the previous night.
- **Rows never close on time**, producing 20–40 hour totals, because auto-close only covers member attendance, not staff.

### Fix

- Teach the shift resolver that an evening block whose end time is earlier than its start is an overnight shift, and that a punch in the small hours belongs to the **previous** calendar day's block (checking that day's roster/override, not today's).
- Introduce a **shift date** (the date the shift started) on each staff attendance row, stamped on insert. All grids, late calculations and reports key off shift date instead of the raw check-in date, so Kunal's Sat-21:00-to-Sun-10:00 stint counts as one Saturday shift and Sunday no longer shows a phantom late entry.
- Widen the open-row lookup in the gate handler from "since midnight" to "any open row within the last 18 hours", so a morning exit closes the previous night's entry instead of opening a new one.
- Add staff auto-close: any staff row still open past its shift end plus a buffer is closed at the shift end and flagged, so totals stop drifting to 40 hours.
- Repair history: recompute the last 7 days for overnight staff — merge the split rows back into single shifts, clear the false late flags and the late notifications they raised.
- Late notifications skip punches that resolve to a continuing overnight shift.

## 2. Comp / Gift is dead for scheduled memberships

The Comp/Gift sheet is handed the **active** membership only. Mohit Parashar's plan is still `pending` (starts 04 Aug), so the sheet opens with no plan context — the "Current Plan / Expires" card is missing and **Apply Extension stays disabled** no matter what you type, which is exactly what your screenshot shows.

Fix: pass the same resolved current membership the rest of the profile now uses (active, frozen **or** pending), so:
- the plan card and "expires on → new expiry" preview render for scheduled plans,
- Apply Extension enables and calls the existing atomic grant function,
- the same applies to Comp Sessions on a scheduled plan.

Also tighten the form: block the accidental multi-thousand-day entry (the screenshot shows 2131 days) with a sane upper bound and inline validation, and require a reason before the button enables.

## Technical notes
- Migration: rewrite `resolve_staff_shift` for overnight evening blocks with previous-day lookback; add `shift_date` to `staff_attendance` stamped by `tg_stamp_staff_attendance_shift`; backfill `shift_date`; add `auto_close_stale_staff_attendance()` and register it in Automation Brain.
- `mips-webhook-receiver`: replace the `gte('check_in', todayStart)` open-row filter with an 18-hour lookback window.
- `reconcile-mips-pass-records`: reuse the same overnight attribution when rebuilding history.
- Frontend: `MemberProfileDrawer.tsx` passes `currentMembership?.id` to `CompGiftDrawer`; `CompGiftDrawer.tsx` gets validation on days/reason; attendance grids (`AttendanceDashboard.tsx`, `HRM.tsx`, `staffAttendanceService.ts`) group by `shift_date`.
