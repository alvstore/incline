# PT Sessions Page Redesign — 2026 Premium

## Audit (current issues)

1. **Title**: "PT Sessions" — feels operational, user wants "Personal Training Packages".
2. **Package cards**: Description text is wall-of-text grey; "Per Session" badge is misleading for monthly packages (only fixed in edit drawer, badge still maps wrong on listing); Sessions row shows `0` for monthly which looks broken; no visual hierarchy between price / validity / sessions.
3. **Top Performer card**: Decoration blob is weak, layout is cramped, revenue and clients sit awkwardly side by side, no trendline / sparkline, empty state is bare grey text.
4. **Package Type Split**: Pie chart with default recharts labels overflows on narrow widths, low data-ink ratio, no center total, empty state plain.
5. **Revenue by Trainer**: Single flat primary bar, no avatars, no rank, no totals, no comparison context.
6. **Session Status Distribution**: Redundant card taking full row — same chart pattern as type split, low value.
7. **Stats KPIs**: 4 tinted cards are fine but flat — no deltas, no spark, no micro-context.
8. **Empty states**: "No packages", "No active packages", "No revenue data" — all plain grey strings, no illustration / CTA / icon.

## Scope

Frontend / presentation only. No business-logic, hook, or DB changes. Two files touched.

## Changes

### `src/pages/PTSessions.tsx`

**Header**
- Rename H1 → "Personal Training Packages".
- Subhead → "Design, sell and track every 1-on-1 coaching package across your branches."
- Add a soft branded eyebrow chip ("Coaching Studio") above the H1 for the 2026 editorial vibe.

**KPI row (4 cards)** — keep grid, upgrade visuals
- Move to true Vuexy cards: `rounded-2xl bg-white shadow-lg shadow-slate-200/50 border-0`.
- Tinted icon badge top-left in a soft circle (indigo / emerald / amber / sky), value `text-3xl font-bold text-slate-900`, label `text-xs uppercase tracking-wider text-slate-500`, micro-context line at the bottom (e.g. "Across {n} trainers", "Today", "Last 7 days").
- Subtle hover lift (`hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-200`).

