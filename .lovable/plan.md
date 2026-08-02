# Fitness Create + PT Sessions — UX Audit & Redesign

Two surfaces, one goal: make plan creation and PT operations task-first instead of navigation-first. Design tokens stay locked to the Vuexy system (Indigo/Violet, Inter, rounded-2xl, soft slate shadows). What changes is composition, hierarchy, density and workflow.

## Part 1 — /fitness/create

### What the audit found (verified in `src/pages/fitness/CreateModePicker.tsx`)
- **Four competing entry points for the same job.** Hero has "Start with AI" + "Build manually"; the mode cards repeat both; the secondary links repeat Templates and Member Plans, which are already in the pipeline strip above. Five ways to reach two destinations.
- **No member context.** The page never asks who the plan is for. `MemberSearchPicker.tsx`, `MemberProfileCard.tsx` and `RecentPlansCard.tsx` exist in `src/components/fitness/create/` but are not rendered on this page, so every flow starts cold and the AI screen re-asks for the member.
- **Pipeline strip is decorative.** Counts link out but never tell you whether you're ready to build — e.g. 0 meals means diet plans will be empty, and nothing says so.
- **No history.** No view of what was recently created or which plans are expiring, so re-issuing a plan means walking the whole flow again.
- **Templates are invisible here.** `Templates.tsx` holds reusable plans, but the create page offers no "start from template" path — the most common real-world action.
- **Gap for diet plans.** Manual diet entry is a small tile with the same weight as workout, even though diet needs the meal catalog to be populated first.

### Redesign
1. **Single decision surface.** Hero becomes a slim context bar (title + branch + one "New plan" affordance). The two mode cards become the only primary CTAs. Drop the duplicate secondary links.
2. **"Who is this for?" first.** An optional member picker at the top of the page using the existing `MemberSearchPicker`. On selection, show `MemberProfileCard` (age, weight, BMI, goal, active plan) and carry `memberId/memberName/memberCode` into both AI and manual routes as URL params so the next screen is pre-filled.
3. **Readiness strip instead of counts.** Each pipeline tile gains a state: ready (green check + count), needs attention (amber + "Add meals" action), empty (indigo CTA). Diet creation shows an inline warning when the meal catalog is empty.
4. **Three creation paths, not two.** AI · From template · Manual. The template path opens a template picker sheet filtered by goal and type, then jumps into the editor pre-loaded.
5. **Recent activity row.** Last 5 assignments from `fetchMemberAssignments` with "New plan for this member" quick actions and expiry badges.
6. **Workout/diet parity.** Both manual tiles get equal weight, each with type-specific hints, a "start from template" secondary link and last-used counts.

## Part 2 — /pt-sessions

### What the audit found (verified in `src/pages/PTSessions.tsx`, 1147 lines)
- **One monolithic page** holding KPI cards, two charts, three tabs (Packages / Active Packages / Sessions), a pending-payment table, a schedule sheet and CSV export — all in a single file with `any`-typed rows.
- **Buried session workflow.** Sessions are the page's name but live in the third tab, below a package catalog and charts. A trainer's actual daily job (who is coming today, mark complete) is 2 clicks deep.
- **Pending payments as an amber table** competes visually with the primary content instead of reading as an alert strip.
- **Dense tables with no sort, no search, no pagination** on Active Packages, and progress rendered as raw text rather than a compact ring/bar.
- **Charts before actions.** Package-type split and revenue-by-trainer occupy the top viewport, pushing operational work below the fold.

### Redesign
1. **Reorder for the job.** Top: compact KPI row (active clients, sessions today, sessions this week, revenue). Then "Today's sessions" as the default view with inline Complete / Cancel / Reschedule. Charts move to a collapsible "Insights" section below.
2. **Tabs become: Today · Clients · Packages · Insights.** Sessions get first position; the package catalog moves last since it changes rarely.
3. **Pending payments as an alert banner** (amber strip, count + "Review" action) that opens a sheet, not an inline table.
4. **Client rows upgraded.** Avatar + name + code, package chip, a progress ring showing sessions used vs total, expiry with a days-left badge, and a single overflow menu for Schedule / Renew / Cancel invoice.
5. **Table utilities.** Search by member/trainer, sort on progress and expiry, "Showing X of Y" with pagination, skeleton loading rows, and proper empty states per tab.
6. **Split the file** into `src/components/pt/` sections (KPIs, TodaySessions, ClientsTable, PackagesGrid, InsightsPanel) so each stays reviewable.

## Technical notes
- No schema or RPC changes. All work is presentation + routing params.
- Keep every mutation on the existing hooks in `usePTPackages.ts` and services in `fitnessService.ts`; no new data writes.
- All new queries go through TanStack Query with `branch_id` scoping and RBAC gating identical to today (`can.*` / `hasAnyRole`).
- Reuse the already-built but unmounted `MemberSearchPicker`, `MemberProfileCard`, `RecentPlansCard`, `PipelineTile`, `ManualTile` components rather than creating parallel ones.
- Replace `any` row types in the PT page with typed interfaces as sections are extracted.
- Accessibility: 44px targets, aria-labels on icon buttons, visible focus rings, tokenised colors only.
