---
title: Project Monitoring & Security Fixes
description: Fix database triggers, AI keys, and RLS/permission issues.
---

## Fixes

### Database Triggers
- Update `public.tasks_notify_management()` to use `user_id` instead of `staff_id` (fixes task creation).

### AI Assistant
- Update `GOOGLE_AI_API_KEY` with a valid key or fallback to Lovable AI Gateway (requires manual user step for custom key, but I'll ensure the code handles the fallback gracefully if possible).

### Security & RLS
- **Fix `has_role` permission denied**: Grant `EXECUTE` on `public.has_role` to `authenticated` and `anon` roles.
- **Holidays RLS**: Restrict read access to only those with gym roles (owner, admin, manager, staff, trainer), preventing leaks to regular members.
- **Income/Expense Templates**: Restrict read access to staff roles, preventing regular members from seeing internal financial categories.
- **Storage Protection**:
    - Scoped read/write for `member-photos` (avatars, biometric, measurements).
    - Scoped read/write for `member-media`.
    - Scoped read/write for `staff-media`.
    - Scoped read for `policy-pdfs` (only for roles defined in the policy).
    - Scoped read for `attachments` (owner, admin, or campaign recipients).

### Cleanup
- Remove any redundant UI blocks or duplicate buttons found during audit.
