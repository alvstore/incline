# Trainer Dashboard & Security Audit Implementation

Audit and hardening of the Trainer role to ensure proper workflow, data scoping, and access to essential features.

## Proposed Changes

### 1. Task Management for Trainers
- **Router Access**: Added `trainer` role to the `/tasks` route protection in `App.tsx`.
- **Navigation**: Added "Tasks" to the `trainerMenuConfig` in `menu.ts` under the "Work" section.
- **Workflow**: Trainers can now view assigned tasks, update statuses, and collaborate on branch-level tasks.

### 2. PT Sessions UI Refinement
- **Scoped Visibility**: Restrict "Today's Sessions", "Packages", and "Insights & Revenue" to management roles (`owner`, `admin`, `manager`) in `PTSessions.tsx`.
- **Primary View**: Trainers will default to the "Clients" tab, showing only their assigned PT clients.
- **Revenue Privacy**: Hidden financial insights from the trainer view to comply with internal privacy standards.

### 3. Member Store for Trainers
- **Access Granted**: Added "Store" to the `trainerMenuConfig` to allow trainers to purchase products.
- **Unified Identity**: Updated `MemberStore.tsx` to use the new `useUnifiedActor` hook, enabling the checkout process to recognize trainers as valid purchasers (linked to their branch and user profile).
- **Error Handling**: Standardized the "No profile found" state to account for trainers without synced biometric/profile data.

### 4. Architecture & Security
- **Unified Hook**: Created `useUnifiedActor` in `useMemberData.ts` to provide a single interface for member or trainer profile resolution across the app.
- **Data Scoping**: Verified that `ptService.ts` correctly filters active packages by `trainerId` when accessed by non-management roles.

## Technical Details
- Modified `src/App.tsx` to include `trainer` in `/tasks` `ProtectedRoute`.
- Updated `src/config/menu.ts` for navigation visibility.
- Refactored `src/hooks/useMemberData.ts` to include `useUnifiedActor`.
- Hardened `src/pages/PTSessions.tsx` with role-based tab rendering.
- Fixed profile-linking logic in `src/pages/MemberStore.tsx`.
