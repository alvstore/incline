# Workout day-mover, load balancing clarity, AI templates, daily report

## 1. Floor Load Balancing — preview before assigning, and what it's for

Today the drawer shows shift buttons and a distribution bar, but no way to see the resulting week for each member before saving.

- Rename the section to **Day Shift (Floor Load Balancing)** with a one-line explainer: *"Same plan, same exercises — each member's week starts on a different day so the floor isn't crowded on Monday."*
- Add a **Preview schedule** panel: for each selected member, a compact 7-day strip (Mon–Sun) showing that member's shifted focus per day, so staff can confirm Member A is Mon/Wed/Fri while Member B is Tue/Thu/Sat before assigning.
- Clarify the two mechanisms side by side in the drawer:
  - **Day shift** — moves whole sessions to different weekdays (per member).
  - **Exercise rotation** — every N days swaps in equivalent exercise variants (per plan).
  They are complementary; the copy will say so explicitly.

## 2. Move any day's workout to any other day (in the builder)

In the manual workout editor the week is fixed Monday–Sunday and only exercises inside a day can be reordered.

- Add a **Move day** control on each day in the week rail and in the day header: pick a target weekday and the whole session (focus, warm-up, exercises, cool-down) moves there. If the target already has content, the two days **swap**, so nothing is lost.
- Add drag-and-drop on the week rail for the same action (drag Monday onto Saturday), with the day names staying fixed — only the content moves.
- Show a small "moved" hint and keep undo simple via the existing draft autosave.

## 3. AI template generator

Confirmed causes of it "not working properly":

- The canonical event catalog has **no `daily_ops_summary` event**, so the generator can never propose the owner-report template — and the dispatcher then has nothing approved to send on WhatsApp.
- Bulk "Save all" submits proposals one by one with no progress or per-row result, so partial Meta rejections look like silence.

Fixes:
- Add the missing operational events to the catalog (owner daily report, plus any other events that dispatch code emits but the catalog lacks) so they appear as "missing" and get generated.
- Give the review step per-proposal status (queued / submitting / approved / draft-with-reason) and a summary line after Save all, instead of stacked toasts.
- Surface Meta rejection reasons inline on the proposal so it can be edited and resubmitted without leaving the drawer.

## 4. Daily ops report not arriving

Verified from the logs: the job **does run** at 23:00 IST and the numbers are correct.

- **WhatsApp** is suppressed every day: `no_template_for_closed_session` — there is no approved WhatsApp template mapped to `daily_ops_summary`. Fix = create and submit that template (via item 3) and map the trigger, so both owner numbers receive it.
- **Email** is logged as `sent` for both owners, but nothing is landing. Next step is to trace the actual provider result for those two sends and confirm the sender domain / recipient suppression, then fix whatever that trace shows (most likely a sender-domain or spam-routing issue, not the report code).
- Make the job's failure visible: keep the 424 partial status but also record a system-health entry naming the channel that failed, so a silent WhatsApp suppression doesn't sit unnoticed for days.

## 5. Revenue metrics vs invoices and payments — audit result

Checked live: total invoiced ₹20,17,000, invoice `amount_paid` ₹18,53,500, and completed payments ₹18,53,500 — an exact match, with **0 invoices** whose paid amount drifts from their payment rows. Voided (₹1,87,799) and refunded (₹900) are correctly excluded. No corrective work needed; the plan adds a standing reconciliation check for this pairing so future drift is caught automatically rather than by manual audit.

## Technical notes

- `src/components/fitness/AssignPlanDrawer.tsx` — preview panel built on `shiftWorkoutPlanDays` / `shiftWorkoutWeekday` from `src/lib/fitness/planRotation.ts` (no new schedule logic).
- `src/components/fitness/create/manual/ManualWorkoutEditor.tsx` + `DayRail.tsx` — move/swap day operates on the existing `days[]` state; storage format unchanged.
- `src/lib/templates/systemEvents.ts` — add missing events; `AIGenerateTemplatesDrawer.tsx` — per-proposal submit state.
- `supabase/functions/daily-ops-summary/index.ts` — health logging only; report maths untouched.
