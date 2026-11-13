# Tasks page: same look and motion as Approvals

The Tasks page keeps everything it does today: the board, list and calendar views, drag to move, assigning, adding a task, the task detail drawer, printing, filters and live updates. Only the look, the motion and a few workflow touches change.

## What you will see
1. **Header**: the "Tasks" title letters rise in. The summary line shows live counts, for example "42 open · 5 overdue · 8 due today".
2. **Stat cards**: Open, In progress, Overdue, Done today and My open, in the same card style as Approvals. Numbers count up, cards rise in one after another, and they lift slightly on mouse hover. Tapping a card applies its filter.
3. **Tasks finished, last 7 days**: the same striped bar chart as Approvals, showing completed tasks per day with today highlighted. A short text summary is included for screen readers.
4. **Filter bar**: search, the Board/List/Calendar switch as rounded tabs, and quick filter chips with counts (All, Mine, Today, Overdue, High, Unassigned). The chips scroll sideways on phones.
5. **Board**:
   - Columns get soft card styling with a count in each header.
   - Task cards rise in on load and when you change filter or view.
   - When a task moves to another column, the cards slide smoothly into their new places instead of jumping.
   - Each card has an urgency dot: red when overdue, amber when due today, green otherwise.
6. **List**: rows rise in one after another, with the same urgency dots, and the selected row is highlighted.
7. **Mark done with Undo**: marking a task Done shows "Undo" for 5 seconds before it is saved. This matches Approvals.
8. **Keyboard (desktop)**: J/K moves between tasks, Enter opens a task, D marks it done, N creates a new task.
9. **Loading, empty and error states**: a placeholder that matches the page layout while loading (no shimmer), an "All clear" message when nothing matches, and a Retry button if loading fails.
10. **Task drawer**: the drawer's contents fade in one after another when it opens. The drawer itself and its forms are unchanged.

## Motion (the same timings as Approvals)
- Cards: rise 26px over .8s (expo.out), staggered .06s.
- Rows and task cards: rise 12px over .55s (power3.out), staggered .04s.
- Title letters: .85s (power4.out). Count-ups: 1.2s. Chart bars: grow from the bottom over 1s (expo.out).
- Column moves: cards slide to their new places over .6s (expo.out).
- With reduced motion, everything jumps straight to its final state. Live updates never replay the entrance animations.

## Technical section
- Move `src/components/approvals/approvalMotion.ts` and `ApprovalTrendChart.tsx` into a shared `src/components/motion/` folder (`pageMotion.ts`, `DecisionBarChart` made generic with series props). Approvals then imports from there, with no visual change.
- Update `TasksHeader`, `TaskStatsBento`, `TaskFilterPills`, `TaskBoard`, `TaskCard` and `TaskListView` for styling and `data-anim` hooks. Add Flip in `TaskBoard`, keyed by task id.
- Undo wraps `updateStatusMutation.mutate` for `done` with a 5s timer and an optimistic hide. The mutation and the task service are unchanged.
- Add a 7-day completed-tasks query (status done, `completed_at`/`updated_at` within 7 days, branch-scoped, small select).
- Semantic tokens only, plus the `clickable.ts` rules. Check light and dark themes at 1440 and 390px with Playwright.
