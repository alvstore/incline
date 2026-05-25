## Replace dashboard widget: "Growth Pulse" (2026 design)

Scope: ONLY `src/components/dashboard/JoinedSummaryStrip.tsx`. Same props (`branchFilter`), same data source (`members.created_at` counts), same export name so `Dashboard.tsx` keeps working. No layout, query, or business-logic changes elsewhere.

### Why the current widget fails
- Four equal vertical tiles waste horizontal space at 1113px, causing the cramped "tall column" look.
- Heavy gradient glows + "NEW" chips + grid texture compete for attention while the actual numbers are all zero.
- It's a KPI strip pretending to be a hero — no comparison, no trend, no context.

### New widget: "Growth Pulse — New Members"
A single unified card (not 4 separate tiles) that's far more relevant for a gym SaaS dashboard:

```text
┌────────────────────────────────────────────────────────────────┐
│ NEW MEMBERS                          [ Today · 7D · 30D · YTD ]│
│                                                                │
│  24            ▲ +18% vs prev period                           │
│  this month                                                    │
│                                                                │
│  ╭──── sparkline (last 14/30 days, area chart) ────╮           │
│                                                                │
│ ─────────────────────────────────────────────────────          │
│ Today  1   ·  7D  6   ·  30D  24   ·  YTD  142                 │
└────────────────────────────────────────────────────────────────┘
```

Key elements:
1. **Segmented period switcher** (top-right) — Today / 7D / 30D / YTD. Default = 30D. Pill style, `rounded-full bg-muted p-1`, active pill `bg-background shadow-sm`.
2. **Hero number** — large `text-4xl md:text-5xl font-bold tabular-nums` for the selected period, with delta chip (`+18%` green / `-5%` red / `—` neutral) vs previous equivalent window.
3. **Sparkline** — small area chart using Recharts (already in project), 60px tall, showing daily signups across the selected window. Gradient fill from `primary` to transparent. No axes, no grid — just the curve.
4. **Compact summary row** — bottom strip with all 4 periods shown as inline `label · value` pairs so nothing is hidden when one is selected. Clickable to switch period.
5. **Branch-aware** — uses `branchFilter` exactly like today.

### Visual language (Vuexy 2026)
- Container: `rounded-2xl bg-card ring-1 ring-border/60 shadow-lg p-5`
- Single subtle gradient halo top-right (indigo → violet), no per-tile glows
- Inter font, `tabular-nums` on all numbers
- Delta chip: `rounded-full px-2 py-0.5 text-xs font-semibold` with `bg-emerald-100 text-emerald-700` / `bg-red-100 text-red-700` / `bg-slate-100 text-slate-600`
- Segmented control: matches the WEEKLY/MONTHLY/YEARLY pill used elsewhere on the dashboard for consistency
- No emojis, lucide-react only (`Sparkles` for header icon, `TrendingUp` / `TrendingDown` for delta)

### Responsive
- ≥768px: header row (title + segmented) on one line, hero + sparkline side-by-side (`grid-cols-[auto_1fr]`)
- <768px: stacked — title, segmented below, hero, sparkline full-width, summary row wraps
- Summary row uses `flex flex-wrap gap-x-4 gap-y-1` so it never overflows at 1113px

### Data
- One `useQuery` keyed `['growth-pulse', branchFilter]` that fetches the last 365 daily signup counts via a single grouped query (`select created_at` filtered to YTD, then bucketed client-side). Avoids 4 round-trips and gives data for the sparkline + all 4 period totals + previous-period deltas in one shot.
- Falls back gracefully when count is 0 (shows "0" + "No new members in this window" muted helper).

### Out of scope
- `Dashboard.tsx`, other widgets, sidebar, theming tokens, business logic
- No new dependencies (Recharts already in the project)

Used the `ui-ux-pro-max` skill for the redesign direction.
