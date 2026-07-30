# Fix Plan — System Health clusters + 5 reported issues

## Cluster analysis

**Clusters 1 + 2 — same cause. "supabase is not defined" (generate-fitness-plan)**
- Root cause: the function builds `supabaseAdmin` and `supabaseClient`, but the AI call passes a bare `supabase` variable that was never declared, so every plan generation throws `ReferenceError` and returns 500. This is why diet/workout plans cannot be generated at all.
- File: `supabase/functions/generate-fitness-plan/index.ts`
- Fix: pass `supabaseAdmin` into `generateOnce({ ... supabase: supabaseAdmin })`, and read the branch from the caller payload instead of the untyped `memberInfo.branch_id`.

**Clusters 3 + 4 — same cause. "stack depth limit exceeded" on `purchase_pt_package`**
- Root cause confirmed in the live database: the 29 Jul migration replaced `purchase_pt_package` with a thin wrapper *before* copying the old body into `_purchase_pt_package_impl`. The copy therefore captured the already-replaced delegating body, so `_purchase_pt_package_impl` now calls **itself** forever. Postgres aborts with `54001`; the frontend error in cluster 4 is just that same failure surfaced in the UI.
- Fix: new migration that recreates `_purchase_pt_package_impl` with the real business logic recovered from migration `20260616150011` (last complete version: idempotency, invoice + 5% GST line, payment, subscription, trainer commission), keeping the public wrapper as the GST guard. Verify with a rollback-tested call before closing.

## Item 2 — Google AI provider
- Confirmed: `ai_provider_configs` has a `google` row (active, key `GOOGLE_AI_API_KEY`) but `lovable` is still the default, and the `fitness_plan` purpose has no explicit provider, so selecting Google in Settings had no effect on plan generation. Any Google failure was also masked by the crash above.
- Fix: honour the purpose-level provider selection end-to-end, verify the `GOOGLE_AI_API_KEY` secret is present (request it if missing), and surface the real provider error text in the UI instead of a generic 500.

## Item 3 — Dashboard "Live Access Feed" redesign
- Today `/dashboard` embeds the raw device log (`LiveAccessLog`), which repeats every punch.
- Redesign to a **Today's Check-ins** card: one row per person, latest check-in only, split into Members / Staff & Trainers.
  - Member row: avatar, name, code, check-in time, dues badge (amber when pending), days-remaining badge (red when < 7).
  - Staff/trainer row: avatar, name, role chip, check-in time (and check-out when present).
  - Vuexy styling: `rounded-2xl`, soft shadow, colored status badges, skeleton + empty + error states, realtime refresh.

## Item 4 — Waiver PDF download fails
- Root cause confirmed: the PDFs exist in the `member-onboarding` bucket, but the storage read policy requires `has_capability(auth.uid(), 'view_member_documents')` and **no role in `role_capabilities` has that capability**, so the policy is false for everyone and the signed-URL call returns "Object not found".
- Fix: migration granting `view_member_documents` to owner / admin / manager (and staff where branch-scoped), so the existing branch-scoped policy works as designed. No client change needed beyond keeping the two-bucket fallback.

## Item 5 — PAR-Q shown as raw JSON
- File: `src/components/members/MemberProfileDrawer.tsx` (PAR-Q + Consents blocks currently `JSON.stringify` into a `<pre>`).
- Fix: render each question as a readable row with a Yes/No badge, and consents as labelled check rows (DPDP, Photo, Waiver, WhatsApp). Fall back to raw JSON only for unknown shapes.

## Item 6 — Google reviews not on dashboard
- Confirmed: reviews are only rendered in `ExternalReviewsTab` (Feedback page), and the `google_reviews` table currently has **0 rows** — nothing has been ingested yet.
- Fix: two parts — (a) add a compact "Google Reviews" widget to `/dashboard` (rating average, count, latest 3, link to Feedback); (b) audit the review-sync path and trigger an initial fetch so the table is populated; if the sync needs a Places/GBP credential that isn't set, the widget shows a clear "connect Google reviews" state instead of silently empty.

## Technical notes
- Two migrations: (1) restore `_purchase_pt_package_impl` body, (2) insert `view_member_documents` capability rows.
- Edge function edit: `generate-fitness-plan` (supabase client reference + branch id).
- Frontend: new `TodaysCheckinsCard.tsx` and `GoogleReviewsWidget.tsx` under `src/components/dashboard/`, wired into `src/pages/Dashboard.tsx`; PAR-Q rendering extracted into a small `ParqSummary.tsx`.
- Verification: re-run a PT purchase, generate one workout and one diet plan, open a waiver PDF as admin, and confirm System Health shows no new occurrences of these fingerprints.
