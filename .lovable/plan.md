## Problem

Love Kumar Paliwal paid in advance but wants membership to start **27 July**. Today the system has no clean path for this:

1. The Purchase drawer **has** a Start Date field, but it is silently overridden when the member has any active membership (`effectiveStartDate` logic), and the "active membership" guard blocks new purchases unless the existing one expires within 7 days.
2. `purchase_membership` RPC always inserts the new row as `status='active'`, even when `start_date` is in the future. So the membership counts as live immediately, MIPS hardware gets enabled now, expiry math is wrong, and dashboards show it as the current plan.
3. MIPS / biometric sync queue and access events fire on insert — there is nothing that defers hardware access to `start_date`.
4. No nightly job flips `pending → active` on the start date, or `active → expired` cleanly afterwards for scheduled rows.
5. UI has no badge for "Scheduled" memberships.

The `membership_status` enum already has a `pending` value — we just aren't using it.

## Fix Plan

### 1. RPC: `purchase_membership` — honour future start_date
- If `p_start_date > current_date` → insert membership with `status='pending'` instead of `'active'`.
- Keep invoice + payment behaviour identical (member is paying now).
- Block overlap: if another `active`/`pending` membership already covers `[p_start_date, p_end_date]` for the same member, raise a clear error (unless explicit advance-booking flag is set).
- Add `p_allow_advance boolean DEFAULT false` so back-office can intentionally schedule alongside an active plan; without it, RPC behaves as today.

### 2. Drawer: `PurchaseMembershipDrawer.tsx`
- Add a new toggle **"Advance booking — start later"** (visible only in staff mode when an active membership exists or the picked date > today).
- When ON:
  - Stop forcing `effectiveStartDate = activeMembership.end_date + 1`. Pass the user-picked `startDate` straight to the RPC with `p_allow_advance = true`.
  - Replace the "Renewal allowed only 7 days before expiry" hard block with a soft notice; allow submission.
  - Show a banner: "This membership will start on <date> and remain Scheduled until then. Member will not get gym access before start date."
- End-date preview already uses `startDate + duration_days` — keep as is.
- Validation: `startDate >= today`. If member has an active membership and advance toggle is OFF, keep current renewal guard.

### 3. Lifecycle activation job
- Add SQL function `activate_scheduled_memberships()` — flips `pending → active` for every row where `start_date <= current_date`.
- Schedule via existing pg_cron daily tick (00:05 IST) — slot it into the Automation Brain manifest so it shows up in the control room.
- On flip: insert a `member_lifecycle_events` row (`event_type='membership_started'`) so MIPS sync and notifications fire through the existing pipelines.

### 4. MIPS / biometric sync
- `biometric_sync_queue` and `mips-access` push currently treat the membership as live on insert. Change the trigger / enqueue logic to:
  - On `pending` insert → enqueue a sync with `effective_from = start_date` and `valid_from = start_date`; do NOT push to MIPS hardware yet.
  - When `activate_scheduled_memberships()` flips status to `active` → enqueue the actual MIPS push (same path as today's purchase).
- Keep `original_end_date = end_date` so freeze/extend math stays correct.

### 5. UI display
- Members list + profile: status badge "Scheduled (starts <DD MMM>)" when `status='pending' AND start_date > today`. Use blue tone (`bg-blue-50 text-blue-700`), matches existing Vuexy palette.
- Membership card in profile: show "Starts on" row above "Expires on" when scheduled.
- Sort: scheduled memberships listed after active ones in member detail.

### 6. Backfill for Love Kumar Paliwal
- Run a one-off UPDATE on his current membership row: set `start_date = 2026-07-27`, `end_date = 2026-07-27 + plan.duration_days`, `original_end_date = same`, `status = 'pending'`. Invoice + payment untouched. (Migration tool, single statement.)

### 7. Audit touchpoints (no behaviour change, just verification)
- `membershipService.fetchActiveMembership` — already filters by `status='active'`, will correctly skip scheduled rows.
- `lifecycleService` — confirm `transition_member_lifecycle` accepts `pending` source state; add transition if missing.
- `useMemberHasPtPackage` and PT purchase guard — no change, PT is independent.
- `cancel_membership` / `freeze_membership` RPCs — allow cancel on `pending` (refund path), disallow freeze on `pending` (nothing to freeze yet). Small guard tweaks only.
- `record_payment` — unchanged; advance payment still posts against the invoice today.

## Files / Migrations

**SQL migration (one file):**
- Rewrite `public.purchase_membership` with `p_allow_advance` + future-date → `pending`.
- New `public.activate_scheduled_memberships()` + pg_cron schedule.
- Trigger update on `memberships` insert: skip MIPS enqueue when `status='pending'`; lifecycle event on activation.
- Small guard tweaks in `cancel_membership` / `freeze_membership`.
- One-off backfill UPDATE for Love Kumar Paliwal.

**TS edits:**
- `src/services/membershipPurchaseService.ts` — add `allowAdvance?: boolean` to `MembershipPurchaseInput`, pass to RPC.
- `src/components/members/PurchaseMembershipDrawer.tsx` — advance-booking toggle, banner, soften renewal guard, stop overriding startDate when toggle is on.
- `src/components/members/MemberProfileDrawer.tsx` + members list cell — render "Scheduled" badge for `pending` + future `start_date`.
- `src/types/membership.ts` — no change (enum already includes `pending`); only ensure the UI maps it.

## Out of scope
- Refund-on-cancel flows for scheduled memberships (existing cancel RPC handles it once guard is tweaked).
- Member-portal (`MemberCheckout`) advance booking — keep member-mode as "starts today" for now; back-office only.
