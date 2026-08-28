# Birthday date fix + Members list filtering/sorting overhaul

## 1. Yogita's birthday shows a day early

Confirmed: her date of birth is stored as 29 Aug, and today (IST) is 28 Aug — yet the widget lists her under "Today".

Cause: the birthday function builds the next-occurrence date with `LEAST(day, 28)`, so every birthday after the 28th of a month is pulled back to the 28th. The comparison that decides "today vs upcoming" uses the un-clamped month/day, so the two disagree and any 29th/30th/31st birthday fires one to three days early.

Fix: build the next occurrence with proper month-end handling (only 29 Feb falls back, to 28 Feb in non-leap years) instead of blanket-clamping to 28. All day arithmetic stays anchored to the IST calendar date, as it already is. Verify against Yogita (29 Aug), a 31st birthday, and a 29 Feb birthday.

## 2. Members page: "Inactive" card does nothing

Cause: the page loads only 20 members per page from the server, and the status filter plus every column sort are applied **after** that page is fetched, in the browser. The default server order is newest-first and the list is then re-ranked so active/scheduled members float to the top — so page 1 almost never contains an inactive member, and clicking "Inactive" filters 20 rows down to zero. The same flaw affects Frozen, Scheduled and Pending Plan, and makes column sorting only sort the visible 20 rows.

Fix: move filtering, sorting and pagination to the server.

- New database function `list_members_page` returns one page of members with the **derived** status computed in SQL (active / scheduled / frozen / pending plan / inactive), the relevant plan name, start and end dates, days left, dues total, plus the total row count for that filter.
- The page calls this function with: branch, search text, status filter, sort key, sort direction, page. Search keeps working through the same function so filters and search compose correctly.
- Stat cards keep their existing whole-branch counts and now genuinely drive the list; the count on each card and the number of rows returned will match.

## 3. Better, real-world filters and sorting

Replace the current search-only toolbar with a compact filter bar above the table:

- Search (name, code, phone, email) — unchanged behaviour, debounced.
- Status chips: All · Active · Scheduled · Frozen · Pending Plan · Inactive · Expiring ≤7d · Has Dues (multi-select, reflects the stat cards).
- Plan filter (membership plan dropdown) and Branch (owners/managers only, from existing branch context).
- Joined-date range: Any · Last 7 days · Last 30 days · This month · Custom.
- Sort dropdown with explicit ascending/descending toggle: Newest joined (default) · Oldest joined · Name A→Z / Z→A · Days left (least/most) · Dues (high/low) · Plan expiry date. Column headers stay clickable and stay in sync with the dropdown.
- Active filters render as removable chips with a "Clear all" action; filter state is mirrored into the URL so a filtered view can be shared and survives refresh.
- Empty state per filter ("No inactive members in this branch") with a clear-filter action, plus skeleton loading rows and an error state with retry.

## 4. Membership dates under Days Left

In the Days Left column, under the days badge, show the membership period in a quiet secondary line: `12 Jan 26 – 11 Jul 26`. Scheduled members show `Starts 02 Sep 26`, members with no plan keep the em-dash. Export gains explicit Start Date / End Date / Days Left / Dues columns.

## 5. Design pass

Applies the house rules: `rounded-2xl` cards with soft slate shadows, coloured status badges (emerald/indigo/blue/amber/slate), tabular right-aligned numbers for days and money, 44px touch targets, `aria-label` on icon-only buttons, and no horizontal scroll at 375px — the table collapses to stacked member cards on mobile.

## Verification

Browser run against the live app as an owner: click each stat card and assert the row count matches the card number and that every row carries the expected status; toggle ascending/descending on Joined and Days Left and assert order; confirm the date range renders under Days Left; check 1440 / 768 / 375 px screenshots and report console/network errors.

## Technical notes

- New migration: `public.list_members_page(p_branch_id, p_search, p_statuses text[], p_plan_id, p_joined_from, p_joined_to, p_sort text, p_dir text, p_limit, p_offset)` — `SECURITY INVOKER` so existing member RLS and branch scoping still apply; returns rows plus `total_count`. No table or policy changes.
- `src/pages/Members.tsx`: swap the two client queries for a single `useQuery` on the new function; delete the client-side `statusFiltered` / `filteredMembers` sorting blocks; keep the dues and free-days badges (dues folded into the function, free-days stays a side query).
- New `src/components/members/MemberFilterBar.tsx` holding the filter/sort UI.
- Birthday fix is a migration replacing `public.get_upcoming_birthdays`; `BirthdayWidget.tsx` is unchanged.
