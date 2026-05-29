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

---

## PT Package Model Audit — per-session vs monthly (2026-05-29)

Read-only audit of how the two plan types are defined, sold, consumed, and reported. No fixes applied; this section is the deliverable.

### Schema sources of truth

- **`pt_packages.package_type`** — catalog enum. Per migration history, valid values are `'session_based'` and `'monthly'` (the older `'duration_based'` literal still appears in some legacy RPCs — see Bug #1 below).
- **`pt_packages.session_type`** — UI-facing label only: `'per_session' | 'monthly' | 'quarterly' | 'custom'` (see `src/pages/PTSessions.tsx:34`). Drives the badge text. Not used by the purchase RPC.
- **`pt_packages.total_sessions`** — used for session-based; should be `0` for monthly.
- **`pt_packages.duration_months`** + **`validity_days`** — used for monthly expiry math. Both exist; only one is read at purchase time (see Bug #1).
- **`member_pt_packages.package_type`** — copied from catalog at purchase. This is what `complete_pt_session` reads (`supabase/migrations/20260517153957_…sql:66,70,84`).

### Selling / purchase flow

- Edge: `purchase_pt_package` RPC (`supabase/migrations/20260518143238_…sql:96-118`).
- For each row in `member_pt_packages` it sets:
  - `sessions_total` / `sessions_remaining` → `0` if `_package.package_type = 'duration_based'`, else `_package.total_sessions`.
  - `expiry_date` → `CURRENT_DATE + duration_months*30` if `'duration_based'`, else `CURRENT_DATE + validity_days`.
  - `package_type` copied verbatim from `_package.package_type`.

### Attendance / consumption

- `complete_pt_session` (`20260517153957_…sql:66-95`):
  - `'session_based'` + status in (`completed`,`late`,`absent`) → guard `sessions_remaining > 0`, decrement, auto-close package when reaches 0.
  - `'monthly'` + same statuses → guard `CURRENT_DATE <= expiry_date`. **Never decrements** — monthly is unlimited within window.
- Trainer earnings calc uses `price_paid` flat (see `src/services/ptService.ts:140-180`), agnostic to type. OK.

### Expiry & renewal surfaces

- Member portal `MyPTSessions` and `useMemberHasPtPackage` discriminate via `package_type` field on `member_pt_packages` (`src/services/ptService.ts:419-476`).
- Admin "Active Packages" table (`PTSessions.tsx:700-720`) discriminates via `pkg.sessions_total > 0` → progress bar; else date-based progress. Heuristic-correct but doesn't read `package_type` — relies on the RPC having correctly set `sessions_total=0` for monthly.

### Reporting heuristics (UI)

- `PTSessions.tsx:158-160`: `packageTypeSplit` uses `sessions_total > 0` (session) vs `=== 0` (duration).
- `PTSessions.tsx:886`: card badge uses `session_type === 'monthly' | 'quarterly' || total_sessions === 0`.
- These three heuristics (`package_type`, `session_type`, `sessions_total === 0`) are mostly consistent but not centralized.

### Issues found

1. **CRITICAL — purchase RPC checks a stale enum literal.**
   `purchase_pt_package` (`20260518143238_…sql:105,110`) branches on `_package.package_type = 'duration_based'`. After the recent fix, `AddPTPackageDrawer` and `EditPTPackageDrawer` write `package_type='monthly'` (the actual enum value). Result: monthly packages purchased today take the `ELSE` branches —
   - `sessions_total` / `sessions_remaining` set to `_package.total_sessions` (likely `0`, but if anyone enters >0 it will leak through),
   - `expiry_date` computed from `validity_days` (currently 30 because drawer derives `validity_days = duration_months*30`, so the visible result is correct **only by coincidence**).
   - `member_pt_packages.package_type` then stores `'monthly'`, which `complete_pt_session` handles correctly — but the purchase math is using the wrong branch and is one drawer change away from breaking.
   - **Recommended fix (follow-up):** update the RPC to test `_package.package_type IN ('monthly','duration_based')` (or just `<> 'session_based'`) and prefer `duration_months * 30` when present, falling back to `validity_days`.

2. **Heuristic sprawl.** Three independent discriminators (`package_type`, `session_type`, `sessions_total`) coexist in the UI. Recommend a single helper `isMonthlyPackage(pkg)` exported from `src/services/ptService.ts` and adopted by `PTSessions.tsx`, `MyPTSessions`, and `PtPackageBadge` to eliminate drift.

3. **`session_type` is purely cosmetic** but the EditPTPackageDrawer forces it to `'monthly'` whenever `isDurationBased`, hiding `'quarterly'` and `'custom'`. If quarterly is meant to be sellable, the drawer needs to expose it as a duration preset; otherwise drop `'quarterly'` from `SESSION_TYPES`.

4. **`duration_months` vs `validity_days` redundancy.** Catalog stores both; only one is used at purchase time. Consider deprecating `validity_days` for monthly packages or making it a generated column = `duration_months * 30`.

5. **No-show / cancellation accounting.** `complete_pt_session` decrements on `absent` for session_based — that's intentional but worth surfacing in the cancel UX so trainers know cancelling-as-absent consumes a session.

### Recommended follow-up tickets (not implemented in this loop)

- PT-AUDIT-1: Fix `purchase_pt_package` enum check (Critical).
- PT-AUDIT-2: Centralize `isMonthlyPackage()` helper + replace 3 heuristics.
- PT-AUDIT-3: Decide on `quarterly` / `custom` `session_type` — keep with full UI support, or remove.
- PT-AUDIT-4: Schema cleanup of `duration_months` vs `validity_days`.
