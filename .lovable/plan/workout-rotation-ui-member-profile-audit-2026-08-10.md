# Workout Rotation UI + Member Profile Audit

Seven items, grouped. Everything below is based on reads of the current code and a query of the live error/automation tables.

## 1. Workout rotation — the missing UI layer

What exists today (verified): rotation logic (`src/lib/fitness/planRotation.ts`), an interval selector on the AI create page, floor-load balancing controls in `AssignPlanDrawer`, and member-side day-shifting in `WorkoutPlanViewer`.

What is missing (verified — no code found):
- No way to **author or edit rotation variants** in the manual workout editor. Only AI-generated plans can contain `rotation.variants`, so a manually built plan can never rotate.
- No **staff-visible rotation state** after assignment: nothing shows which member sits on which day-shift/variant, and there is no way to change a member's shift once assigned.
- No **rotation preview** in the plan preview / viewer sheet — staff cannot see what week 1 vs week 3 looks like before assigning.

Work:
- **Manual editor:** add a "Rotation" panel — enable/disable, interval presets (Off / 7 / 14 / 21 / 28 days), and "Duplicate this week as Variant B/C/D" so a trainer can build equivalent-exercise blocks by editing a copy. Per-variant labels, delete, and a swap-exercise helper.
- **Rotation preview:** a compact date-scrubber on the preview and viewer sheet showing which variant + which weekday layout is active on any chosen date.
- **Floor-load board:** a read-only panel (Templates page + member Plans tab) listing assigned members grouped by day-shift, with the branch load per weekday from the existing `workout_schedule_offset_load` RPC, plus an inline "Change shift" action that updates `schedule_offset_days` on that member's plan.
- **Member portal:** clearer rotation chip ("Block B · switches in 4 days") instead of the current silent shift.
- UI follows the ui-ux-pro-max pass: `rounded-2xl` cards, soft slate shadows, indigo/violet accents, colored status badges, skeletons, and 44px targets.

## 2. System health audit

Live query of `error_logs` (last 10 days) and `automation_rules`:
- **All 26 active automation rules currently report `success`** — no failing crons. `mips_personnel_delta_sync` is inactive by design.
- Real signals to fix:
  - `frontend` — "Network error / Load failed / Fetch is aborted" (13 events, incl. profile + roles fetch). Add retry-with-backoff and an offline-aware toast instead of logging each aborted fetch as an error; suppress abort-on-unmount noise.
  - `edge_function` — Meta API 400 "Template category doesn't match / can't change category" (8 events). Detect the existing template category and reuse it instead of forcing UTILITY on re-create.
  - `database` — one `statement timeout`. Identify and index the offending query.
  - `edge_function` — one "not enough compute resources" and one Smartping RCS connect error. Both transient; add explicit retry + clearer health surfacing.
- Add a "noise vs actionable" filter on the System Health page so warnings like `AI reply skipped` don't read as failures.

## 3. Upgrade package parity with membership sale

`UpgradeMembershipDrawer` currently has: plan, GST toggle (defaults 18%), pay-now amount, method (4 options), reason.
`PurchaseMembershipDrawer` additionally has: discount amount + reason, admission/joining fee, locker selection, partial payment, payment reminders toggle, Razorpay payment-link method, wallet, GST default 5% pulled from plan, and a full price summary with CGST/SGST split.

Work: bring the upgrade drawer to the same field set and the same summary card, defaulting GST to the plan's rate (5%) rather than a hardcoded 18%.

## 4. Complimentary valid-date sync

Comp gift drawer already loads the active membership (`start_date`, `end_date`). Work: bind the comp validity date to the membership when a "Match membership validity" toggle is on — auto-fill and re-fill when the membership end date changes (freeze/extension), with manual override available and a hint showing the source date.

## 5. Duplicate "Pay" tabs

Verified in `MemberProfileDrawer`: there is exactly one tab labelled **Pay** plus a separate inline **Pay** button on each pending invoice — the likely source of the "two pay" impression. Work: rename the tab to **Payments**, relabel the row action to **Collect**, and confirm with a browser screenshot of the drawer that no second tab renders at any viewport.

## 6. Profile picture blanks on every refresh

Verified: the avatar renders from `profile?.avatar_url`, which is `undefined` until the TanStack query resolves, so it falls back to the initial then swaps to the image. Work: render an avatar skeleton while loading (never the initial), keep avatar URLs in the query cache with a persisted `staleTime`, and preload the image so it appears in one paint.

## 7. Purchase drawer shows no member avatar

Work: add a member identity header (avatar, name, member code, status badge) to `PurchaseMembershipDrawer`, `UpgradeMembershipDrawer` and `PurchaseAddOnDrawer`, reusing the same avatar component and loading behaviour from item 6.

## Technical notes

- Rotation authoring writes into the existing `plan_data.rotation.variants[]` shape already consumed by `resolveRotation()` — no schema change needed for variants.
- Shift changes update `member_fitness_plans.schedule_offset_days` / `rotation_interval_days` (columns already exist).
- Financial parity in the upgrade path continues to route through the existing atomic payment RPC — no new payment logic.
- Frontend-only for items 3-7 apart from the read RPC already present; item 2 fixes touch edge functions and possibly one index.
