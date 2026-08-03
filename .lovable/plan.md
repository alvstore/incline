# Terms Backfill, Duplicate Payment Fix, Attendance Accuracy

## 1. Silent terms backfill (no member prompt)

Stamp every existing signature record with the terms version that was in force when it was signed, so nobody is re-prompted:

- Set `terms_version = 'legacy-pre-24x7'` on all existing `member_onboarding_signatures` rows where it is null.
- New signatures continue to record the current `TERMS_VERSION` automatically.
- No banner, no re-acknowledgement flow. Reporting can later filter members still on the legacy version.

## 2. Duplicate payment on INV-INC-26-0034 (Tejas Latta)

Confirmed from the data — the invoice total is Rs 30,000 but `amount_paid` is Rs 60,000 because two completed payments exist:

```text
15:29:39  Rs 30,000  card  source=manual   note "RAZOR PAYMENT DONE"   (staff entry)
15:30:04  Rs 30,000  card  source=gateway  pay_TIZnfIftcLHeK2          (auto-reconciled)
```

Root cause: a staff member manually recorded the Razorpay payment 25 seconds before the Razorpay reconciler imported the same transaction. The reconciler only de-duplicates on `transaction_id`, and the manual row has no `transaction_id`, so it created a second payment. This is the only over-paid invoice in the database.

Fix:
- Void the manual duplicate (keep the gateway row with the real `pay_` id), recompute `amount_paid` to Rs 30,000, keep status `paid`, and write an audit-log entry with the reason.
- Harden `reconcile-razorpay-links`: before inserting, look for an existing completed payment on the same invoice with the same amount within a 24-hour window and no `transaction_id` — if found, attach the gateway id, fee and source to that row instead of inserting a new one.
- Add a DB guard so recording a payment that would push `amount_paid` above the invoice total is rejected unless explicitly flagged as an advance, preventing future silent overpayments.

## 3. Staff attendance is under-counting (payroll risk)

Audit of the punch stream shows the problem is upstream of the attendance UI:

- Raw device punches land in `access_logs`. On 2 Aug, 57 of 124 punches had no member and no staff identity attached; on 3 Aug, 75 of 136. Unresolved punches never become `staff_attendance` rows, so the person shows as absent.
- The unresolved punches for 2 Aug include **Puneet Meghwal (MIPS personId 99, 10 punches)** plus several people never mapped at all: KAJAL (137), ROHIT (137), Rajat (133), Yogita (134), KULDEEP SALVI, Lakshay Salvi, and 16 punches with id `-1`.
- `mips_person_aliases` currently holds exactly one row, keyed by `person_code`. The device webhook sends a numeric `personId`/`personSn` and a display name — so code-based aliasing does not catch these.
- 2 Aug also received far fewer punches overall (124 vs 467 on 1 Aug), so some staff (Harshwardhan, Govind) have no punch record at all for that day — a delivery gap on the MIPS side that needs a pull-based backfill, not just better matching.
- `compute_payroll` reads `staff_attendance.check_in::date` in UTC and reads shift columns that no longer match the roster schema, so night-shift punches and roster-aware statuses can be mis-bucketed.

Fix, in order:

1. **Identity mapping** — extend `mips_person_aliases` to also key on numeric `person_id` and normalised person name, and make both the webhook receiver and the reconciler resolve by code, then id, then name before giving up. Seed aliases for Puneet (99) and the other unmapped persons above after confirming who they are.
2. **Unresolved punch queue** — surface unresolved punches in Device Command Center with a one-click "map to person" action, so a new unmapped device enrolment is visible the same day instead of turning into missing attendance.
3. **Backfill** — re-run `reconcile-mips-pass-records` for 1-3 Aug in pull mode after the alias fix, so missing punches are fetched from the MIPS server and converted into `staff_attendance` with correct IST day bucketing and duplicate suppression.
4. **Manual override for payroll** — add a staff-side day editor (Sheet) on the Attendance page so a manager can mark a day as Present / Holiday / Leave / Weekly-off with a reason and an audit trail. This is what makes Lokendra's holiday explicit instead of an unexplained absence.
5. **History card correctness** — the card currently shows "Present N / Total Days 31", counting every calendar day of the month including future days. Change it to count days elapsed and break the month into Present, Late, Weekly-off, Holiday, Leave and Absent, using the roster and `holidays` / `leave_requests` — the same buckets payroll uses.
6. **Payroll alignment** — fix `compute_payroll` to bucket attendance by IST date and read the current roster resolver (`resolve_staff_shift`) rather than the stale shift columns, so salary days match what the attendance page displays.

## Technical notes

- Files touched: `supabase/functions/reconcile-razorpay-links/index.ts`, `supabase/functions/mips-webhook-receiver/index.ts`, `supabase/functions/reconcile-mips-pass-records/index.ts`, `src/pages/AttendanceDashboard.tsx`, a new staff-day override Sheet component, plus migrations for `mips_person_aliases`, the payment overpay guard, `compute_payroll`, and the two data corrections.
- Both data corrections (payment void, terms stamp) run as migrations with audit entries, so they are reversible and traceable.
