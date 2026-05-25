## Goal
Add **Export CSV** and **Print** buttons to the All Bookings page header so staff can download or print the filtered bookings list for monitoring.

## Scope (frontend only)
File: `src/pages/AllBookings.tsx`

## Changes

1. **Header toolbar** — add two new `Button`s next to the existing View toggle / "New Booking" button:
   - `Export CSV` (icon: `Download`)
   - `Print` (icon: `Printer`)
   Both styled as `variant="outline"` with `rounded-xl`, matching current toolbar.

2. **Export CSV behavior**
   - Combines the three already-filtered arrays (`filteredClassBookings`, `filteredBenefitBookings`, `filteredPTSessions`) into one unified row shape:
     `Date, Time, Type (Class/Benefit/PT), Item (class/benefit/trainer name), Member Code, Member Name, Status, Source, Booked By`
   - Uses existing `exportToCSV()` helper from `src/lib/csvExport.ts`.
   - Filename: `bookings_<branch>_<dateFilter>`.
   - Disabled when zero rows.

3. **Print behavior**
   - Opens a new window and writes a clean print-friendly HTML table (header with branch + date + active filters, then the unified rows above).
   - Uses `escapeHtml` from `src/utils/htmlEscape.ts` for safety.
   - Triggers `window.print()` after content loads, then closes.
   - Disabled when zero rows.

4. **Small helper** inside the file: `buildUnifiedRows()` to avoid duplication between CSV + Print.

## Out of scope
- No backend / RPC changes.
- No new filters or columns beyond what's already on screen.
- Calendar/Timeline views unchanged (export always reflects the current filtered list for the selected date).

## Permissions
Buttons render for any role that can already see this page (staff+). No new RBAC gates needed.

Skills used: ui-ux-pro-max (Vuexy toolbar pattern), senior-architect (kept change isolated to presentation layer).