# Unify UI on shadcn + Incline tokens, and clean up unused code

## Goal
Every internal screen uses the same building blocks (shadcn components + Incline semantic tokens from `docs/design-system.md`). Light and dark mode both look right, and nothing changes in how screens work. Unused packages and files are removed so the project is easier to maintain.

## Guardrails (no behaviour changes)
- Only styling and markup change: no data, server function, permission or business logic edits.
- Same handlers, props, `aria-*`, `data-testid` and keyboard behaviour kept on every element we touch.
- Public website (`/`, marketing pages, dumbbell scene, `lux-*` styling) is left as is. It is intentionally separate.
- "No Dialog" forms rule kept: data entry stays in right-side Sheets.
- Work in small batches by area, each checked before moving on.

## Phase 1: Re-measure (before any edits)
- Re-count hardcoded colours (`bg-white`, `slate-*`, `indigo-*` shadows, hex values), raw `<button>` usage and custom badge pills, grouped by folder.
- Find unused packages (`knip`/`depcheck` plus a manual `rg` check for each candidate, including dynamic imports, edge functions, scripts and the service workers).
- Find unused files: components, hooks, pages and libs with no importers. Router lazy imports, `docs/`, tests and `public/` assets are cross-checked.
- Output: an inventory, so deletions are evidence-based.

## Phase 2: Token replacement (mechanical, safe)
Map per `docs/design-system.md`:
- `bg-white` → `bg-card`
- `bg-slate-50/100` → `bg-muted`
- `text-slate-900/800` → `text-foreground`
- `text-slate-500/600` → `text-muted-foreground`
- `border-slate-200` → `border-border`
- indigo/colored glow shadows → design-system soft shadow
- status colours → existing success/warning/destructive tokens

Missing tokens are added to `index.css` + `tailwind.config.ts` (never hardcoded). Order: shared widgets first, then Attendance/Devices, Marketing/Audience, Members, Finance, Settings, then the rest.

## Phase 3: Component standardisation
- Raw action `<button>` → shadcn `Button` (correct variant/size). Icon-only buttons get an `aria-label`, and primary mobile taps get ≥44px targets.
- Custom tab pills → `Tabs` or `ToggleGroup`. Custom status pills → `Badge` variants (add variants such as `success`/`warning` via cva if missing).
- Hand-rolled card divs → `Card`.
- Leave raw buttons where they're structurally needed (e.g. inside Radix triggers using `asChild`, table cell wrappers), but give them focus rings.

## Phase 4: Cleanup
- `bun remove` confirmed-unused packages, one group at a time.
- Delete confirmed-unused files. Anything ambiguous is listed in the final reply instead of being deleted.
- Add a short UI rule to `AGENTS.md`: shadcn primitives + semantic tokens only in the app shell. Optionally add a lint/CI grep guard against `bg-white`/`slate-*` in `src/components` and `src/pages` (excluding the public site).

## Accessibility pass (alongside Phases 2–3)
- Labels on inputs, `aria-label` on icon buttons, visible focus, contrast via tokens, a live region for toasts.
- Deliverable: a checklist table (issue | location | fix | severity).

## Analytics
No new tracking is added. If a central `track()` helper exists, touched buttons keep their existing calls unchanged. Nothing is renamed and no health or personal data is added.

## Verification
- Build log clean after each batch, plus the existing test suites (`bun test` / vitest files in the project).
- Playwright (incline-e2e skill): signed in as owner, run the smoke recipes (login → member search, purchase/payment drawer, campaign wizard, member booking). Screenshot key pages in light and dark at 1280 and 390, comparing before and after for broken layouts and console errors.
- Report: what changed, packages and files removed, items left untouched and why.

## Scope note
This is a large, multi-batch change across roughly 150–200 files. Batches land area by area so any regression is easy to spot and revert.
