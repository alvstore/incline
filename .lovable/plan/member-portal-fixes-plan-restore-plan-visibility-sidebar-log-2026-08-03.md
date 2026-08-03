# Member Portal Fixes: Plan Restore, Plan Visibility, Sidebar Logo

## 1. FAT LOSS PROGRAM template + Mohit Gurjar's workout

Verified in the database:

- The template was **not hard-deleted** — "FAT LOSS PROGRAM" (and "FAT LOSS DIET PROGRAM", "Vegetarian Indian Fat Loss Plan") were all switched to inactive earlier today. Nothing needs restoring from a backup server; the content is intact.
- Mohit Gurjar (INC-26-0025) has three assigned plans: two workout copies of FAT LOSS PROGRAM and one diet plan. They render on his dashboard because the assigned copy lives on his record independently of the template's active flag.
- No download button appears because **none of the three assigned rows has a stored PDF** (`pdf_url` is empty), and My Workout only shows Download when a PDF file is attached.

Fix:
- Reactivate the three soft-deleted templates so they're visible again in the catalogue.
- Add a Download action to My Workout / My Diet that works even when no file is stored: serve the stored PDF when present, otherwise generate it on demand from the plan content using the existing plan PDF builder, then save it back so future downloads are instant.
- Deduplicate Mohit's two identical workout assignments (keep the newest) so his dashboard shows one plan.

## 2. All plans still showing on /my-plans

The member page already filters to plans marked visible, and the Edit Plan drawer does now save the toggle — but **every one of the six plans is currently flagged visible in the database**, so the filter has nothing to hide. The earlier "off" states were never persisted (they were set before the save fix), so they need to be set again, and there is no way to see or change visibility from the plans list itself.

Fix:
- Add a "Visible to members" / "Hidden" badge on each plan card in the staff Plans screen, with an inline toggle so visibility can be changed without opening the drawer.
- Show the member-facing count ("4 of 6 visible to members") in the header so the state is obvious at a glance.
- Then set the intended plans to hidden. Please confirm which plans should stay visible in the member portal — otherwise I'll leave the data as is and you can flip them from the new toggle.

## 3. Logo missing in the member sidebar

Confirmed root cause: there are **two database functions named `get_org_branding`** — an older no-argument one and a newer branch-aware one. A call with no arguments is ambiguous and the API rejects it (`Could not choose the best candidate function`). Staff screens pass a branch and resolve fine; the member sidebar calls the no-argument form, gets an error, and falls back to the placeholder.

Fix: remove the redundant no-argument function and have the branding hook call the branch-aware one (branch optional). Logo then loads for members, staff and trainers from the same path.

## Technical notes

- Migration: drop `public.get_org_branding()` (no-arg overload), keep `get_org_branding(_branch_id uuid default null)`; reactivate templates `078f6f09…`, `1ece0575…`, `db80da80…`.
- Frontend: `src/hooks/useOrgBranding.ts` (pass `_branch_id: null`), `src/pages/MyWorkout.tsx` + `src/pages/MyDiet.tsx` (download-or-generate action reusing `src/utils/pdfBlob.ts`), `src/pages/Plans.tsx` / plan card component (visibility badge + inline toggle via existing `updatePlan`).
- No schema changes; `is_visible_to_members` and `pdf_url` already exist.
