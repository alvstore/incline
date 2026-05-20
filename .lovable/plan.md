## Scope

Redesign **only** the Communication Hub → **Live Feed** tab. Two pain points:

1. **Timeline loading/empty state looks broken** — the expanded row shows plain "Loading timeline…" text, then a row of dashed empty circles when no delivery events exist yet. Reads as a bug.
2. **Old triggers are unreachable** — `LiveFeed` hard-caps at the last 200 rows with no "Load more" / pagination, so anything older is invisible.

Out of scope: KPI strip, channel tabs, search, other Comm Hub tabs (Templates, Campaigns, etc.), backend tables, RLS.

---

## Files touched

- `src/components/communications/DeliveryTimeline.tsx` — redesign loading + empty states, polish track.
- `src/components/communications/LiveFeed.tsx` — add cursor pagination (Load older / page size selector), add row-level skeletons, refine empty state.

No new dependencies. No DB/RPC changes.

---

## Design direction (Vuexy + 2026 polish)

**Live Feed list**
- Replace plain "Loading…" with 6 shimmering skeleton rows (avatar pill + 2 text lines + status pill placeholder + timestamp) using existing `Skeleton` primitive — matches actual row geometry so layout doesn't jump.
- Footer bar (sticky inside the card, `border-t border-border/50 bg-muted/20`):
  - Left: "Showing N of M loaded · oldest: 14 Mar, 09:22"
  - Center: `Page size` segmented control — 50 / 100 / 200 (default 100).
  - Right: **Load older** button (`variant="outline"`, indigo ring on hover) — fetches next page by `created_at < oldestLoaded.created_at` and appends. Disables + shows "No older messages" when the returned page is short.
- Keep realtime: new INSERTs prepend to page 1; pagination state is independent of realtime cursor.

**DeliveryTimeline — loading state**
- Render the actual 5-stage skeleton scaffold (dashed rings + skeleton labels) inside the same `rounded-2xl` gradient card, with a subtle pulsing bar across the track. Feels like the real component is filling in, not "loading text appeared".

**DeliveryTimeline — empty/no-events state**
- When fetch completes with 0 events (very common for in-app / queued items), show a single compact stage row: small clock icon + "Awaiting delivery events" + relative time since `created_at`. No dashed-circle row of ghosts.

**DeliveryTimeline — happy path polish**
- Tighter spacing on mobile (`gap-1` instead of full justify-between when ≤ 380px).
- Subtle `motion-safe:animate-[pulse_2s_ease-in-out_infinite]` on the active stage dot's halo (kept lightweight, no Motion lib).
- Track gradient already good — leave as-is.

All colors via existing tokens (`bg-muted`, `bg-emerald-500`, `text-rose-600`, etc.) — no new design tokens.

---

## Pagination — technical detail

```text
state:
  pageSize: 50 | 100 | 200     (default 100, persisted to localStorage)
  pages: Log[][]                (array of page arrays, page[0] = newest)
  oldestCursor: string | null   (created_at of last row in last page)
  hasMore: boolean

query key:
  ['comm-live-feed', branchId, pageSize]   // page 1 only, realtime-subscribed

loadOlder():
  fetch from('communication_logs')
    .lt('created_at', oldestCursor)
    .order('created_at', desc)
    .limit(pageSize)
  append → pages; update oldestCursor; hasMore = rows.length === pageSize
```

The existing `nameMap` lookup is keyed off `logs` already; it will re-run when `pages` flatten changes — acceptable since it's batched and `staleTime: 60s`.

KPI counts (`KpiStrip`) continue to reflect **only loaded rows** (today's signal), matching current behavior — documented in a tiny info tooltip next to the count.

---

## Acceptance

- [ ] Expanding a row with no events shows a single compact "Awaiting delivery events" row, not a ghost timeline.
- [ ] Expanding a row mid-fetch shows a skeleton timeline, not plain text.
- [ ] "Load older" appends prior 100 rows; works across multiple clicks; disables at end.
- [ ] Page size selector persists across reloads.
- [ ] Realtime INSERTs still prepend within ~1s.
- [ ] No layout shift when loading completes (skeleton heights match real rows).
- [ ] Vuexy tokens only — no raw hex colors added.

Skill used: **ui-ux-pro-max** (Vuexy-locked composition guidance).
