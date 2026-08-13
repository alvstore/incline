# Plan: Dashboard Initialization & Branch Context Fix

The user is experiencing a critical issue where the dashboard fails to load data and displays "Unknown" even for admin users. This is caused by race conditions during the application bootstrap phase, where the `BranchContext` and `AuthContext` are not fully synchronized, leading to unauthorized or empty queries before roles are hydrated.

## Technical Details

### 1. Fix Branch Initialization Race Condition
The `BranchProvider` currently evaluates `branchStatus` based on `authLoading`, but doesn't explicitly wait for `roles` to be populated when a user session exists. We will modify the state machine to remain in a `loading` state until `roles.length > 0` (for authenticated users).

### 2. Harden Auth Role Hydration
The `AuthProvider` will be updated to fetch roles immediately upon session detection, rather than deferring with a timeout. This ensures the roles are available as early as possible for downstream providers like `BranchContext`.

### 3. Dashboard Data Resilience
The main dashboard queries in `DashboardPage.tsx` will be wrapped in tighter checks to ensure they only fire when both `user` and `roles` are stable, preventing "permission denied" or empty result errors during the first few hundred milliseconds of mounting.

## Changes

### Auth & Context
- **src/contexts/AuthContext.tsx**: Remove `setTimeout` when fetching profile/roles on mount to speed up hydration.
- **src/contexts/BranchContext.tsx**: Update `branchStatus` logic to wait for `roles` when a `user` is present.

### UI & Layout
- **src/components/layout/AppLayout.tsx**: Ensure skeletons are shown while `branchStatus` is `loading`, which will now correctly cover the auth hydration window.
- **src/pages/Dashboard.tsx**: Add an explicit role-readiness check to the main `stats` query.

### Verification
- I will verify the fix by checking the console logs (using `code--read_console_logs`) to ensure no 403/401 errors occur during bootstrap.
- I will inspect the network requests for any failed branch-related calls.
