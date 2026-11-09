# Trainer earnings: one payroll truth, draft slips, mobile layout

## What I found (checked against live data)
- Puneet Meghwal has **4 October salary slips**, not one: the paid ₹15,600 slip (₹12,000 base + ₹3,600 PT) plus three leftover drafts (₹15,600, ₹3,465.48, ₹3,581). September has 8 drafts, August 4, July 1.
- The trainer page asks for "the one slip for this month". Because there are several, the lookup fails silently and the page falls back to its **own estimate** (base × days present + commission). That's why the trainer sees a different amount from the one the owner paid.
- The paid October slip sits inside a payroll batch that is still marked "draft", so the batch status and slip status disagree.
- The trainer page only shows a slip when it is paid. A draft slip (prepared but not paid) shows nothing, and the owner side has no clear place to finish or throw away the leftover drafts.
- On a phone, the month buttons, the 4 summary cards and the commission table get squeezed or need sideways scrolling.

## What changes

**1. One source of truth**
- The trainer page stops calculating salary in the browser. No more estimates from base pay, days or PF.
- It reads one slip per month from the owner's payroll, picked in this order: **Paid → Approved → newest Draft**.
- No slip yet: show "Payroll not prepared yet" and the PT commission instalments only. No made-up net pay.
- The labels say which slip is shown: Paid (with payment date/method), Approved, or Draft ("Being prepared by management").

**2. Clean up duplicates (owner/admin)**
- One-time cleanup: for each person and month that has a paid slip, cancel the other drafts. Cancel only, never delete, and record it in the activity log. Months with no paid slip keep only the newest draft. The others are cancelled.
- Block it from happening again: the database refuses a second open slip for the same person and month. "Prepare payroll" updates the existing draft instead of making a new one.
- Fix the October batch status so it matches its paid slip.

**3. Finishing draft slips (owner/admin)**
- HRM → Payroll gets a "Draft slips" list showing person, month and amount, with three actions: **Open & process** (the existing payroll drawer: preview, then pay by UTR or cash, which creates the linked expense), **Recalculate**, and **Discard** (asks for confirmation).
- It reuses the existing payroll drawer and payment step, so there's no new money logic.

**4. Mobile layout of /trainer-earnings (394px)**
- Month picker becomes a full-width scrollable row of buttons.
- Summary cards: 1 per row on small phones, 2 on larger ones, 4 on desktop.
- On phones, the commission table becomes stacked client cards (client, instalment, status). Desktop keeps the table.
- Net-pay card moves to the top on mobile. Chart height shrinks. Touch targets stay at least 44px. No sideways scrolling.

**5. Accessibility and tracking**
- Slip status is shown with a word and an icon, not just colour. Month buttons announce which one is selected.
- New events: `trainer_payslip_viewed`, `trainer_payslip_downloaded`, `payroll_draft_discarded`, `payroll_draft_processed`.

## Technical details
- New security-definer RPC `trainer_payslip_for_month(p_month date)`. Self only: `auth.uid()` must match the slip's user, with `rpc_guard_applies`. Returns the chosen slip plus run status. Granted to authenticated. Replaces the `.maybeSingle()` query in `TrainerEarnings.tsx` and removes the client `proRatedBase/pf/esi/estimatedNet` code.
- Migration: cancel superseded `payroll_items` (status → `cancelled`, audit row) and add a partial unique index on `(user_id, period month)` where status is not `cancelled`. If the run's period columns make the index awkward, enforce it with a trigger instead. Set the October run status to match its paid slip.
- Update the payroll preparation RPC/service (`src/lib/hrm/payroll.ts`, `PayrollRunPanel.tsx`) to upsert the existing draft.
- New `DraftSlipsCard` in HRM Payroll reuses the existing drawer. Discard uses an AlertDialog (destructive confirmation only).
- Tests: the slip-picking order (paid > approved > newest draft) and "no client estimate when no slip".
- Record a rule in `src/components/pt/AGENTS.md`: the trainer salary display reads only the payroll slip RPC.

## Verify
- Signed in as Puneet: October shows ₹15,600 Paid with a working download. September shows its single draft labelled Draft.
- Screenshots at 394px, 768px and 1280px show no sideways scrolling.
