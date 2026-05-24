## Scope
Only `src/components/dashboard/JoinedSummaryStrip.tsx`. No other file touched, no data/logic change.

## Problem
At ~1100px the strip sits next to other content and each tile becomes a tall, narrow column. The big 4xl number + "members" word wraps and gets cut to "memb"; icon, NEW chip, number, and label stack vertically and look broken.

## Redesign (Vuexy-aligned, lucide-react only)

Switch from a vertical "hero tile" to a **compact horizontal KPI row** that scales gracefully:

- Container: same `rounded-2xl bg-card ring-1 ring-border/60 shadow-lg` shell, retain hover lift and gradient glow corner.
- Layout inside each tile: single horizontal flex — `[icon] [value + label stacked] [NEW chip top-right]`.
  - Icon badge: 9x9, gradient bg, rounded-xl, shrink-0.
  - Value: `text-2xl md:text-3xl font-bold tabular-nums`, no gradient clip (avoids clipping/blur at small size), `leading-tight`.
  - Sub-label: `text-[11px] font-medium text-muted-foreground truncate` — full label like "Joined Today".
  - Drop the redundant "members" word (value is self-explanatory; tooltip on hover via `title` keeps it).
  - NEW chip: absolute top-right, smaller (`text-[9px] px-1.5 py-0.5`), only show on `sm+` to save space.
- Padding: `p-3 sm:p-4` (was `p-4`).
- Grid: `grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3` — 2x2 on small/medium (including this 1113px viewport where the dashboard column is narrow), 1x4 only when there's real room.
- Keep gradient accent glow + grid texture for premium feel; reduce glow size to `h-24 w-24` so it doesn't dominate compact tiles.
- Skeleton height drops to `h-20 sm:h-24`.

## Result
- No text truncation ("memb" bug gone).
- Reads cleanly at 1113px (2x2) and on mobile (2x2 with tighter spacing).
- At ≥1024px (full-width dashboard), expands to 1x4 row.
- Same data, same query, same colors, same brand language.

## Out of scope
Dashboard layout, other widgets, query logic, branch filter, theming tokens.
