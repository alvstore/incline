# Approvals page redesign (motion + workflow)

Styling, layout and motion only. Approve/reject logic, locker approval drawer, referral and PT correction paths, realtime refresh and permissions stay exactly as they are.

## What you will see
1. **Header**: animated page title (letters rise in), with live summary text such as "6 waiting · oldest 2 days".
2. **Stat strip**: Pending, Approved today, Rejected today, Oldest waiting. Numbers count up, and cards slide in one after another. Tapping a stat switches to that tab.
3. **7-day decisions chart**: a small striped bar chart showing approved and rejected requests per day. Today's bar is highlighted, bars grow from the bottom, and a text summary is included for screen readers.
4. **Filter bar**: search, plus type chips that scroll sideways on mobile (replacing the dropdown). Each chip shows a count. Tabs get the sliding pill highlight.
5. **Queue as a split view**:
   - Desktop: a list of compact request rows on the left (type icon, member avatar and initials, summary, how long it has waited, urgency dot). The selected request opens in a detail panel on the right with full details, a notes field and sticky Reject/Approve buttons.
   - Mobile: rows only. Tapping a row opens the same details in a bottom sheet, following the No-Dialog rule.
   - Keyboard: J/K moves between requests, A approves, R opens reject. Reject requires a short note so every decision is recorded.
6. **After a decision**: the row slides out, the next request opens automatically, and a toast offers a short "Undo". Undo only delays sending the decision for about 5 seconds, so nothing is reversed after it is saved.
7. **Empty, loading and error states**: a placeholder that matches the page layout while loading (no shimmer), an "All caught up" illustration when the queue is empty, and an error card with Retry.

## Motion (from the knowledge base, using GSAP, with Incline colours)
- Cards: fade, rise 26px and settle from scale .985 over .8s (expo.out), staggered .06s.
- Rows: fade and rise 12px over .55s (power3.out), staggered .04s.
- Title letters: .85s (power4.out), staggered .022s. Count-ups: 1.2s (power3.out).
- Chart bars: grow from the bottom over 1s (expo.out), staggered .04s.
- Detail panel: slides in over .6s (expo.out), with its contents staggered.
- Row removal: shrinks and fades over .18s (power2.in), then the list reflows smoothly (Flip).
- Hover lift only on mouse devices. With reduced motion, everything jumps straight to its final state.
- Live updates never replay the page entrance animations.

## Technical section
- Split `src/pages/ApprovalQueue.tsx` into `src/components/approvals/`: `ApprovalStats`, `ApprovalTrendChart` (custom SVG/CSS bars, no new chart library), `ApprovalFilters`, `ApprovalRow`, `ApprovalDetailPanel` (shadcn Sheet on mobile), and `approvalMotion.ts` (scoped `gsap.context` hooks with `prefers-reduced-motion` handling).
- New query: approved and rejected counts per day for the last 7 days, read by `reviewed_at` and scoped to the branch. It is aggregated in the browser from a 7-day id/status/reviewed_at select, so the payload stays small. Each type chip's count comes from the current list.
- Undo: a delayed `mutate` call that cancels if Undo is pressed. The mutation function itself is unchanged.
- Semantic tokens only (success, warning, destructive, primary, muted). Clickable rows follow `clickable.ts`. Both themes are checked at 1440, 1024 and 390px with Playwright.
- `gsap` is already installed. Flip comes from `gsap/Flip`.
