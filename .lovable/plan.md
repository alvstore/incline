# Complimentary days + start-date change for scheduled memberships

## What the audit found

All three members are in the same state:

| Member | Code | Membership status | Start | End |
|---|---|---|---|---|
| Shoryaraj singh Chundawat | INC-26-0066 | pending | 04 Aug 2026 (Tue) | 03 Aug 2027 |
| Sudarshan Singh Chouhan | INC-26-0067 | pending | 04 Aug 2026 (Tue) | 03 Aug 2027 |
| Mohit Parashar | INC-26-0068 | pending | 04 Aug 2026 (Tue) | 03 Aug 2027 |

All three currently have gate access **off** (`hardware_access_status = expired`), which is correct while the plan has not started.

### 1. Why you cannot add complimentary days

Two separate gaps:

- Every membership action in the member profile — **Adjust Dates**, **Edit Gift Days**, **Cancel Plan** — is bound to the "active membership", which is resolved as status `active` or `frozen` only. A `pending` (scheduled) membership matches neither, so none of those buttons appear.
- There is also **no "grant new complimentary days" action anywhere**. The existing `Edit Gift Days` drawer can only edit or delete gift rows that already exist; the only way a gift row is ever created today is indirectly, by stretching the end date through **Adjust Dates**. So on a brand-new membership there is nothing to edit.

### 2. What the "Activate" button actually does

The `Activate / Deactivate` button in the member profile only flips `members.status` between `active` and `inactive`. It is the member-record switch. It does **not** start a scheduled membership, does not change `start_date`, and is not a "resume". All three members are already `active` at the member level, so pressing it would only deactivate them.

Scheduled memberships flip to `active` on their start date through a daily database job. There is no manual "start it now" control, and no way to pull the start date back from Tuesday to Monday for a pending membership (Adjust Dates is hidden for pending).

### 3. MIPS

MIPS does not need a manual re-sync. The moment a membership becomes active, the access evaluator sets `hardware_access_enabled = true` and writes a hardware access event flagged for sync, which pushes the person's access window to the gates. Today that only happens through the nightly job; with a manual start action it will fire immediately. The audit did surface one real gap: the daily activation job is scheduled directly in the database and is **not** listed in the Automation Brain control room, so it cannot be monitored or re-run from the UI like every other rule.

## Changes

### A. Make membership actions work on scheduled memberships
Resolve the profile's current membership as active, frozen **or** pending, so Adjust Dates, Gift Days and Cancel all appear for a scheduled plan. Show a clear "Starts 04 Aug" badge so staff know the plan has not begun.

### B. New "Grant complimentary days" action
Add a proper grant flow (right-side sheet) that takes a number of days plus a reason and, through a new atomic database function:
- writes the gift row to the complimentary-days ledger,
- pushes the membership end date out by that many days,
- leaves `original_end_date` (the plan's own end) untouched so the gift stays visible and reversible,
- writes an audit entry.

Works for pending and active memberships alike. Existing edit/remove behaviour is unchanged.

For these three members this means: grant 15 days → end date moves 03 Aug 2027 → 18 Aug 2027, with "+15 days" shown in the gift ledger.

### C. "Start membership now / change start date"
Add a **Start now** action on a pending membership row, and allow the start date to be moved for pending memberships:
- Moving the start date shifts the end date by the same number of days (Monday start → 03 Aug 2026 to 02 Aug 2027), keeping any gifted days on top.
- **Start now** sets the membership active immediately, re-evaluates access and queues the gate push, so MIPS gets the new window without any manual sync.
- Both are owner/admin/manager actions with a reason, fully audited.

### D. Put the activation job under Automation Brain
Register the daily scheduled-membership activation as an Automation Brain rule so it appears in the control room with run history, toggle and Run Now, instead of being an invisible database job.

## Applying it to the three members
After the above ships: move all three to a Monday 03 Aug 2026 start, then grant 15 complimentary days each, giving 03 Aug 2026 → 17 Aug 2027. If you want them able to enter today rather than Monday, use **Start now** instead and the gates update within the same minute.

## Technical notes
- New migration: `grant_membership_free_days(membership_id, days, reason)` and `start_membership_now(membership_id, reason)`, both owner/admin/manager gated, both calling `evaluate_member_access_state(..., force_sync => true)`.
- `adjust_membership_dates` already handles a start-date shift correctly (it re-bases `original_end_date`); it only needs to be reachable for pending memberships.
- Frontend: `MemberProfileDrawer.tsx` (membership resolution + action gating + pending row actions), new `GrantGiftDaysDrawer.tsx`, `GiftDaysDrawer.tsx` (list new grants), `AdjustMembershipDatesDrawer.tsx` (accept pending memberships).
