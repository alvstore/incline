# Plan - Attendance History UI/UX Overhaul

Improve the Member Attendance History UI/UX by replacing the "all members" overview with a targeted search-first interface, similar to the staff contact widget. This will optimize performance for large member bases and provide a cleaner, more robust history tracking experience.

## User Review Required

> [!IMPORTANT]
> - The current "Member Attendance History" tab pre-loads all member summaries for the month. I will change this to require a member search (Name/Mobile/Code) before showing details. Is this search-first approach acceptable for your workflow?
> - For the "Daily Comparison" and trends, the existing charts will remain as they provide valuable aggregate insights without performance impact.

## Technical Details

### 1. New Component: `MemberHistorySearch`
- Create a robust combo-box/search component for members using `search_members` RPC.
- Support Name, Mobile, and Member Code search.
- Optimized for performance with debounced inputs and branch scoping.

### 2. Refactor `MemberAttendanceHistory.tsx`
- Remove the initial month-wide member summary cards (which were causing performance issues).
- Replace with a prominent, centered search interface in the "Members" history sub-tab.
- Once a member is selected:
    - Show a dedicated "Member Profile Summary" (Visits, Avg Stay, Last Visit).
    - Render a filtered `Table` of that specific member's attendance history for the selected month.
- Implement clear "Clear Search" or "Switch Member" actions.

### 3. UI/UX Polishing
- Follow **Vuexy Premium** aesthetic: `rounded-2xl` cards, soft shadows, and indigo/violet accents.
- Use `lucide-react` icons exclusively.
- Implement loading skeletons for the history table.
- Ensure branch-level isolation is strictly enforced.

### 4. Code Quality & Performance
- Use `useQuery` for all data fetching.
- Ensure efficient SQL queries (no over-fetching of profiles/members).
- Add `Mobile` search capability to the existing member lookup logic.

## Verification Plan

### Manual Verification
- [ ] Navigate to `/attendance-dashboard` -> History -> Members.
- [ ] Verify the search bar is prominent and responsive.
- [ ] Search for a member by name: verify results appear.
- [ ] Search for a member by mobile: verify results appear.
- [ ] Select a member: verify their specific history for the month loads correctly.
- [ ] Change the month: verify the history updates for the selected member.
- [ ] Verify UI follows Vuexy design standards.
