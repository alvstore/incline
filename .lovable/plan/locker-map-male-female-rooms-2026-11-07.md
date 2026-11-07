# Locker Map — Male & Female rooms

## What exists today
- Each locker already stores a zone (Male room / Female room / Common area), but all 45 lockers are currently set to "Common area".
- The Locker Map shows one long table, so finding a free locker in a specific room means scrolling.

## What you will see

### 1. Room switcher at the top of Locker Map
Two large room cards side by side: **Male room** and **Female room** (plus a small "Unassigned / Common" card only while some lockers still have no room).
Each card shows: total lockers, free, assigned, out of order, and a thin fill bar. Clicking a card opens that room. The choice is kept in the page address so refreshing keeps the same room.

### 2. Room view = compact locker grid (not a long list)
- Lockers shown as small tiles in a grid (about 8–12 per row on desktop, 4 on phone), so 45 lockers fit on one screen.
- Tile colour + icon + text show status (Available / Assigned / Maintenance) — never colour alone.
- Assigned tiles show the member's initials; hover/focus shows full name and member code.
- Clicking a tile opens a right-side drawer with locker details and actions: Assign, Release, Move to other room, Edit.
- Filter chips above the grid: All / Available / Assigned / Maintenance, plus search by locker number or member.
- A "List view" toggle keeps the current table for staff who prefer it — but limited to the selected room.

### 3. Configurable rooms (set-up)
- "Arrange rooms" button opens a drawer to move lockers between rooms in bulk: pick a range (e.g. L-001 to L-022 → Male room, L-023 to L-045 → Female room) or tick individual lockers.
- Shows a preview count before saving; assigned lockers can be moved too (the member keeps their locker).
- Adding a new locker defaults to the room currently open.

### 4. Accessibility and polish
- Tiles are real buttons, reachable by keyboard, with clear labels ("Locker L-030, Male room, assigned to Harsh Bothra").
- Visible focus rings, 44px touch targets, loading skeleton tiles, empty state ("No lockers in Female room yet — Arrange rooms"), error state with retry.
- Checked at desktop, tablet and phone sizes.

## Technical details
- Frontend only, in `src/pages/Lockers.tsx` (split into `LockerRoomSummary`, `LockerGrid`, `LockerDetailSheet`, `ArrangeRoomsSheet` components under `src/components/lockers/`).
- Uses existing `lockers.gender_zone` column ('male' | 'female' | 'common'); no schema change.
- Bulk move updates `gender_zone` for selected IDs scoped by `branch_id`, then invalidates the lockers query. Assign/Release keep using the existing atomic locker RPCs.
- Uses theme tokens only; status badges follow the project palette.