**Analytics row** — redesigned
1. **Top Performer** (col-span 1)
   - Hero gradient card `bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600` white text, rounded-2xl, soft inner ring.
   - Avatar circle with initials (right side, semi-transparent ring), `Crown` badge floating top-right.
   - Big trainer name, "Top performer this period" eyebrow, then two stat pills inline: Revenue (₹ formatted) + Clients, both on translucent white chips.
   - Mini sparkline-ish bar row (3 thin bars representing share vs #2 and #3 trainers) so it never looks empty even with 1 trainer.
   - Empty state: Crown icon in soft circle + "No active packages yet" + small "Create your first package" link button.

2. **Package Type Split** (col-span 1)
   - Keep donut. Replace overflowing pie labels with a clean centered total (`{total} packages` inside the ring).
   - Below the donut: two legend rows with colored square + label + count + % bar — more like a 2026 dashboard cell than a chart toy.
   - Colors: Session-Based `hsl(var(--primary))` (indigo), Duration-Based `hsl(258 90% 66%)` (violet) — keep the split distinguishable.
   - Empty state: small package icon, "No packages yet", subtle.

3. **Revenue by Trainer** (col-span 1)
   - Replace recharts BarChart with a **ranked list** (top 5): rank chip (#1 gold, #2 silver, #3 bronze, rest slate), avatar/initials circle, trainer name, client count subline, right-aligned revenue ₹ value + thin proportional progress bar underneath using indigo→violet gradient.
   - Footer micro-row: "Total revenue: ₹X" small text.
   - Empty state: TrendingUp icon + "Revenue will appear once packages are sold".

**Session Status Distribution**
- Demote from full-width card to a compact strip: 3 inline status pills (Completed / Scheduled / Cancelled) with count and a single stacked horizontal bar showing the split. Cuts visual weight; data is preserved.

**Packages tab**
- Toolbar row gets the Vuexy treatment: rounded-xl surface, switch + label on left, Create button on right (keep gradient indigo→violet, already in design system).
- **Package card** redesign (the main complaint):
  - Card: `rounded-2xl border-0 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-200 overflow-hidden relative`.
  - Top ribbon strip (`h-1.5`) with package-tier-inferred gradient (Silver = slate→zinc, Gold = amber→yellow, Platinum = violet→indigo, default = indigo→violet — inferred from `pkg.name` keywords, falls back to default).
  - Header: tier badge (Per Session / Monthly / Quarterly / Custom) as a soft pill on the left; action icons (Edit + activate/deactivate) move into a single right-aligned cluster with hover-only reveal on desktop, always visible on mobile.
  - Title row: `Package` icon in a tinted circle + package name `text-lg font-bold text-slate-900`.
  - Description: clamp to 3 lines with `line-clamp-3 text-sm text-slate-600 leading-relaxed`, fade-out gradient at bottom; full text on hover via tooltip.
  - **Fix monthly vs session display**:
    - If `session_type === 'monthly' || total_sessions === 0` → hide the "Sessions: 0" row and show "Duration: {validity_days/30} months" instead.
    - Tier badge text uses the same logic (Monthly → "Monthly Plan", session_based → "Session Pack").
  - Stats footer: 3 mini-stat cells in a `grid-cols-3` with thin dividers — Sessions (or Months) · Price · Validity. Price uses `text-xl font-bold` with `IndianRupee` icon.
  - Inactive state: soft slate overlay + "Inactive" pill badge top-right.
- Empty state: replace plain card with friendly empty state — `Package` icon in tinted circle, headline, subtext, primary CTA.

**Active Packages tab**
- Wrap the table in a `rounded-2xl bg-white shadow-lg shadow-slate-200/50 overflow-hidden` card.
- Sticky header `bg-slate-50/80 backdrop-blur`, member name with avatar initials chip, progress bar already exists — keep.
- Empty state: Users icon + headline + subtext + "Schedule Session" CTA.

**Sessions tab**
- Same card wrap + empty state polish.
- Action buttons get tinted hover (`hover:bg-emerald-50 text-emerald-600` for complete, `hover:bg-red-50 text-red-600` for cancel) and `aria-label`s.

### `src/components/pt/AddPTPackageDrawer.tsx` & `EditPTPackageDrawer.tsx`
- No behavior change. Only minor: ensure the badge written to listing is consistent. Already fixed `session_type='monthly'` in edit drawer in prior turn. Verify Add drawer does the same (read first, only patch if needed).

## Technical notes

- All colors via Tailwind tokens / `hsl(var(--...))` — no raw hex outside the gradient ribbons (which are direct Tailwind utility classes, brand-safe).
- Tier inference helper: `function inferTier(name: string): 'silver'|'gold'|'platinum'|'default'` — pure string match on lowercased name.
- Avatar initials helper: 2-char from name, deterministic bg color from a tiny palette hash.
- No new dependencies; reuse `recharts` for the donut, drop BarChart for the ranked list.
- All clickable elements keep `cursor-pointer`, `focus:ring-2 focus:ring-indigo-500`, 44px min touch targets.
- Responsive: KPI grid `md:grid-cols-2 lg:grid-cols-4`, analytics row `md:grid-cols-1 lg:grid-cols-3`, package grid `md:grid-cols-2 xl:grid-cols-3`.

## Out of scope
- Hooks, queries, DB schema, drawer logic, routing.
- The route URL `/pt-sessions` stays (only H1/page title changes) to avoid breaking links/menus.

## Files touched
- `src/pages/PTSessions.tsx` (major)
- `src/components/pt/AddPTPackageDrawer.tsx` (verify session_type write — patch only if it sends `per_session` for monthly)
