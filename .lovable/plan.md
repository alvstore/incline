# Diet & Workout — 2026 UI/UX Redesign

A presentation-layer redesign of the whole Diet & Workout hub. No changes to data logic, saving, AI generation, assignment rules or PDF delivery — only layout, hierarchy, density, states and motion.

## What's wrong today

- The hub header, the Create Plan tabs and the builder's own sticky header stack into three competing title bars (visible in both screenshots) — a user editing a template sees "Diet & Workout", "Create Plan", "Edit Plan Template" and a step rail before any content.
- The step rail (Build / Preview / Assign) is shown even in template-edit mode, where Preview/Assign are not part of the flow.
- Plan Details, Weekly Schedule, Live Macros and Pre-Assign Member all render as flat equal-weight cards, so nothing signals where work happens.
- Day tabs are a wrapping row of pills; exercise/meal rows are long unstructured forms with weak grouping.
- Empty, loading and error states across Templates / Member Plans are inconsistent.

## The redesign

**1. Unified hub shell**
- One page header per screen. In builder routes the hub tabs collapse into a slim breadcrumb (`Diet & Workout / Templates / Edit`), so there is a single sticky action bar with title, context chips (type, difficulty, days) and primary/secondary actions.
- Step rail only renders for the real create flow; edit-template mode gets a "Editing template" status chip instead.

**2. Builder as a workbench (workout + diet)**
- Two-pane layout: left = day rail + editor, right = sticky insight panel (Live Macros for diet, Volume/Total exercises for workout, plus optional pre-assign).
- Vertical day rail on desktop (Mon–Sun with item counts, rest days muted), horizontal scroll-snap rail on mobile — replaces the wrapping pill row.
- Exercise/meal rows become compact cards: drag handle, name, then a tidy grid of secondary fields, with heavy fields (form tips, video, macros) inside an expandable section. Row actions: duplicate, move to day, delete.
- Per-day toolbar: copy day to…, clear day, mark as rest, add from catalog/library.
- Sticky footer on mobile with the primary save/continue action.

**3. Create Plan landing**
- Reorganised into a "start here" grid: AI generate, Manual build, From template, Upload PDF — each a single tile with icon, one-line description and readiness badge; the pipeline readiness strip becomes a compact status row rather than large cards.

**4. Templates & Member Plans**
- Consistent toolbar (search, type filter, difficulty, targeting), card grid with clear type accent, usage count, and an action row that no longer hides behind icons only.
- Unified skeleton, empty and error states shared across the hub.

**5. System polish**
- All surfaces on project tokens: `rounded-2xl`, soft slate shadows, indigo/violet accents, status badges for difficulty/targeting.
- Full keyboard support, visible focus rings, `aria-label` on all icon buttons, 44px touch targets, 375/768/1024/1440 verified, reduced-motion respected, 150–300ms transitions.

## Technical notes

- New shared components under `src/components/fitness/`: `FitnessPageHeader` (replaces the duplicated header/tab stack), `DayRail`, `PlanInsightPanel`, `PlanStates` (skeleton/empty/error), `EditorRow` wrapper.
- `CreateFlowLayout.tsx` rewritten to render one sticky bar + optional step rail; keeps the existing `backTo` deterministic navigation.
- `ManualWorkoutEditor.tsx` and `ManualDietEditor.tsx` restructured visually only — existing state model, dnd-kit sorting, draft persistence, `dietContent.ts` normalisation and save guards are preserved as-is.
- `CreateModePicker.tsx`, `Templates.tsx`, `fitness/MemberPlans.tsx` re-laid out against the shared components; queries, mutations and query keys untouched.
- No database, RPC or edge function changes.

## Verification

Round-trip the two screens in the screenshots (the Priyanka Lohar 7-day diet template and the workout template `0638dbbc…`): open, edit a day, save, reopen — content must be byte-identical to today, with the new layout at mobile and desktop widths.
