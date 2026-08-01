# Fitness Plan PDF: Form Tips, Warm-up/Cool-down, and a Professional Layout

## What's actually wrong

**1. Form Tips never reach the PDF (confirmed).**
The manual workout editor saves each exercise's Form Tips into a field called `notes` when building the plan content. The PDF builder only reads `form_tips`. So the column renders, but always empty — exactly what the uploaded `Workout-Plan-FAT_LOSS_PROGRAM.pdf` shows (Form Tips column is blank for all 38 exercises).

**2. Even once wired, the current Form Tips column can't hold real tips.**
Tips are truncated to 80 characters and squeezed into a narrow leftover column. Your Warm Up tips ("5 Min Treadmill Walk / Arm Circles x 20 / Shoulder Rotations x 20 / Wall Push-ups x 15") would be cut mid-sentence and lose their line breaks.

**3. There is nowhere proper to put warm-up / cool-down.**
The plan data model already supports `warmup` and `cooldown` per day, but the editor doesn't expose them — so you correctly worked around it by adding "Warm Up" and "Cool Down" as fake exercises with 1 set / 1 rep / 60s rest. That looks wrong in the PDF.

**4. Equipment/machine is not editable.**
The PDF is built to print a machine name under each exercise, but the editor has no Equipment field, so that sub-line is always empty.

## What I'll change

### A. Fix the data flow (the actual bug)
- Editor writes tips to `form_tips` (and keeps writing `notes` too, so nothing existing breaks).
- PDF reads `form_tips` **or** `notes`, so all your already-saved templates — including FAT LOSS PROGRAM — start printing their tips immediately with no re-entry.

### B. Add Warm-up / Cool-down as first-class fields
- New "Warm-up" and "Cool-down" text areas at the top and bottom of each day in the editor (multi-line, so your treadmill/arm-circles list stays formatted).
- The PDF renders them as a tinted band above and below that day's exercise table — labelled, not disguised as an exercise.
- One-time cleanup on load: if a day's first exercise is literally named "Warm Up"/"Warmup" (or last is "Cool Down"), it is lifted into the new field automatically so you don't have to redo the FAT LOSS PROGRAM by hand. You can review it before saving.

### C. Add an Equipment field per exercise
Small input next to Exercise name; prints as the muted machine sub-line the PDF already supports.

### D. Make the PDF look like a proper fitness-centre document
- Drop the cramped Form Tips column. Tips print as an indented, full-width coach-cue line directly under each exercise row — no truncation, line breaks preserved, italic muted styling.
- Table columns rebalanced (Exercise + equipment / Sets / Reps / Rest / Load) so numbers align cleanly.
- Day header becomes a coloured band: "MONDAY — CHEST · 8 exercises", so days are scannable.
- Rest days render as a single clean "Rest & Recovery" strip instead of an empty table.
- Page-break safety: a day never splits so that its header lands alone at the bottom of a page.
- Footer on every page: plan name, member name/code, page X of Y, and "The Incline Life by Incline" with website — plus a "Prepared by <trainer>" line.
- A short "How to use this plan" panel on page 1 (progression, form-first, hydration, log your sets).

## Technical notes

- `src/components/fitness/create/manual/ManualWorkoutEditor.tsx` — add `equipment`, day-level `warmup`/`cooldown` to the local types and `buildContent()`; write `form_tips` alongside `notes`; add the legacy warm-up/cool-down lift on template/draft load.
- `src/utils/pdfBlob.ts` (`buildPlanPdf`, workout branch) — tolerant tips read (`form_tips ?? notes`), remove the tips column, render tips via `didDrawCell`/row hooks as a wrapped sub-row, add warm-up/cool-down bands, day header band, rest-day strip, page-break guard, and the repeating footer.
- `src/types/fitnessPlan.ts` — no schema change needed; `warmup`, `cooldown`, `equipment`, `form_tips` all already exist as optional fields, so stored JSON stays backward compatible.
- No database migration, no edge function change.

## Verification

Regenerate the PDF for FAT LOSS PROGRAM via the existing QA harness (`scripts/qa-pdf.ts`), convert every page to images, and inspect each one for: tips present and unclipped, warm-up/cool-down bands correct, no overlapping text, no orphan day headers, footer on all pages.
