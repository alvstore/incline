# 15-Day "Honeymoon" Annual Upgrade Automation

Automated upgrade offers for members on 1/3/6-month plans: Day 7 and Day 12 WhatsApp nudges, in-chat savings calculation with a Razorpay payment link, and an admin dashboard widget tracking the window and conversions.

## Assumptions (confirmed against the codebase)

- "Annual" = a membership plan with `duration_days = 365`; short-term = 30/90/180. No plan exists yet named "VIP Annual" — the offer uses the branch's active 365-day plan price.
- The 15-day window runs from `memberships.start_date` (not created_at) so backdated start dates don't create phantom windows.
- All WhatsApp sends go through `dispatchCommunication()` (project rule) — never direct `send-whatsapp` calls. Templates must be approved by Meta before the cron goes live; until then the sends fall back per the dispatcher's existing template-resolution order.
- Payment collection uses the existing Razorpay link flow; the membership change itself goes through one atomic server RPC (project rule: no multi-step client writes for membership changes).

## Epic 1 — Database & financial logic

Migration `annual_upgrade_window`:

1. New table `public.upgrade_offers` (one row per membership, not columns on `memberships` — keeps the hot table lean and gives us per-offer audit):
   - `id`, `branch_id`, `member_id`, `membership_id` (unique), `target_plan_id`
   - `window_ends_at` (timestamptz = start_date + 15 days), `status` (`pending | day7_sent | day12_sent | converted | expired`)
   - `annual_price`, `already_paid`, `upgrade_cost` (snapshot at offer creation), `converted_invoice_id`, `converted_at`, timestamps
   - GRANTs (authenticated + service_role), RLS enabled, branch-scoped policies using `(SELECT managed_branch_ids(auth.uid()))` pattern, members can read only their own row.
2. RPC `calculate_upgrade_cost(p_member_id uuid)` — SECURITY DEFINER with `rpc_guard_applies()` + `is_own_member()`/staff check, GRANT EXECUTE to authenticated. Returns `{ annual_price, already_paid, upgrade_cost, window_ends_at, eligible }`. `already_paid` = sum of completed payments against the source membership's invoice; `upgrade_cost = annual_price - already_paid`, floored at 0.
3. RPC `convert_to_annual(p_offer_id uuid, p_invoice_id uuid)` — SECURITY DEFINER, guard-checked, called only by the payment-verification path: marks offer `converted`, updates the membership to the annual plan with `end_date = start_date + 365 days` (inclusive, matching `membershipEndDate` math), writes audit + lifecycle event. Idempotent on `p_invoice_id`.

## Epic 2 — Daily trigger (Automation Brain, not a standalone poller)

- New rule row in `automation_rules` (e.g. `annual_upgrade_nudge`, daily 09:00 IST) dispatched by the existing `automation-brain` master tick — no new pg_cron job, consistent with the control-room pattern; toggle + Run Now come free.
- New edge function `trigger-upgrade-campaign` (v1.0.0, CORS, try/catch, service-role/system bypass like `send-reminders`):
  - Day 7 segment: offers `pending` where `start_date` is exactly 7 days ago (IST) → send "Day 7 offer" template via `dispatchCommunication` with dedupe key `upgrade:<offer_id>:d7:wa`.
  - Day 12 segment: offers `day7_sent` where `start_date` is exactly 12 days ago → "Window closing in 72 hours" template, dedupe `...:d12:wa`.
  - Marks `expired` anything past `window_ends_at`.
  - Honors `do_not_contact` (dispatcher does this already) and a kill-switch setting `annual_upgrade_campaign` (default on).
- Offer rows are created by a trigger on `memberships` insert (status active/pending, plan duration 30/90/180) so the cron only ever touches indexed pending rows.
- Two WhatsApp UTILITY templates (`annual_upgrade_day7`, `annual_upgrade_closing`) drafted and submitted to Meta via the existing template manager; variables: name, plan, savings amount, window end date.

## Epic 3 — WhatsApp interactive handler

In `meta-webhook`:

1. New button payload `BTN_SHOW_UPGRADE_SAVINGS` → calls `calculate_upgrade_cost`, replies: "Annual: ₹X | Already paid: −₹Y | Upgrade cost: ₹Z" + a `BTN_GENERATE_UPGRADE_LINK` button.
2. `BTN_GENERATE_UPGRADE_LINK` → creates a Razorpay payment link for `upgrade_cost` via the existing `create-razorpay-link` flow (linked to the offer id in metadata) and sends it in chat.
3. Payment success: the existing Razorpay webhook/verify path detects the upgrade metadata and calls `convert_to_annual` — membership flips to annual, end date extends, member gets a confirmation message, front desk gets an in-app notification.

## Epic 4 — Admin tracking widget

- New `UpgradeWindowWidget` on the dashboard (Fernly bento card, `grid-cols-12`, semantic tokens, lucide icons, TanStack Query, branch-scoped):
  - Stat tiles: in-window now, offers sent (7d), conversions this month, conversion revenue.
  - List: member, plan, day N of 15, upgrade cost, status badge (semantic token colors) — so a manager can mention it at the turnstile.
  - Loading skeletons, empty state, error state; 44px touch targets; mobile card layout.
- Data via a branch-guarded server-side summary RPC (no raw row downloads for trends, per referral-workspace precedent).

## Testing & verification

- Unit tests next to `scripts/tests/`: window math (15 days inclusive, IST), `calculate_upgrade_cost` (paid partial, overpaid floor at 0), Day 7/Day 12 segment selection, idempotent conversion.
- `scripts/check-definer-guards.ts` must pass for the new RPCs.
- Playwright: dashboard widget renders for manager, hidden for staff without financial access.
- End-to-end dry run on a test member before enabling the cron rule for real sends.

## Out of scope / notes

- No changes to existing membership purchase, freeze, or renewal flows.
- Meta template approval (up to 48h) gates real WhatsApp sends; the rest ships independently.
- Upgrade offers never expose pricing on public pages — member-only, in-chat, after authentication of the WhatsApp identity (existing member-resolution in meta-webhook).
