# Diet Builder Fixes: Named Meals, Reordering, Preview, Live Macros, Duplicate

## What is confirmed wrong

Reading KRISTINE'S ENDURANCE DIET PLAN straight from the database, Monday is stored as:

```text
lunch / snack1 / snack2  -> proper meals with macros
slot_1 (05:30) "Banana + Dates"          <- was "Pre-Workout"
slot_2 (08:00) "Whole Eggs + Egg Whites" <- was "Post-Workout"
slot_6 (22:00) "Fish + 2 Chapati"        <- was a custom meal
```

1. **Pre/Post-Workout names are lost on save.** The writer only knows five meal keys (breakfast, snack1, lunch, snack2, dinner). Anything else is written as `slot_1`, `slot_2`… and the meal's own name is never stored, so on reload the builder can only call it "Slot 1". Custom-named meals (Pre-Workout, Post-Workout, Bedtime) are the ones affected.
2. **No way to reorder meals.** New meals sort by time on insert only; there is no drag handle and no move up/down, so a meal added later sits wherever its time string put it and cannot be adjusted.
3. **Preview shows nothing.** The plan preview drawer reads only `data.days[].meals[]`. It does not understand the weekly `meals[]` shape (what this plan actually uses) or the legacy `slots[]` shape, so it renders "This diet plan has no meals defined yet" even though the plan is full — while the PDF, which uses the shared normalizer, prints correctly.
4. **Macros are blank per item.** Items typed by hand (the slot_1/2/6 ones) have calories/protein/carbs/fats = 0, so day totals and the Live Macros panel under-report. Only catalog-swapped meals carry macros.
5. **No duplicate action.** Templates can be edited or deleted, but there is no "make a copy" so a plan can be reused under a new name.

## Plan

### 1. Preserve custom meal names (data fix + writer/reader fix)
- Write `name` (and keep `time`) on every serialized meal entry, including the five known keys.
- When reading, prefer the stored `name` over the key, so `slot_1` with `name: "Pre-Workout"` comes back as Pre-Workout; keys without a name fall back to a humanised key as today.
- Recognise pre-workout / post-workout / bedtime / mid-morning as first-class keys (`pre_workout`, `post_workout`, `bedtime`) instead of `slot_N`, and keep numbered keys only for genuinely unnamed meals.
- One-off data repair for the KRISTINE plan (and any other template holding `slot_N` entries): re-label the affected entries from their times so existing plans read correctly without re-typing.

### 2. Reorder meals in the builder
- Drag handle on each meal card with keyboard-accessible move up / move down buttons (44px targets, aria-labels).
- Order is what gets saved — no implicit re-sorting by time after the first insert; a "Sort by time" button stays available for one-tap tidy-up.
- New meals from the Add-meal bar insert in time order as they do now.

### 3. Fix the plan preview drawer
- Route the diet branch of the preview drawer through the shared plan normalizer so weekly `meals[]`, manual `slots[]`, and `days[]` all render — the same source of truth the PDF already uses.
- Show per-meal time, items, quantity and macros, plus a day totals line, and keep the empty state only for genuinely empty plans.

### 4. Live macro calculator
- Per-item macros auto-fill from the meal catalog when a food matches (by catalog id, then by name), scaled by quantity where a numeric quantity is present; manual entry still wins if the trainer types a value.
- Each meal card gets a live subtotal row (kcal · P/C/F) that updates as items change.
- The Live Macros panel keeps its This day / Weekly average toggle and now reflects hand-typed meals correctly, with over/under-target colouring against the plan's calorie and macro targets.
- A "Recalculate macros from catalog" action on the day to backfill older plans that were saved with zeros.

### 5. Duplicate a template
- Copy action on each template card and in the builder's action bar: opens a small prompt for the new name (defaulting to "<name> (Copy)"), clones content, targets and metadata into a new template owned by the current branch, then opens it for editing.

### 6. Back button audit + 2026 builder shell (ui-ux-pro-max)
- Verify the back path from Edit Template in the running app and fix whatever the repro shows; today back is an explicit navigate to `/fitness/templates`, and unsaved edits are discarded silently.
- Add an unsaved-changes guard on back / Cancel / tab switch.
- Shell polish within existing Vuexy tokens: compact breadcrumb + title row, meal-count and day-count chips, day rail with per-day kcal/protein staying pinned on scroll, denser meal cards, skeletons while the template loads, and a clearer save state (Saved / Unsaved changes indicator).

## Technical notes

- `src/lib/fitness/dietContent.ts` — `serializeDietDays` writes `name`; `normalizeDietContent` prefers `name`; extend `slotKeyFor` with pre/post-workout and bedtime.
- `src/lib/planNormalizer.ts` — reused by the preview drawer; extend its AI-meal reader to accept arbitrary keys with names.
- `src/components/fitness/PlanViewerSheet.tsx` — replace the ad-hoc `data.days` read with `normalizeDietPlan`.
- `src/components/fitness/create/manual/ManualDietEditor.tsx` — reorder controls, per-meal subtotals, catalog-backed macro fill, dirty tracking.
- `src/components/fitness/create/CreateFlowLayout.tsx` — leave guard + save-state slot.
- `src/pages/fitness/Templates.tsx` and `src/services/fitnessService.ts` — duplicate template action.
- Data repair runs as a migration over `fitness_plan_templates.content` only (no schema change).
