# My Requests — 2026 redesign (member portal)

Rebuild `/my-requests` as a single, modern request console: one unified composer drawer instead of six separate cards each with its own sheet, plus a proper status timeline.

## What's wrong today

- Six near-identical cards, each with its own trigger + its own drawer. Repetitive, tall, and visually flat.
- Every card looks equally important; nothing reflects the member's actual state (frozen, no trainer, no locker, plan assigned).
- Request History is a plain stack of bordered cards with a date and a badge — no timeline, no filtering, no per-request detail.
- Diet/Workout requests create trainer tasks, so they never appear in history at all — the member gets no confirmation trail.

## New layout

```text
┌──────────────────────────────────────────────────────────┐
│  HERO: My Requests            [ + New request ]          │
│  2 open · 1 approved this month · avg response 1 day     │
├──────────────────────────────────────────────────────────┤
│  Status strip: Membership Active · Trainer — · Locker —  │
├───────────────────────────┬──────────────────────────────┤
│  Request something        │  Activity                    │
│  ▸ Freeze membership      │  ● Locker request  Pending   │
│  ▸ Request a trainer      │  ● Trainer change  Approved  │
│  ▸ Request a locker       │  ● Freeze          Rejected  │
│  ▸ Diet plan              │       (timeline, filterable) │
│  ▸ Workout plan           │                              │
└───────────────────────────┴──────────────────────────────┘
```

- **Hero card** — gradient primary band with the member's open-request count and quick stats, plus one primary "New request" button.
- **Context strip** — small chips showing membership status, trainer, locker, and active plans, so the member sees why an option is or isn't offered.
- **Request launcher** — a single card listing the available request types as tappable rows (icon badge, title, one-line description, right chevron). Unavailable ones stay visible but muted with a reason ("Your plan doesn't include freeze days", "Request already pending").
- **Activity timeline** — replaces the history card list: vertical timeline with status dot, type, submitted date, reason snippet, and staff response. Filter tabs: All / Pending / Approved / Rejected. Empty state with an illustration-style icon and a CTA into the launcher.

## One composer drawer

A single right-side `Sheet` (`RequestComposerDrawer`) replaces all five drawers:

1. **Step 1 — pick type** (skipped when opened from a specific row): grid of request types with icons and eligibility notes.
2. **Step 2 — details**: type-specific fields.
   - Freeze / Unfreeze: reason + remaining freeze-day allowance shown inline.
   - Trainer: adapts to assignment state (assign vs change) and shows the current trainer.
   - Locker: preferred size (Small/Medium/Large chips) + note.
   - Diet / Workout: goals/preferences note.
3. **Sticky footer**: Cancel + Submit with in-button spinner; success toast and the new item animating into the timeline.

Sticky header with title and context, scrollable body, sticky footer — matching the project's drawer standard.

## Behaviour kept as-is

Same submission targets as today: freeze/unfreeze/trainer/locker write to `approval_requests`; diet/workout create trainer tasks. Same eligibility rules (freeze only when the plan allows freeze days, one pending request per type).

## Additional improvement

Diet and workout requests will also be reflected in the timeline by reading the member's own plan-request tasks alongside approval requests, so every request the member makes has a visible status. Read-only — no new writes.

## Technical notes

- New components under `src/components/member/requests/`: `RequestsHero.tsx`, `RequestLauncher.tsx`, `RequestComposerDrawer.tsx`, `RequestTimeline.tsx`.
- `src/pages/MemberRequests.tsx` becomes a thin composition page; all mutations move into the composer drawer (unchanged logic, same query invalidations).
- Timeline data = existing `approval_requests` query + a member-scoped `tasks` query filtered to their own plan requests.
- Styling stays on the project's tokens (Vuexy: `rounded-2xl`, soft shadows, indigo/violet accents, lucide icons, colored status badges). Skeletons for loading, empty and error states on both panels.
- Responsive: two columns at `lg`, stacked on mobile with the launcher first; drawer goes full-width under `sm`.
- No database or business-logic changes.
