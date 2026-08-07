# Diet & Workout Plan Flow — Rebuild Create → Edit → Preview

Rebuilds the plan builder workflow inside the existing files, keeping saving, AI generation, assignment and PDF delivery behaviour intact.

## What the code shows today

- **Drafts are stored in `sessionStorage` and failures are swallowed.** `saveDraft()` wraps the write in `try {} catch {}` with "ignore quota errors", then the editor navigates to Preview regardless. A weekly diet plan with 7 days x 6-8 meals (plus video paths) can exceed the quota, so "Save & Back to Preview" appears to do nothing — it navigates but Preview reads the previous (or missing) draft. This is the leading candidate for the broken button; the other candidate is the button being disabled/blocked because `canSubmit` requires plan name + dietary type + cuisine + at least one filled item, with the failure only surfaced as a toast. Both get verified before the fix (step 1).
- **Pre/Post-workout is not in the AI contract.** `generate-fitness-plan` prompts for exactly `breakfast, snack1, lunch, snack2, dinner`, and `validatePlanShape` only checks those five. Downstream (`slotKeys` in the matcher, `dietContent.ts`, the builder presets) already understands `pre_workout` / `post_workout`, so the AI is the only place these meals are dropped.
- Three overlapping shells (hub tabs, flow layout, editor headers), a `window.confirm` for unsaved changes, and inconsistent empty/loading states remain across `CreateManual`, `PreviewPlan`, `CreateAI`, `Templates`, `MemberPlans`.

## Plan

### 1. Verify, then fix the save path (root cause first)
- Reproduce "Save & Back to Preview" on a weekly diet draft in the running app and capture what actually happens (disabled button, validation toast, or silent draft-write failure). Fix what the repro shows.
- Make draft persistence reliable regardless: report write failures instead of swallowing them, prune older drafts before writing, strip non-essential payload (video blobs/base64) from the stored draft, and fall back to an in-memory store so navigation never lands on a stale draft.
- Navigate only after the draft round-trips (write then read back). If it can't be stored, keep the user on the page with a clear error instead of a silent no-op.
- Replace blocking-by-disabled with a visible validation summary: the primary button stays clickable and, on click, scrolls to and highlights the missing field (name / dietary type / cuisine / at least one item).

### 2. Pre & post-workout meals as first-class meals
- Add `pre_workout` and `post_workout` to the AI output contract, the JSON example and the plan-shape validator in `generate-fitness-plan`, with an instruction to include them whenever the member trains (timing relative to the session), and to omit them only for non-training days.
- Accept these keys anywhere the five known keys are accepted on read, keep them in stored order, and make sure they survive template save → reload → preview → PDF.
- Builder: pre/post-workout presets pinned in the Add-meal bar, and a "training day" quick layout that inserts both around the session time.

### 3. Rebuilt Create → Edit → Preview workflow (single shell)
- One shell for all four steps (Create mode picker, Build, Preview, Assign): slim breadcrumb + one sticky command bar with title, context chips and primary/secondary actions; step rail only in the real create flow.
- Deterministic navigation contract: every entry point (AI, manual, template edit, member plan edit) declares where Back and Save return to; no reliance on history.
- Unsaved-changes guard becomes an in-app dialog (Save / Discard / Cancel) instead of `window.confirm`, wired to Back, Cancel and tab switching.
- Explicit save state in the bar: Saved / Unsaved changes / Saving, so the user always sees whether a click registered.

### 4. Builder and preview UI rebuild (ui-ux-pro-max, Vuexy tokens)
- Diet and workout editors share one workbench: day rail (vertical desktop, scroll-snap mobile) with per-day counts and kcal, dense meal/exercise cards with drag handle, reorder, duplicate, move-to-day and delete, heavy fields collapsed.
- Right insight panel: Live Macros for diet (day / weekly average, over-target colouring), volume and exercise count for workout.
- Preview page rendered from the shared normalizer with the same day rail, so what you see is what the PDF prints — including pre/post-workout meals.
- Unified skeleton, empty and error states across Templates, Member Plans, Create and Preview; 44px targets, aria-labels on icon buttons, visible focus rings, verified at 375/768/1024/1440, reduced-motion respected.

## Technical notes

- `src/lib/planDraft.ts` — surfaced errors, pruning, size trimming, in-memory fallback, verified write.
- `src/components/fitness/create/manual/ManualDietEditor.tsx`, `ManualWorkoutEditor.tsx` — validation surfacing, save path, layout rebuild; existing state model, `dietContent.ts` normalisation and load guards preserved.
- `src/components/fitness/create/CreateFlowLayout.tsx` — single shell, save-state indicator, dialog-based leave guard.
- `src/pages/fitness/PreviewPlan.tsx`, `CreateManual.tsx`, `CreateAI.tsx`, `CreateModePicker.tsx`, `Templates.tsx`, `MemberPlans.tsx` — re-laid out on the shared components; queries, mutations and query keys unchanged.
- `supabase/functions/generate-fitness-plan/index.ts` — pre/post-workout in prompt contract, example and validator (version bump comment).
- `src/lib/fitness/dietContent.ts`, `src/lib/planNormalizer.ts` — read/write parity for pre/post-workout keys.
- No database or RPC changes.

## Verification

Round-trip an existing weekly diet template (KRISTINE'S ENDURANCE DIET PLAN) and a workout template: open, edit, save, reopen, preview, download PDF — content identical plus pre/post-workout meals present, and "Save & Back to Preview" lands on Preview showing the just-saved edits.
