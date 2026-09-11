# Complete Renewal Workflow and Repair HOWBODY Report Sync

## Confirmed findings

### Rehan Khan’s scan
- Rehan’s real member record is `INC-26-0030`; the supplied UUID is his HOWBODY identity, not his member-table ID.
- Both scans reached the database:
  - Body composition: 11 Sep 2026, 15:44:35 IST; score 77, weight 95.7 kg, BMI 33.1, body fat 29.4%.
  - Posture: 11 Sep 2026, 15:46:04 IST; score 92.
- Both reports were already mirrored into his progress measurements, so profile linking itself succeeded.
- The body scan was correctly recorded against his Annual Plan allowance (`source = plan`). No add-on credit should be deducted because his plan includes six body scans.
- The posture report was recorded with `source = none`: his plan has no posture entitlement and no posture add-on credit.
- The webhook then crashed on `sb.rpc(...).catch(...)`; that API call is not a native Promise. This happened after report persistence and entitlement accounting but before session completion and report delivery.
- Therefore the scanner session remains `bound`, no delivery row/PDF was produced, and Rehan cannot reliably receive or reopen the report despite the underlying measurements existing.
- The numeric value `2098354883493818370` is not the stored HOWBODY `dataKey`; the accepted reports use vendor-generated hash keys and the shared scan ID `6a19b0e65fb645dfa1309995279aee83`.

### Renewal work
- Phase 1 data foundation and the disabled Phase 2 worker scaffolding already exist.
- The global renewal engine is disabled and its automation rule is inactive, so automated renewal messages are not live.
- Renewal Center, outcome controls, Voice AI outcome linkage, analytics, and admin configuration are still missing.
- The old Follow-Up Center has a direct WhatsApp action that bypasses the central communication safeguards and must be retired or routed through the dispatcher.

## Implementation

### 1. Repair and harden the HOWBODY webhook pipeline
- Fix both body and posture webhooks so device-touch failures are awaited safely and cannot abort session completion or delivery.
- Validate and handle every database write result: report upsert, entitlement event, device touch, session completion, and delivery invocation.
- Move non-critical device inventory updates after durable completion, with isolated error handling and structured error logging.
- Correlate reports by `scan_id`, `thirdUid`, member, device, and session kind; reject true cross-member mismatches while supporting the scanner’s paired body/posture output without double charging.
- Make retries idempotent by report key and scan/session identity. A repeated vendor push must repair an incomplete workflow but never duplicate measurements, credits, PDFs, notifications, or delivery rows.
- Store explicit processing state/error details so staff can distinguish received, linked, measured, entitlement-recorded, delivered, and failed stages.

### 2. Correct entitlement semantics
- Treat one confirmed body assessment as one plan usage when covered by the membership; never decrement an add-on credit in that case.
- Treat the posture result emitted as part of the same physical assessment as a companion report, not a second unapproved charge.
- Preserve separately purchased posture scans for posture-only sessions.
- Base quota counts on the idempotent consumption ledger rather than raw report counts, preventing retries or paired reports from reducing availability twice.
- Add database constraints/indexes and transaction-safe RPC logic for one consumption decision per assessment.

### 3. Repair Rehan’s current assessment
- Reconcile the existing body and posture rows under their shared scan ID and Rehan’s member record.
- Keep the valid body-plan consumption entry; convert the companion posture accounting to the correct non-chargeable association.
- Mark the bound session completed without creating another usage event.
- Generate the missing branded report delivery record and PDF, then invoke the normal delivery workflow once.
- Verify both reports appear in Rehan’s My Progress and My Scan Report views and that his remaining allowance is correct.
- Preserve the uploaded vendor PDFs as audit references only; the app will continue generating secure branded member PDFs from verified report data.

