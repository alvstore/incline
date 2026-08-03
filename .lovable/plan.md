# Tasks: Assignment Failure, Member Links, Requests Routing, Print Follow-up

## 1. "Failed to assign task" — root cause confirmed

The error log for `/tasks` shows the real database error behind the toast:

> column "link" of relation "notifications" does not exist

Assigning a task fires a trigger that creates a notification for the new assignee, and that trigger still writes to an old `link` column. The notifications table uses `action_url`. Every assignment attempt fails, for every task.

Fix: correct the trigger to write `action_url`, and wrap the notification insert so a notification problem can never block a task assignment again.

## 2. Task shows member code instead of member name

Confirmed: when a member raises a plan request, the composer builds the title from `member.profiles.full_name`, but the member record it has loaded does not include the profile join, so it falls back to `member_code` — hence "Diet plan request from INC-26-0024".

Fix:
- Resolve the member's real name (from their profile) when the request is created, so new tasks read "Diet plan request from Mohit Gurjar".
- One-time cleanup of existing tasks: replace the member code with the member's name in titles and descriptions of tasks linked to a member.
- In the task list and detail drawer, show a member chip (name + code) for member-linked tasks.

## 3. "Open linked member" 404

Confirmed: the drawer builds `/members/<id>`, but no such route exists — the members screen is a list at `/members` that opens a profile drawer via `?member=<id>`.

Fix: point the member link at `/members?member=<id>` (the deep link the members page already supports) and navigate in-app instead of a full page load. Also verify the other linked-entity routes (invoice, lead, approval, booking, complaint) resolve to real routes and correct any that don't.

## 4. Member requests should always land in a staff/trainer queue

Today only diet/workout requests become tasks. Freeze, unfreeze, trainer and locker requests go to the approvals table only, so nothing appears on the Tasks board or the owner dashboard.

Fix: every member request also creates a task in the member's branch — assigned to the member's trainer when the request is trainer/plan related, otherwise left unassigned for staff to pick up — linked to the member and to the approval record. Approving or rejecting the request closes the matching task. Owner/admin dashboards already surface open and overdue tasks, so these become visible there automatically.

## 5. Printable follow-up sheet

Add a "Print / Download" action to the Tasks header that produces a clean A4 follow-up sheet for the current filter (Today, Pending, Overdue, Mine, or the active search):

- Header: branch, filter label, generated timestamp.
- Table: priority dot, title, linked member, assignee, due date, status, and a blank "Notes / outcome" column to write on.
- Grouped by due date, sorted by priority; print-friendly, no page chrome.

## 6. sync-to-mips 546 "not enough compute resources"

One occurrence on `/devices`. The function already guards photo decoding (3MB source ceiling, single downscale pass), so the diagnosis is unconfirmed — this step is to instrument and reproduce first: log photo size and peak stage per person, then reduce the peak (stream the upload instead of building one combined byte array, and process people strictly one at a time) if the logs confirm the photo path is the source. No behaviour change to what gets synced.

## Technical notes

- Migration: rewrite `tasks_notify_assignee()` to use `action_url` with an exception guard; one-time UPDATE replacing member codes with names on member-linked tasks. No schema change.
- Frontend: `src/components/tasks/TaskDetailDrawer.tsx` (route map + member chip), `src/components/tasks/TaskListView.tsx` (member chip), `src/pages/Tasks.tsx` (print action), new `src/components/tasks/TaskPrintSheet.tsx`, `src/components/member/requests/RequestComposerDrawer.tsx` (name resolution + task for every request kind).
- Approval → task closure handled where approvals are reviewed, keyed off the task's linked approval id.
- Edge: `supabase/functions/sync-to-mips/index.ts` instrumentation only in this pass.
