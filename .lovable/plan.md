# Compact "Task Pulse" widget (styled like the Annual upgrades card)

## Goal
Replace the long task list on the Dashboard with a compact, fixed-height card that matches the Annual upgrades widget in Analytics. It shows the task type and when it was created, and staff can assign or close a task right from the card. Everything else opens in a side panel.

## What you'll see

### Card (fixed height, same look as Annual upgrades)
```text
+------------------------------------------+
| [icon] Task Pulse             [refresh]  |
| Live branch queue                        |
|  10        0          0          0       |
|  Open   Due today   Overdue   High prio  |  <- tap a number to filter
|------------------------------------------|
| [Diet] Amit Ajeet          2d ago  [..]  |
|  Diet plan request · Unassigned          |
| [Workout] Sanjay Vaswani   5h ago  [..]  |
| [Trainer] Mohit Gurjar     1h ago  [..]  |  <- red tag when high priority
|------------------------------------------|
| View all (10)                         -> |
+------------------------------------------+
```
- Only the **3 most urgent** tasks are shown: overdue first, then high priority, then oldest.
- Each row has:
  - a coloured **request-type tag** (Diet plan, Workout plan, Trainer change, Locker, Freeze, Resume, General)
  - the member's name
  - **created time**, like "2d ago" (hover shows the full date)
  - the assignee's avatar, or "Unassigned"
- A **[..] quick-action menu** on each row: **Assign to…** (branch staff list with search), **Mark done**, **Cancel task**, **Open**.
- The four numbers work as filters for the list and the side panel.
- The card is about 410px tall, the same height as the Annual upgrades card, so it fits the dashboard grid. The full list no longer stretches the page.

### "View all" side panel (same pattern as the upgrades panel)
- Opens from the right, with search, type filter chips and status chips (Open / Due today / Overdue / High priority).
- Shows 10 rows per page with Previous / Next and "Showing X of Y".
- Each row: type tag, title, created date, due date, priority and assignee. You can assign inline and close with one click.
- Closing a task asks for a quick confirmation and offers a 5-second **Undo**.
- Escape closes the panel and returns focus to "View all".

### Who sees what
- Owner, admin and manager see the whole branch queue and can assign tasks.
- Staff and trainers see only their own tasks. They can mark them done, but there is no Assign option.

## Accessibility
- All actions are real buttons with clear names (for example "Assign Diet plan request from Amit", "Mark done"). Tap targets are 44px, and focus outlines are visible.
- Request types are shown with an icon and text, not colour alone.
- List changes and success or failure messages are announced to screen readers.
- Created times show full dates on hover and to screen readers.
- Respects reduced-motion settings; there's only a subtle fade-in.

## On/off switch
- Setting `dashboard_task_widget_v2`, on by default.
- Turning it off brings back the current long widget instantly, without an update.

## Technical details
- New files:
  - `src/components/dashboard/TaskPulseWidget.tsx`
  - `src/components/dashboard/TaskPulsePanel.tsx` (Sheet)
  - `src/lib/tasks/taskType.ts`: `taskTypeOf(task)` works out the type from `linked_entity_type` and the title prefix. It uses the `memberRequestTaskTitle` and "Diet/Workout plan request" patterns, with General as the fallback. It also has `rankTasks()` for the preview order.
- The query adds `linked_entity_type, linked_entity_id, description` and keeps the existing realtime invalidation and the `['dashboard-my-tasks', …]` key. The panel uses server-side `.range()` paging plus a count.
- Mutations reuse `assignTask` and `updateTaskStatus` from `taskService`, plus `notifyTaskAssignee` when assigning. Toggles use optimistic updates; afterwards the dashboard, `tasks` and `task-stats` queries are refreshed.
- The staff list for assigning comes from staff and trainer roles in the selected branch only, so cross-branch staff aren't offered.
- Role checks use `can.X(roles)` from `permissions.ts` instead of inline role lists.
- `Dashboard.tsx` places the widget in a `grid-cols-12` row (`lg:col-span-5`) next to the adjacent chart, and switches between the old and new widgets using the setting.
- Tests in `scripts/tests/taskPulse.test.ts`:
  - `taskTypeOf` maps "Diet plan request from X" to Diet plan and "Trainer change request…" to Trainer change.
  - `rankTasks` puts overdue first, then high priority, then oldest.
  - The preview is capped at 3.
- Check in a test browser as admin: the card is under 420px tall, assigning works, and marking done plus Undo works. Check in both themes and at 772px width.
