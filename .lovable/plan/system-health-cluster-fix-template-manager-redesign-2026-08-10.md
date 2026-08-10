# System Health cluster fix + Template Manager redesign

## Part A — the 6 health errors

The six clusters collapse into **three** root causes.

### Cause 1 — Safari "TypeError: Load failed" (clusters 1, 2, 4, 5)

All four are the same thing: the auth bootstrap fires two requests (`profiles` and `user_roles`) at once, and Safari/iOS aborts in-flight fetches when the tab is backgrounded, the app is reloaded, or the network flips. Supabase surfaces the abort as `TypeError: Load failed` with empty `code`/`details` — which is why profile+roles always appear as a matched pair, same millisecond, same stack frame, Safari-only. It is a transient network abort, not a data or permission bug, but today it is logged as `severity=error` and never retried.

- File: `src/contexts/AuthContext.tsx` (`fetchProfile`, `fetchRoles`)
- Fix: add a small retry helper (2 retries, 300ms/900ms backoff) around both calls; classify transient network failures (empty `code` + `Load failed`/`Failed to fetch`/`AbortError`) and log them at `warning` with `source='network'` instead of `error`, so real permission failures still surface.

### Cause 2 — `profiles.phone` has no index (cluster 6)

Verified: `pg_indexes` on `profiles` shows only the primary key, a `full_name` trigram index and `last_seen_at`. The WhatsApp chat identity lookup does `phone=in.(+91…, 91…, …)`, so Postgres seq-scans every profile **and** evaluates the `Staff read profiles in their branches` policy (four `EXISTS` subqueries against members/staff_branches/trainers/employees) per row — hence the statement timeout.

- Migration: `CREATE INDEX idx_profiles_phone ON public.profiles (phone) WHERE phone IS NOT NULL;` plus `idx_profiles_email` (same shape) since identity resolution also filters by email.
- Also index the RLS lookup columns the policy re-checks per row: `staff_branches(user_id, branch_id)`, `trainers(user_id)`, `employees(user_id)` where missing.
- File touched only if needed: `src/lib/contacts/resolveIdentity.ts` — cap variants and add `.limit(1)`.

### Cause 3 — over-wide member detail query (cluster 3)

`MemberProfileDrawer` selects `members.*` plus six nested embeds (`profiles`, `lead`, `branch`, `created_by_profile`, `memberships → membership_plans`, `member_pt_packages → pt_packages + trainers`, `referrer`). PostgREST resolves each embed as a separate correlated query, and each one re-runs the profiles RLS policy. Combined with the same missing indexes as Cause 2, the request exceeds the statement timeout.

- File: `src/components/members/MemberProfileDrawer.tsx` (query at ~line 713)
- Fix: replace `*` with the explicit column list the drawer actually renders, and split the two heavy embeds (`member_pt_packages` and `memberships`) into their own lazily-enabled queries keyed on the open tab. Keeps one fast primary request and defers the rest.

Shared: Causes 2 and 3 both hinge on the profiles RLS policy cost, so the index migration fixes part of cluster 3 as well.

## Part B — Template Manager redesign

Current state: `CommunicationTemplatesHub` nests tabs inside tabs (4 channel tabs → up to 5 sub-tabs), `TemplateManager` is a single 1521-line component that renders a *third* tab row plus three sheets, and a separate "AI Studio" tab duplicates the AI button already present in every channel hero. Three stacked tab rows is the core confusion.

Redesign:

1. **One level of navigation.** Channel becomes a segmented control in the page header (WhatsApp / SMS / Email), not a tab row. The AI Studio tab is removed — "AI Generate" already lives in each channel hero.
2. **Workbench layout** per channel: left rail of section links (Templates · Coverage · Meta Approved · Automations · Routing — only those valid for the channel), right pane content. Sections that don't apply to SMS/Email simply don't render.
3. **Template list as a real data table** instead of stacked cards: columns Name · Trigger event · Status (badge) · Meta status · Last updated · Actions, with sticky header, search, status filter, row hover, skeleton loading, empty state with CTA.
4. **Health strip** at the top of each channel: counts for Active / Draft / Meta pending / Events uncovered, each chip filtering the table — this is what tells staff at a glance what needs attention.
5. **Split the file**: extract `TemplateTable.tsx`, `TemplateEditorSheet.tsx`, `MetaSubmitSheet.tsx`, `TemplatePreviewSheet.tsx` out of `TemplateManager.tsx`; the parent keeps data fetching and state only. No behaviour change to save/submit/preview logic.

All styling stays on the project's Vuexy tokens (rounded-2xl, soft shadows, semantic colours) — no new palette.

## Technical notes

- One migration: indexes only, no schema or policy change.
- No change to `dispatch-communication` or any template send path; this is a presentation refactor plus query/index tuning.
- Workout rotation UI (your earlier item 1) is **not** in this plan — say the word and I'll plan it separately.
