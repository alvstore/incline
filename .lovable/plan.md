# Plan: Trainer Dashboard & Security Audit

Hardening the application for Trainers by strictly scoping access to assigned clients, tasks, and branch resources.

## User Review Required

> [!IMPORTANT]
> - Trainers will no longer see "New Task" button; they can only manage tasks assigned to them.
> - Trainers will only see PT Clients assigned to them in the Coaching Studio.
> - The "Member Store" will be fixed for Trainer roles to ensure they can access it like members.

- **Tasks**: Confirm if trainers should *ever* be allowed to create tasks for themselves (currently blocking creation entirely).
- **PT Sessions**: Confirm if trainers should see the "Today's Sessions" tab (currently restricting to assigned clients).

## Proposed Changes

### Work & Tasks
- **Hardening**: Modify `TasksHeader.tsx` to hide the "New Task" button for trainers.
- **Workflow**: Ensure the `/tasks` route remains accessible but scoped via existing RLS.

### Training & PT Studio
- **Access Control**: Restrict `PTSessionsPage` so trainers only see the "Clients" tab by default, and only for their assigned clients.
- **Privacy**: Hide "Insights & Revenue" (Analytics) from trainers in the Coaching Studio.

### Client Management
- **Progress Recording**: Update `MyClients.tsx` to ensure "Record Progress" (Measurements) works for both General and PT clients.
- **Navigation**: Ensure trainers can see and record progress for clients who purchased packages from them.

### Services & Store
- **Identity Resolution**: Fix the `useUnifiedActor` hook to ensure trainers are recognized correctly as valid actors for the `MemberStore`.
- **Route Fix**: Audit and fix the `/member-store` link in the sidebar for trainers.

## Technical Details

### Frontend Changes
- **src/components/tasks/TasksHeader.tsx**: Add RBAC check for the "New Task" button.
- **src/pages/PTSessions.tsx**: Update `Tabs` and `InsightsPanel` visibility based on `canManage`.
- **src/pages/MyClients.tsx**: Verify measurement triggers for all client types.
- **src/hooks/useMemberData.ts**: Harden `useUnifiedActor` to prevent identity resolution failures when a user has both trainer and staff/admin roles.

### Security & RLS
- **PII Protection**: Verify that the `search_members` and `member_measurements` policies allow trainers to read data for their assigned clients only.
