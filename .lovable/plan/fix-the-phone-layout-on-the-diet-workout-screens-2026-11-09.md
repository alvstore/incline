# Fix the phone layout on the Diet & Workout screens

Goal: make Plan Templates, the Manual Diet builder and the Manual Workout builder easy to use on a phone (375–400 px wide). Nothing should run off the edge of the screen, no text should get cut off, and every button should be easy to tap. Computer and tablet layouts stay the same.

## Step 1 — Check each screen on a phone first
- Take screenshots of each screen at phone, tablet and computer sizes, signed in as an owner and as a trainer.
- Score each screen with the design-critic checklist: what draws the eye first, spacing, text sizes, loading/empty/error states, and phone/tap targets. Write down every problem found before fixing anything.

## Step 2 — Plan Templates
- Search box, filters and sort fill the phone width and wrap neatly instead of getting squeezed.
- On phones each template card shows the name, type, goal and level on top, with the actions underneath: **Assign** as the main full-width button, and a "more" menu for the rest. No fixed button widths that push past the edge.
- Long template names wrap to a second line. Tags wrap onto new lines too.
- Tap targets are at least 44 px; icon-only buttons get readable labels for screen readers.

## Step 3 — Manual Diet builder
- Each food row (name, amount, unit, calories and nutrients) currently uses a 12-column grid. On phones, change it to a stacked card: food name on its own line, then a 2-column row of amount/unit, then calories and nutrients as small chips, with the remove button in the corner.
- The fixed-width amount box becomes full width on phones.
- The calorie and nutrient summary and the day picker can scroll sideways without making the whole page scroll sideways.
- Meal headers and their actions wrap cleanly. The pinned Save bar at the bottom no longer covers the last meal (extra bottom space).

## Step 4 — Manual Workout builder
- Each exercise row (12-column grid of sets, reps, rest, weight) stacks on phones: exercise name on its own line, then sets/reps/rest/weight as a 2×2 grid, then the video and notes controls.
- The day list scrolls sideways with snap and stays at least 44 px tall. Copy/duplicate/remove actions for a day move into a compact menu on phones.
- Same bottom spacing fix for the pinned Save bar.

## Step 5 — Shared layout (header and steps)
- The page title, step indicator and chips wrap on phones. The back button and Save stay reachable. No horizontal scroll anywhere.

## Step 6 — Check again
- Re-take screenshots at 375, 768, 1024 and 1440 px and confirm no horizontal scroll (page width equals screen width).
- Build a test diet and a test workout on a phone-sized screen and save them, to confirm adding, removing and saving still work.

## Feature flag
These are layout-only changes, so no feature flag is needed. The feature-flag guidance says not to put flags around styling alone. Nothing about how plans are saved or sent changes.

## Technical details
- Files: `src/pages/fitness/Templates.tsx`, `src/components/fitness/create/manual/ManualDietEditor.tsx` (rows ~612, ~767 `w-28`, ~817 `grid-cols-12`), `ManualWorkoutEditor.tsx` (~170 `grid-cols-12`, ~646 day header), `src/components/fitness/create/CreateFlowLayout.tsx` (header / mobile sticky bar, add `pb-24 sm:pb-0` to content), `DayRail.tsx`.
- Pattern: `grid-cols-2 sm:grid-cols-12` with `sm:col-span-*` on existing cells so desktop is unchanged. Add `min-w-0` on flex/grid children and `break-words` on titles. Keep only existing theme colors (no new colors).
- Verification with Playwright, checking `document.documentElement.scrollWidth <= innerWidth` at each size.
