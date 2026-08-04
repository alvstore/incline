# Member search branch, live bookings, member benefit booking, Benefit Tracking redesign

## 1. Branch shows N/A when searching a member

Confirmed cause: the members list has two data paths. Without a search term it reads the `members` table with a joined branch, so the branch name shows. As soon as you type, it switches to the `search_members` database function — and that function does not return a branch name at all (it returns only the branch id). The page then reads `branch_name`, finds nothing, and prints N/A.

Fix: return the branch name (and code) from `search_members` and map it into the row, so searched rows show the same branch as unsearched rows. Same function backs the Benefit Tracking search, so that gets correct branch data too.

## 2. Complimentary gifts need a manual refresh on All Bookings

Confirmed cause: two gaps.

- Granting a gift only refreshes the member/comp lists. The queries that All Bookings and the concierge booking drawer use for credits and eligibility are never invalidated.
- `member_comps` and `member_benefit_credits` are not part of the live-updates publication, so no realtime event fires for other open screens. `class_bookings`, `benefit_bookings` and `pt_sessions` already are, which is why bookings themselves update live.

Fix:
- Add both gift/credit tables to the live-updates publication.
- Subscribe All Bookings (and the concierge drawer) to those tables so a gift granted anywhere refreshes credit/eligibility data instantly.
- Broaden the invalidation list after granting/amending a gift to cover the credit, eligibility, concierge and booking query keys, so the screen that issued the gift updates without a reload too.

## 3. Member dashboard — see and book gifted benefits without errors

Verified: gifted sessions now exist as real credits (checked the credit rows created by the earlier backfill/mirroring), and the member dashboard and My Benefits both read that table.

Remaining work in this item:
- Credits whose benefit is stored under the generic "other" type resolve their label through the linked benefit type; confirm each surface (dashboard tiles, My Benefits, booking sheet) shows the real name rather than "Other".
- Make gift-only benefits bookable: the booking sheet lists facilities from plan entitlements, so a member with a gift but no plan benefit can currently see the credit yet find no bookable facility. Add credits as an entitlement source for the booking list.
- Booking rejections are returned as messages from the server (slot full, window, gender lock, daily cap). Surface those as readable toasts instead of raw error text.
- Verify the whole path in the browser as a member: dashboard tile visible, open booking, pick a slot, book, credit decrements, booking appears on All Bookings live.

## 4. Benefit Tracking redesign

Current page is plain default cards, a bare search box and stat cards, inconsistent with the rest of the app.

Redesign, using the UI/UX skill for composition and density, kept on the project's existing Vuexy tokens:
- Sticky page header with title, member picker and primary actions (Record Usage, Sell Add-On, Comp / Gift).
- Redesigned member search: avatar, name, code, branch, status badge, keyboard navigation, recent members when empty.
- KPI row restyled to the app's rounded-2xl soft-shadow cards, with gift sessions highlighted.
- Benefit balances as a responsive card grid with usage progress, remaining count, expiry and per-benefit quick actions.
- Gifts section as an actionable list (edit / revoke already exist) with granted-by, reason and expiry.
- Proper loading skeletons, empty states and error fallbacks throughout; mobile layout down to 375px.

## Technical notes

- Migration: extend `search_members` to also return `branch_name`/`branch_code` via a join on `branches`; add `member_comps` and `member_benefit_credits` to the `supabase_realtime` publication.
- `src/pages/Members.tsx`: map the new branch fields in the search branch of the query.
- `src/pages/AllBookings.tsx` + `src/components/bookings/ConciergeBookingDrawer.tsx`: extend `useRealtimeInvalidate` tables/keys.
- `src/components/members/CompGiftDrawer.tsx` and `CompAmendActions.tsx`: broaden invalidation keys (`dashboard-benefit-credits`, `my-benefit-credits`, `eligible-addons-credits`, `concierge-*`, `all-benefit-bookings`).
- Member booking surface: add credits-derived entitlements alongside plan benefits; label resolution through `benefit_types.name`.
- `src/pages/BenefitTracking.tsx`: split into focused components (search, header, KPIs, balances grid, gifts list) rather than one 530-line page.
