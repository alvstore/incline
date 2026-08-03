# Registration health data + PT sales workflow fix

## 1. Health conditions missing from the printed form

Confirmed cause: on `/register`, health chips are merged into the payload only inside `submitDetails` (`PublicRegistration.tsx:235`). When a member refreshes and the draft is restored straight to the Health or Sign step, the recovery effect (`:253-256`) rebuilds `details` from the raw form values and never re-merges `healthConditions` / `healthOther`. Those members are saved with `health_conditions = null`, so the waiver PDF prints "None declared" and the staff Registration form shows empty chips.

Verified in data: several recent self-registered members (INC-26-0070, 0068, 0065, 0063, 0060, 0059, 0057, 0053) have `health_conditions` null while others in the same period have values.

Fix:
- Merge `healthConditions` + `healthOther` into `details` in the draft-recovery effect, using the same join helper as the normal path.
- Persist the merged string in the draft itself so the value survives even if the effect is skipped.
- Backfill: no reliable source exists for the null rows (the answers were never sent), so staff will re-collect on the next visit via the existing Registration drawer — no silent guessing.

The staff-side print path (`MemberRegistrationForm` → `buildRegistrationFormPdf`) already hydrates conditions and PAR-Q correctly; no change needed there.

## 2. Purchase PT Package drawer (the screen in your screenshot)

Two purchase drawers exist today. Members page opens the older `PurchasePTDrawer` (session-first, shows "0 sessions", no start date, no GST control); the member portal opens the newer monthly-aware `PurchasePTPackageDrawer`. Staff will be moved onto the newer one so there is a single sales surface.

Changes to the unified drawer:
- **Start date** picker (defaults to today, allows a future start). Expiry is computed from the start date with the existing calendar-month helper `pt_calendar_expiry`, not "today + 90".
- **Monthly display**: for `package_type = 'monthly'` show "Monthly access · 3 months · valid to <date>" instead of "0 sessions". Session count only renders for session packs.
- **GST control**: a toggle with two states — GST 5% inclusive (default, current behaviour) and GST exempt (0%). Both write the actual rate onto the invoice; no more silent 5% when staff intended none. Visible to owner/admin/manager only.
- Live breakdown: price, GST split, trainer share preview, discount, amount payable.
- **Attendance readiness**: the drawer shows which trainer is assigned and from which date sessions can be marked, so it is obvious why marking fails before the start date.

## 3. PT attendance and commission workflow

Audit findings against the live database:
- `log_pt_session` is the single engine and handles monthly correctly (no session consumption, expiry check, auto gym check-in). It does **not** check `start_date`, so a future-dated package can be marked today — that gap gets closed alongside the new start-date field.
- Commission is written at purchase as `earned_unconfirmed` and flipped to `earned` by `activate_pt_package` when payment lands. That is correct; no change.
- `expire_pt_packages` and `renew_pt_package` already exist, so monthly lifecycle is covered.

Work:
- Add a `start_date` guard to `log_pt_session` (clear `package_not_started` error with the date, surfaced as a readable toast).
- Trainer attendance panel: for monthly clients show days remaining and sessions logged this month instead of a depleting counter.

## Technical notes

- Frontend: `src/pages/PublicRegistration.tsx`, `src/lib/registration/useRegistrationDraft.ts`, `src/components/pt/PurchasePTPackageDrawer.tsx`, `src/pages/Members.tsx` (swap drawer), delete `src/components/members/PurchasePTDrawer.tsx` once unused, `src/components/pt/PtAttendanceTabContent.tsx`.
- Migrations: allow `_gst_rate` of 0 or 5 in `purchase_pt_package` / `_purchase_pt_package_impl` and relax `enforce_pt_invoice_gst` to accept 0 for exempt sales; add the start-date guard to `log_pt_session`.
- All drawers stay Sheet-based, branch-scoped and `can.*` gated.
