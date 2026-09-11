# Renewal & Retention Engine — Audit and Implementation Plan

Audit first, build second. Nothing in this plan rewrites membership, payment, WhatsApp or Voice AI logic — the engine sits *on top* of what already runs.

## What already exists (verified)

| Capability | Where it lives today |
| --- | --- |
| Expiry detection | `send-reminders` membership_expiry block — fires only on exact `end_date = today + N`, N from `reminder_configurations.days_before` (default 7/3/1) |
| Renewal offer invoice | `generate_renewal_invoices()` cron RPC — proforma invoice 7 days before expiry, auto-cancels unpaid after 14 days. No UI surfaces it. |
| Expiry state change | `auto_expire_memberships()` daily at 01:00 |
| Renewal purchase | `purchase_member_membership` — same path as a first purchase |
| Messaging | `dispatch-communication` (dedupe key, member preferences, quiet hours, pacing) |
| Voice calls | `voice_retention_candidates` / `voice_retention_queue` / `voice_retention_blocked` functions + `voice_call_attempts` history + `sarvam-voice` worker |
| Staff queue (partial) | `FollowUpCenter` "Renewals" tab — 7-day window, manual WhatsApp button |
| Attendance signal | `member_attendance`, plus `run-retention-nudges` and `get_inactive_members` |
| Staff tasks | `tasks` + `memberRequestTasks.ts` + `taskNotify.ts` |

## Gaps found

1. **No renewal state.** Nothing records which stage a member is at, what was already sent, or the outcome. Reminders are stateless date matches — miss the exact day and the member is never contacted.
2. **A renewal is invisible.** `purchase_member_membership` logs the same event for a brand-new member and a renewal, so nothing can say "stop reminding, they renewed".
3. **Three separate "member going quiet" detectors** with their own thresholds: `send-reminders` inactive alert, `run-retention-nudges`, `voice_retention_candidates`.
4. **Two delivery paths inside one function.** The expiry branch of `send-reminders` sends directly instead of through the dispatcher, so it skips dedupe, member preferences and pacing.
5. **Do-not-contact is enforced by each caller**, not centrally — the FollowUpCenter WhatsApp button bypasses every gate.
6. **No outcome capture**: no renewed / callback / not interested / freeze / churn reason.
7. **Renewal offer invoices are generated but never shown** to staff or members.

## Proposed engine

One state machine per expiring membership, stored in a new table. Detection, sending and outcome recording are separate steps so nothing is lost if one run fails.

```text
  eligible ──► reminding ──┬─► renewed        (terminal, silences everything)
      │                    ├─► voice_escalation ──► staff_followup
      │                    ├─► callback ──► reminding
      │                    ├─► not_interested (terminal, churn reason captured)
      │                    ├─► frozen / cancelled (terminal)
      └─► suppressed (DND, staff-handled, already renewed, member opt-out)
                           └─► lapsed ──► win_back ──► churned (terminal)
```

Stage ladder (day offsets configurable per branch, defaults): T-14 soft nudge, T-7 renewal offer + payment link, T-3 reminder, T-0 expiry day, T+3 lapse, T+7 win-back, T+14 close as churned.

Rules baked in:
- Any successful renewal purchase closes the case in the same transaction — reminders stop instantly.
- A member is contacted at most once per stage, once per day, never more than the branch cap.
- Frozen, cancelled, DND, opted-out and staff-claimed cases never receive automated messages.
- Voice escalation only for high-value or non-responsive cases, and only through the existing Voice AI queue and its call windows — no second calling system.

## Phased build

**Phase 1 — foundation (no behaviour change)**
- New tables: `renewal_cases` (one row per membership cycle: stage, next action time, attempt counts, assigned staff, outcome, churn reason) and `renewal_case_events` (append-only log of every send, reply, call and stage change), with grants + branch-scoped RLS.
- `detect_renewal_cases()` RPC opens/refreshes cases from `memberships`; idempotent, safe to re-run.
- Trigger on `memberships` insert/update to mark a case renewed the moment a new paid membership covers the period, and to close cases on freeze/cancel.

**Phase 2 — orchestration**
- New edge function `renewal-engine-tick`, registered as an `automation_rules` row on the existing brain (no new cron system). It advances due cases and sends through `dispatch-communication` only, with a dedupe key of `renewal:<case_id>:<stage>:<channel>`.
- Move the membership_expiry branch of `send-reminders` behind a feature flag so the two never double-send; the engine takes over per branch.
- Central DND check added inside the engine (and recommended inside the dispatcher as a follow-up).

**Phase 3 — staff surface (Renewal Center)**
- New page grouped by urgency: Due this week · Expiring today · Lapsed · Escalated to calls · Won back · Lost. Each row shows stage, last contact, next scheduled contact, attendance trend and outstanding renewal offer.
- Actions: claim (pauses automation), record outcome, send offer, schedule callback, escalate to Voice AI, snooze.
- FollowUpCenter's Renewals tab becomes a link into this page so there is one queue, not two; its raw WhatsApp button is replaced with the gated send.

**Phase 4 — outcomes and analytics**
- Renewal funnel view built purely from `renewal_cases` / `renewal_case_events` — reads only, no change to membership or payment tables.

## Technical notes

- Stage config stored per branch in `reminder_configurations` style JSON so existing settings UI patterns apply; global default when no branch row.
- Every send goes through `dispatchCommunication()` with `category = 'membership_reminders'` so member preferences and quiet hours already apply.
- Voice escalation writes a queue intent only; `sarvam-voice` remains the sole caller and `voice_call_attempts` remains the sole call history. Outcomes flow back into `renewal_case_events` via the existing webhook.
- Renewal detection trigger must handle advance-booked memberships (`pending` with a future start) as a valid renewal.
- All new RPCs `security definer` with pinned `search_path`, `service_role` grants for the worker, branch-scoped read for staff.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Double messaging while both old and new paths run | Per-branch feature flag; engine off by default; old path disabled per branch as the engine is switched on |
| Reminding someone who already renewed | Renewal detected by trigger inside the same transaction as the purchase, not by a nightly sweep |
| Message flooding / WhatsApp quality drop | Dispatcher dedupe key per stage, one message per case per day, branch cap, quiet hours honoured |
| Voice AI overload | Engine only marks intent; existing worker keeps its own window, concurrency and cooldown rules |
| Staff and bot contacting the same member | Claiming a case pauses automation; recent human contact already suppresses calls |
| Breaking existing payment flow | No change to `purchase_member_membership`, invoices, or Razorpay paths — the engine only reads their results |

## Not in this task

No code or database changes yet. On approval I will start with Phase 1 only and pause for review before the engine begins sending anything.
