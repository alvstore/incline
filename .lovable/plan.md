# Member Portal Sprint — One Booking Surface, Branch Flash Fix, Announcements & Store Redesign

## 1. Merge the two booking pages into one

Today there are two member booking screens backed by the same data:

- `/my-classes` (`MemberClassBooking.tsx`, 748 lines) — an agenda across **classes + recovery + PT**, with date rail, time buckets, filter chips, my-bookings toggle.
- `/book-benefit` (`BookBenefitSlot.tsx`, 388 lines) — recovery slots only, from the same `benefit_slots` table, with the same gender filtering and the same `ensureSlotsForDateRange` call.

So `/book-benefit` is a strict subset of `/my-classes`. Two doors to one room is why "how do I book steam?" has no obvious answer.

**Plan**

- Keep a single booking surface at `/book` (labelled "Book & Schedule"), built from the existing `/my-classes` page.
- Delete `src/pages/BookBenefitSlot.tsx`. Route `/book-benefit` and `/my-classes` both redirect to `/book`, so existing links, WhatsApp messages and the entitlement "Book Now" buttons keep working.
- Sidebar loses the duplicate "Book a Benefit" entry; "Book & Schedule" points at `/book`.
- Deep-link support: `/book?type=recovery&benefit=steam` preselects the filter chip and the benefit type, so `My Benefits → Steam → Book Now` lands on exactly the steam slots instead of a generic page. This is the missing "backend to handle steam".
- `My Benefits` stays as the entitlement/credits wallet (what you own), and links into `/book` (when you use it). Clear split: own vs. book.

**Booking page redesign (ui-ux-pro-max, Vuexy tokens)**

```text
┌ Hero: greeting · next upcoming booking · credits left ──────┐
├ Date rail (14 days, today pinned) ──────────────────────────┤
├ [All] [Recovery] [Classes] [PT]      [ My bookings (2) ]    │
├ Morning / Afternoon / Evening grouped slot cards            │
│   card: icon badge · title · trainer/facility · time ·      │
│         spots-left meter · Book / Booked / Full             │
└ Confirmation in a right-side Sheet (not an alert dialog) ───┘
```

Skeletons per section, empty state per filter ("No recovery slots on Tue — try Wed"), and a sticky mobile summary bar.

## 2. "No Branch Assigned" flash on refresh

Confirmed root cause in `src/contexts/BranchContext.tsx`. `branchStatus` only waits on `branchesLoading` (the org-wide branches list). The member's own branch comes from a **separate** query (`member-home-branch`), whose loading state is never consulted — so during the first paint after refresh `memberBranch` is `undefined` and the status computes `no_branch_assigned`, showing the empty state before data lands.

**Fix**: include the per-role queries' loading/fetch state in the status computation — while `member-home-branch` / `staff-home-branch` / `manager-branches` is loading (or the roles array has not resolved yet), report `loading`, never `no_branch_assigned`. Only fall through to `no_branch_assigned` once that query has actually settled with no row. Same treatment for staff/trainer/manager so the flash is gone for every role.

## 3. Announcements (member) redesign

`MemberAnnouncements.tsx` — restructure into a feed worth reading:

- Pinned/priority band at top, then a chronological feed with unread dots.
- Card anatomy: category chip (Event / Offer / Notice), title, 2-line teaser, relative time, attachment thumbnail (image/PDF/MP4 are already supported on the record).
- Tap opens a right-side Sheet with full body, media viewer and download.
- Filter chips (All / Unread / Events / Offers), skeleton loaders, illustrated empty state.

## 4. Member Store redesign

`MemberStore.tsx` — bring it to 2026 commerce standards:

- Sticky search + category chips, product grid with real image ratio, price + stock badge.
- Product detail in a Sheet; quantity stepper; add-to-cart with optimistic count.
- Persistent cart button with item count → cart Sheet → existing checkout flow (pricing stays server-recomputed, untouched).
- Skeleton grid, out-of-stock and empty-cart states.

## Technical notes

- Files deleted: `src/pages/BookBenefitSlot.tsx`. Routes in `src/App.tsx` and entries in `src/config/menu.ts` updated; redirects added so no link 404s.
- `/book` is split into components under `src/components/member/booking/` (`DateRail`, `SlotCard`, `SlotGroup`, `BookingConfirmSheet`, `MyBookingsSheet`) — the current 748-line page is refactored, not rewritten, so the booking mutations, gender filtering, credit checks and `book_facility_slot` RPC path stay exactly as they are.
- No database or business-logic changes in this sprint except the branch-status guard, which is client-side only.
- All new UI uses existing semantic tokens, `rounded-2xl`, soft shadows, lucide icons, Sheets for every form/detail — per project standards.
