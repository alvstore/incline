# Plan: Membership Status and UI/UX Alignment

The user reported that memberships starting in the future (e.g., Dec 1st) are showing as "Scheduled" instead of "Active" even when they might expect them to be active for administrative purposes, and noticed a possible mismatch in the `PurchaseMembershipDrawer`. Additionally, we need to ensure the UI correctly reflects these states.

## Proposed Changes

### 1. Database Function Logic Enhancement
- **File:** `supabase/migrations/20260811154318_face1424-28f6-487b-ad61-d614c6a0b404.sql` (or a new migration)
- **Action:** Update `public.purchase_member_membership` to handle "Active" vs "Scheduled" more gracefully. 
- **Refinement:** If a membership is fully paid (or has a valid partial payment arrangement) and the `start_date` is today or in the past, it's `active`. If the `start_date` is in the future, it's `pending` (which the UI maps to `scheduled`). The user specifically mentioned "membership starts from 1 dec why its not showing active instead of schedule". Usually, a future-dated membership *should* be scheduled, but if the user wants it to be "Active" immediately (perhaps to grant early access or just for status tracking), we should ensure the "Advance booking" toggle in the UI is clear about this.

### 2. UI/UX Refinement in Purchase Drawer
- **File:** `src/components/members/PurchaseMembershipDrawer.tsx`
- **Action:** 
    - Improve the "Advance booking" toggle description to explicitly state that it sets the membership to "Scheduled".
    - Add a visual warning or confirmation when a future date is selected without the toggle, or clarify the behavior.
    - Ensure the end-date calculation is visible and clear.
    - Sync the "Due Date" calculation logic with the user's preference for 3/7/10/15 days presets (already exists but verify consistency).

### 3. Member List UI Synchronization
- **File:** `src/pages/Members.tsx`
- **Action:** 
    - Audit the status mapping logic in `queryFn` for members.
    - Ensure that members with a `scheduledMembership` are clearly distinguishable and that the "Scheduled" badge includes the start date for quick reference.
    - Verify that "Active" memberships starting in the past/today are prioritized correctly in the ranking.

### 4. Identity Mapping Audit
- **Action:** Check for redundant identity blocks in the header (as mentioned in previous context but potentially resurfaced).

## Technical Details
- **Status Mapping:** 
    - `active`: Has an active membership row where `start_date <= today <= end_date`.
    - `scheduled`: Has a membership row where `start_date > today`.
    - `frozen`: Has a membership row with `status = 'frozen'`.
    - `pending_plan`: No membership yet, just registered.
- **RPC `purchase_member_membership`:** Ensure it correctly sets `status = 'pending'` for future starts and `status = 'active'` for today/backdated starts.

## Security & Integrity
- Maintain search_path and security definer status for all RPC updates.
- Ensure RLS remains intact.
