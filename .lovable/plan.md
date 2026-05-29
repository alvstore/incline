## 1. Bug: "Show Inactive" toggle does nothing

**Root cause:** `src/services/ptService.ts` (line 29) hardcodes `.eq("is_active", true)` in `fetchPTPackages`. The client-side filter in `PTSessions.tsx` is meaningless because inactive packages never arrive from the server.

**Fix:**
- Update `fetchPTPackages(branchId?, opts?: { includeInactive?: boolean })` to drop the `is_active=true` filter when `includeInactive` is true.
- Update `usePTPackages(branchId, includeInactive)` to pass the flag and include it in the query key (`['pt-packages', branchId, includeInactive]`) so toggling refetches.
- In `PTSessions.tsx`, pass `showInactive` to the hook. Keep the client-side filter as a safety net.

## 2. Redesign package cards (description + layout)

Scope: the `PTPackageCard` block inside `src/pages/PTSessions.tsx` (currently a tall card with wall-of-text description and a 3-cell mini grid at the bottom).

**Problems in the screenshot:**
- Description is a flat 3-line clamp ending in "…" — users can't see Coaching Frequency, Nutrition, Recovery, etc.
- The text is one paragraph stored in `description` containing pseudo-headings like "Coaching Frequency:", "Nutrition:", "Recovery:" separated by ". " — natural breakpoints exist but aren't parsed.
- 3-column "MONTHS / PRICE / VALIDITY" footer reads like a spec sheet, not a product card.

**Redesign (no schema changes):**
- Parse description into feature bullets at runtime: split on `/\.\s+(?=[A-Z][a-zA-Z ]{2,30}:)/` then render each "Label: value" segment as a row with a small lucide icon (Dumbbell / Utensils / Heart / Moon / Calendar). Fall back to a clamped paragraph if no labeled segments are found.
- Card body becomes: gradient ribbon (tier color), tier+type badge row, title, 3–5 feature rows (icon + label + value, `text-sm`, full text, no clamp), divider, then a single horizontal stat row: price (large `text-2xl`), duration pill, validity pill.
- Card actions (Edit, Toggle active/inactive) stay top-right, visible on hover for desktop, always visible on mobile.
- Inactive packages get a `opacity-60` overlay + an "Inactive" badge in the ribbon.
- Grid stays `md:grid-cols-2 xl:grid-cols-3`, cards become equal-height via `flex flex-col` with stats pinned to bottom (`mt-auto`).
- Vuexy tokens: `rounded-2xl border-0 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-500/10 transition-all`.

Out of scope: editing the `description` field itself or adding a structured features column to the DB. Parsing handles existing data; new packages can continue using the same free-text format.

## 3. Rename sidebar entry

Rename `"PT Sessions"` → `"PT Packages"` (concise; matches the actual content of the page, which is package management + sessions). Update in `src/config/menu.ts` at lines 77, 127, 190, 268 (owner/admin/manager/staff/trainer entries that link to `/pt-sessions`). Leave the member-facing label at line 42 (`/my-pt-sessions`) as **"My PT Sessions"** since for members it really is the sessions view.

Route path `/pt-sessions` stays unchanged (no broken links, no SEO churn). Page H1 stays "Personal Training Packages" as set in the previous redesign.

## 4. Audit: per-session vs monthly handling

This is a read-only audit deliverable. I'll inspect the following and write findings into `.lovable/plan.md` under a new "PT Package Model Audit" section:

- **Schema:** `pt_packages.package_type` enum values (`session_based` vs `monthly`), `session_type`, `total_sessions`, `duration_months`, `validity_days` — confirm which fields are authoritative for each type and where they diverge.
- **Selling / purchase:** `purchase-pt-package` flow + `record_payment` RPC — how `member_pt_packages` is seeded for each type (sessions_total, expiry_date math).
- **Attendance / consumption:** how `pt_sessions` decrement `sessions_remaining` for session-based vs how monthly packages handle session count (do they cap? log only?). Cross-check `useCompletePTSession` and trainer earnings calc.
- **Expiry & renewal:** monthly = `expiry_date` driven; session-based = `sessions_remaining == 0` driven. Confirm both paths exist and which UI surfaces them (MyPTSessions, TrainerDashboard, retention nudges).
- **Reporting:** `package_type === 'monthly'` vs `sessions_total > 0` checks in analytics — current code mixes both heuristics; flag inconsistencies.
- **UI mismatches:** badges, validity display, edit drawer field mapping (already partially fixed earlier).

Output is a written audit with file:line citations and a numbered list of any inconsistencies found, plus recommended follow-up tickets. **No code changes from the audit in this loop** — fixes go in a follow-up after you review.

## Files to change

- `src/services/ptService.ts` — `fetchPTPackages` signature
- `src/hooks/usePTPackages.ts` — pass `includeInactive`, expand query key
- `src/pages/PTSessions.tsx` — pass flag to hook, redesign card block, parse description into feature rows
- `src/config/menu.ts` — relabel 4 entries
- `.lovable/plan.md` — append PT Package Model Audit section

## Out of scope

- Backend schema changes
- Editing existing package descriptions
- Member-facing PT pages (`/my-pt-sessions`)
- Route renames
