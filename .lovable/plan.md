# Diet Builder: Weekly Plans, Correct Loading, and a 2026 Builder Shell

## What is broken (verified)

The saved plan "Priyanka Lohar - High Protein Lactation Support & Weight Loss" is stored as a **7-day plan**: its content has a `meals` array with 7 entries (Monday…Sunday), each holding `breakfast / snack1 / lunch / snack2 / dinner` with full macros, times and catalog IDs. It has no `slots` key and no `dietaryType` / `cuisine` fields.

The manual diet editor only knows how to load `content.slots` (a single day). So when you open the template for editing:

- Meals load as empty (the `meals` shape is ignored in template edit mode)
- Dietary Type and Cuisine show "Select"
- Live Macros show 0 against the targets
- Only the 5 default day-slots are shown — hence "single day instead of the complete week"

There is a second, more serious consequence: pressing **Save Template** in this state would overwrite the stored 7-day plan with one empty day. That is silent data loss and must be fixed in the same change.

Note: the draft path (AI → preview) already contains a partial `meals` → single-day converter, but it keeps only day 1 and is not used for template edit.

## Back navigation

Root cause is not yet confirmed — the builder page has no reproducible signal captured yet. What is confirmed from the code: the builder header (back chevron + Cancel/Save) is **not sticky** and the page does **not** render the Fitness hub tabs, so once you scroll into the meal list there is no way back to Diet & Workout without scrolling to the very top. Step 1 of the work is to reproduce the failure in the running app and capture the console error before changing navigation logic; the shell redesign below fixes the "no way back" part regardless.

## Plan

### 1. Investigate back navigation
Reproduce opening a saved diet template, editing, and pressing back / Cancel; capture console and route state. Fix whatever the repro shows (chunk load failure, thrown effect, or blocked navigation). Do not guess before the repro.

### 2. Make the diet builder week-aware
- Add a shared normalizer that reads any stored diet content — `meals[]` (weekly, AI shape), `slots[]` (legacy single day), or a bare day — and returns a canonical `days[]` structure of 7 (or N) days, each with named meal slots and items, preserving `time`, `quantity`, macros, `catalog_id`, recipe link and prep video.
- Add the matching serializer so saving writes back the same weekly shape it read (weekly stays weekly, single-day stays single-day). No template is ever downgraded to one day.
- Load `dietaryType`, `cuisine` and macro targets with sensible fallbacks derived from the plan when those fields are absent, instead of leaving required selects blank.
- Guard save: block "Save Template" while the loaded content is still empty/loading so an unloaded template can never overwrite a good one.

### 3. Week UI in the builder
- Day rail across the top (Mon–Sun) with per-day calorie/protein readout and a "copy this day to…" action.
- Editing works on the selected day; Live Macros switch between **This day** and **Weekly average**.
- Existing per-slot features (time, swap from catalog, add item, recipe link, prep video) stay exactly as they are.

### 4. Builder shell redesign (/skill:ui-ux-pro-max, within the existing Vuexy tokens)
- Sticky top bar carrying title, step indicator, back, Cancel and the primary action, so the exit path is always visible while scrolling.
- Fitness hub tabs rendered on the builder page, same as the other fitness pages, so "Diet & Workout" is one click away.
- Unsaved-changes confirmation when leaving with edits pending.
- Denser meal cards: collapsed prep-video/recipe controls behind a small "Attach" affordance instead of two always-open rows per meal (that is what makes the current page endless), skeleton loading state while the template fetches, and clearer empty states.

### 5. Data check
After the loader lands, verify the Priyanka template opens with all 7 days and correct macros, edit one day, save, and re-read the row to confirm all 7 days survive the round-trip.

## Technical notes

- New: `src/lib/fitness/dietContent.ts` — `normalizeDietContent()` / `serializeDietContent()` plus types.
- Edited: `src/components/fitness/create/manual/ManualDietEditor.tsx` (weekly state, loader, save guard), `src/components/fitness/create/CreateFlowLayout.tsx` (sticky header, hub tabs, leave guard), `src/pages/fitness/CreateManual.tsx` (wiring).
- The workout builder already stores `weeks[].days[]`; it will be checked for the same edit-mode loading gap and fixed if it shares the bug.
- No database migration is needed — the stored shape is already correct; only the reader and writer are wrong.
