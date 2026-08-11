# Plan: Task SLA & Broad Notifications

Implement time-sensitive task tracking and multi-role notification routing to ensure member requests are never missed.

## User Review Required

> [!IMPORTANT]
> The system will now automatically notify Branch Managers, Admins, and Owners for any task marked as `member_created` or `urgent`.

- Do you want to set a specific default SLA (in hours) for different task priorities?
- Should the "Owner" be notified for every single task, or only if it's unassigned for more than 4 hours?

## Technical Details

### Database Changes
- **Table `tasks`**: Add `due_time`, `sla_hours`, `started_at`, and `member_created` columns.
- **Trigger `trg_tasks_notify_broad_staff`**: New logic to route notifications to `manager`, `admin`, and `owner` roles using the `has_role` pattern.

### Frontend Changes
- **`AddTaskDrawer.tsx`**: Add "Due Time" input and "Member Request" toggle (for staff logging on behalf of members).
- **`TaskCard.tsx`**: Add SLA countdown/status indicator.
- **`TaskDetailDrawer.tsx`**: Show SLA metrics and "Time to Complete" once finished.
- **`taskNotify.ts`**: Update to include due time in WhatsApp/Email templates.

### Edge Functions
- **`dispatch-communication`**: No changes needed; existing variables will accommodate new time fields.