### 4. Improve the member and staff scan workflow
- Replace optimistic “already delivered” wording with real delivery status.
- Show one assessment timeline grouped by scan, containing Body Composition and Posture results, plan/credit coverage, report availability, and delivery state.
- Provide working View, secure PDF download, and authorized Retry Delivery actions.
- Add proper skeleton, empty, partial-failure, and retry states; remove `any` types in the HOWBODY report components and hooks.
- Keep member access self-only and staff access branch-scoped. PDFs remain private with short-lived signed links.
- Add a staff diagnostics view for unmatched vendor identities and incomplete assessments, with an audited “link to member and replay” action instead of manual database repair.

### 5. Finish the Renewal Center
- Add a branch-aware Renewal Center for Owner/Admin/Manager/Staff using the existing renewal cases and event log.
- Queues: Due soon, Today, Lapsed, Voice escalation, Callback, Won back, and Lost.
- Show member, plan, expiry, value, last contact, next action, attendance signal, offer/payment evidence, ownership, and current suppression reason.
- Add right-side drawers for claim/reassign, callback scheduling, snooze, notes, and outcome capture.
- Add atomic, capability-checked RPCs for claim, snooze, outcome, manual contact logging, and Voice AI escalation; every mutation appends an event.
- Outcomes: renewed, callback, staff follow-up, not interested, frozen, cancelled, churned, and win-back, including structured churn reasons.

### 6. Complete safe renewal orchestration
- Keep the engine and automation rule disabled while building and testing.
- Harden the worker around branch configuration, IST quiet hours, DND/preferences, staff claims, snoozes, daily caps, single-flight lease, stage dedupe, and circuit breaker.
- Route every message through `dispatch-communication`; remove the direct WhatsApp path from Follow-Up Center and link that tab to Renewal Center.
- Re-run authoritative renewal detection before each batch and immediately suppress cases with paid renewal evidence, future successor membership, freeze, cancellation, or staff handling.
- Add Voice AI queue intent only after the configured unanswered threshold; the existing Voice AI worker remains the sole caller.
- Link Voice AI outcomes back to the renewal case/event log for busy, no answer, callback, interested, not interested, complaint, and DND results.
- Do not alter membership purchasing, activation, invoices, payments, Razorpay, attendance calculations, or existing Voice AI calling mechanics.

### 7. Add renewal analytics and controlled activation
- Add a read-only funnel: eligible → contacted → responded → callback/voice → renewed/win-back/lost.
- Include conversion by stage/channel/branch, time to renewal, outstanding cases, churn reasons, and suppressed cases.
- Add admin-only branch settings for stages, caps, channel, quiet hours, Voice threshold, and legacy reminder handover.
- Require a readiness preview showing the exact due audience and suppression counts before activation.
- Keep production sending off at completion. Activation will be a separate explicit action after verification; the existing expiry reminder remains active until a branch handover is deliberately enabled.

## Security and reliability
- Use migrations for schema/RPC/RLS changes and data repair only through controlled data updates.
- Pin `search_path`, restrict worker RPCs to service role, use capability checks for staff actions, and preserve branch isolation.
- Add indexes for due queues, open-case lookups, scan/session reconciliation, and delivery repair.
- Never expose raw vendor payloads, third-party image URLs, phone numbers, or report files outside authorized member/staff access.
- Record all repair, retry, claim, send, and outcome actions in append-only audit events.

## Verification
- Unit-test webhook retry/idempotency, paired-report accounting, plan-vs-credit usage, mismatched member/session rejection, and partial delivery recovery.
- Test Renewal Center RLS for owner/admin/manager/staff/trainer/member and cross-branch denial.
- Test duplicate-stage prevention, DND/quiet-hours/staff-claim suppression, renewal stop conditions, and Voice AI outcome mapping.
- Browser-test Rehan’s staff profile and member views at desktop and mobile sizes; verify report values against both attached PDFs.
- Confirm Rehan has one completed assessment, one plan usage, no unintended credit deduction, both reports visible, one secure delivery record per report, and no duplicate messages.
- Run focused tests, TypeScript checks through the project harness, build diagnostics, edge-function tests/log review, and the database security linter before reporting completion.
