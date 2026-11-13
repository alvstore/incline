# Fix "Collect Due" link and improve Finance income table

## What I found
- **Collect Due goes to a dead page:** the button sends you to `/members/<id>?tab=invoices`, but there is no such page — member profiles open as a side panel on the Members screen (`/members?member=<id>`). So you land on the "not found" redirect.
- **Category shows "-":** the table only reads a category picked by hand on each payment. 387 of 400 payments never had one set, so almost every row is blank.
- **Member column shows only the code** (INC-26-0253), while the "Recent Transactions" list next to it already shows name + photo.

## Fix
1. **Collect Due:** open the member's side panel directly on the **Payments** tab (where dues are collected), on the same screen — no page change.
   - Member panel gains an optional "open on tab" setting; the `?member=` link also accepts `&tab=payments` so links from elsewhere work too.
   - Also redirect any old `/members/<id>` link to `/members?member=<id>` so bookmarked/shared links stop breaking.
2. **Category:** when no category was picked, work it out from what the invoice was for:
   - membership → Membership Fees, PT → PT Packages, store/POS → Store / POS Sales, locker → Locker Rental, add-on/benefit → Add-on Services, otherwise Other Income.
   - Shown as a soft badge; hand-picked categories still win. Also used in the CSV export.
3. **Member column:** avatar (initials fallback) + full name, with the member code underneath in small muted text; walk-in/POS buyers show their customer name. Uses the same name logic as Recent Transactions.
4. **Empty/error states:** income table gets a loading skeleton, a clear empty message, and an error message with a Retry button instead of a silent blank.

## Technical details
- `Members.tsx`: Collect Due → `setSelectedMember(member); setProfileTab('payments'); setProfileOpen(true)`; parse `tab` param; pass `initialTab` to `MemberProfileDrawer` (Tabs becomes controlled, resets on open).
- `App.tsx`: add `/members/:id` route that redirects to `/members?member=:id&tab=…` (keeps query `tab`, maps `invoices` → `payments`).
- `Finance.tsx`: extend payments select with `invoice:invoices(..., invoice_items(reference_type))`; new pure helper `src/lib/finance/incomeCategory.ts` + small bun test for the mapping; reuse `resolveMemberDisplay` + shadcn `Avatar` in the Member cell.
- No database changes.
