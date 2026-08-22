# Trainer Workspace Overhaul

Six issues, all confirmed against the live code and database.

## 1. Trainers receive admin notifications (root cause found)

Every trainer has a row in `staff_branches` (8 trainer rows vs 1 manager row). Three notification producers fan out to "everyone in `staff_branches` for this branch":

- `notify_lead_created()` — "New Lead Captured"
- `notify_new_member()` — "New Member Registered"
- `send-reminders` edge function, inactive-member block — "Warm Follow-Up Needed"

Fix: introduce a single recipient resolver `public.notification_recipients(branch_id, category)` that returns owners/admins/branch managers plus only *front-desk staff* (users in `staff_branches` who do **not** hold the `trainer` role, unless they also hold staff/manager). Rewrite both triggers and the `send-reminders` retention block to use it. Trainers keep: task assignments, their own PT/session events, announcements.

Also add a per-user opt-out: Notification Settings already exists — trainers get category toggles (leads, new members, retention) defaulted off.

## 2. Merge "PT Packages" and "My Clients" into one trainer page

`/pt-sessions` is the admin Personal Training console (packages catalogue, commission ledger, trainer revenue split, "Across 1 trainer", "manage what you sell"). It is wrong for a trainer. `/my-clients` holds the actual roster.

Plan:
- Remove `trainer` from the `/pt-sessions` route roles and drop "PT Packages" from `trainerMenuConfig`.
- Rebuild `/my-clients` as **My Clients** — the trainer's single coaching workspace:
  - Header strip: Active clients · PT clients · Sessions today (done/pending) · Sessions logged this week.
  - Tabs: **Today** (mark-session list, moved off the dashboard), **PT Clients** (package, progress ring, expiry, mark status, log session), **General Clients**, **Progress** (measurements/scan entry).
  - Per-client row actions: Mark session, Record measurement, View progress, Assign plan, Message.
- `/trainer-dashboard` keeps only the summary and deep-links into these tabs; the duplicated "Mark Today's PT Sessions" block on the dashboard is replaced by a compact "Next up" list linking to My Clients → Today.

## 3. Preferences must be trainer-relevant

Sidebar "Preferences" points at `/settings?tab=appearance` (theme picker only). Change it to a dedicated trainer preferences view with:
- Communication preferences (WhatsApp/email/in-app per category, reusing the existing preferences component)
- Notification category toggles from item 1
- Appearance/theme
- Availability + shift display (read-only roster summary)

## 4. "My shift this week" redesign

Current strip is 7 equal boxes of raw times. Redesign:
- Week header with total scheduled hours, days present, late count.
- Each day: day chip, morning/evening blocks as two coloured pills, check-in time inline, "Late" / "Off" / "One-off" states as badges, today highlighted with a ring.
- Horizontal scroll-snap on mobile, 7-column grid on desktop, skeletons on load.
- Keeps the existing `useMyShiftWeek` data contract — presentation only.

## 5. Trainers cannot open Member Store

`/member-store` is gated to `requiredRoles={['member']}`, so the sidebar link 403s. The page also needs a `members` row (`useUnifiedActor` falls back to trainer, but checkout requires `member.id`).

Plan: allow `trainer` (and `staff`) on the route and add a staff-purchase path — when there is no member record, checkout calls the existing `create_pos_sale` RPC with `p_member_id = null` and the trainer's name/phone as guest fields, `p_sold_by = user.id`. Wallet/rewards/membership add-on sections are hidden for non-members; only retail products show.

## 6. Manual Clock In and the Member Store tile

- Attendance is MIPS-driven. "Manual Clock In" stays but is demoted: hidden behind a "Turnstile unavailable?" link, visible only when there is no MIPS punch for the current block, and it records `source='manual_fallback'` (already supported). Duty status card leads with the MIPS punch time instead.
- The "Member Store · Sell add-ons" quick tile has no trainer handler — it is re-pointed at the store route fixed in item 5 and relabelled "Store · Buy & sell add-ons".

## Technical notes

- New DB function `notification_recipients(uuid, text)`; `CREATE OR REPLACE` on `notify_lead_created` and `notify_new_member`; edit to `supabase/functions/send-reminders/index.ts` retention block.
- Frontend: `src/config/menu.ts`, `src/App.tsx` (route roles), `src/pages/MyClients.tsx` (rebuild), `src/pages/TrainerDashboard.tsx` (slim down), `src/components/staff/MyShiftWeekCard.tsx` (redesign), `src/pages/MemberStore.tsx` (guest/staff checkout branch), new trainer preferences view.
- All styling stays on the existing Vuexy tokens (rounded-2xl, soft shadows, indigo/violet gradients); no new colour values.
