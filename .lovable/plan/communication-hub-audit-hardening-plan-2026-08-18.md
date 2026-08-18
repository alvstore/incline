# Communication Hub Audit & Hardening Plan

Audit completed for Meta Template Management, Campaign Delivery, and Eco-System Health.

## Findings
- **Meta Eco-Error 131049:** Recipient `919928797971` hit a pacing limit (10:40 AM today). Meta blocks sends when engagement is low or frequency is too high for a specific template/recipient.
- **Template Status:** `invoice_pdf__whatsapp`, `payment_receipt_pdf__whatsapp`, and `feedback_request` are `PENDING_DELETION`, which causes fallback failures during automated sends.
- **Dispatcher Logic:** The `dispatch-communication` function (v1.27.0) is missing a clean "Suppressed" state for 131049 pacing in the UI, leading to confusing "Failed" entries without clear actionable next steps.
- **Quiet Hours Defect:** A bug in the retry worker meant messages deferred by quiet hours (11 PM - 7 AM) were inserted into `communication_retry_queue` with incorrect column names, causing them to never be sent.

## Proposed Actions

### 1. Eco-System Hardening (Terminal Errors)
- Update `parseCommError` to explicitly handle `131049` with a "Marketing Pacing" label.
- Modify `LiveFeed` to show a "Paced / Suppressed" badge for 131049 errors to differentiate them from technical failures.

### 2. Dispatcher Improvements
- Enhance `dispatch-communication` to check for recent 131049 failures to a recipient and auto-suppress marketing sends for 24h (Pacing Cooldown) to protect sender reputation.
- Fix the quiet-hours retry worker column mapping.

### 3. Template Management
- Implement a "Sync Status" indicator in the Templates Hub to warn when templates are `PENDING_DELETION` or `STALE`.

## Technical Tasks
- Edit `src/lib/comms/metaErrorLabels.ts` to include 131049 mapping.
- Edit `supabase/functions/dispatch-communication/index.ts` to implement pacing cooldown logic.
- Update `src/components/communications/DeliveryTimeline.tsx` with pacing-aware hints.

*Audit performed by Senior Architect & Engineering Lead.*
