# WhatsApp / Meta Delivery Audit — Findings and Fix Plan

## What the data shows

Audit window: last 10 days of `communication_logs`, `communication_retry_queue`, delivery events and the four functions in the send path (`send-broadcast` → `dispatch-communication` → `send-whatsapp`, plus `process-comm-retry-queue`).

Confirmed facts:

- The 131049 ("healthy ecosystem engagement") failures are **not** coming from member campaigns. 743 of them are internal `new_lead` staff alerts sent to just two staff numbers (919928910901: 416, 919887601200: 327).
- Those staff numbers received the **same alert body** 6–8 times per hour, around the clock, for days. On 23 Aug, every hour from 00:00 to 13:00 shows 6–8 sends with exactly one distinct message body.
- Every one of those sends carries a distinct dedupe key of the form `retry:<queue-row-id>:1`, so they all originate from the retry worker, and each new queue row gets a fresh key that the dedupe index cannot catch.
- `communication_retry_queue` holds 408 rows for that single recipient; all 819 whatsapp retry rows in the window are marked `succeeded`, because the worker treats "Meta accepted the request" as success. The 131049 verdict arrives later over the webhook, so the loop never learns it failed.
- The existing guards are real but positioned wrong: the DB trigger `fn_enqueue_failed_communication` skips 131049, and `process-comm-retry-queue` v2.6.0 treats it as terminal — yet rows kept being created, because the quiet-hours path in `dispatch-communication` inserts a *fresh* queue row (`next_retry_at = +1h`) every time a deferred message comes back around, and no guard counts how many times the same payload has already been sent to the same recipient.

Net effect: Meta sees an internal alert re-sent to the same two numbers ~150 times a day. That is exactly the behaviour 131049 exists to punish, and it degrades the number's quality rating for every other message, including member campaigns.

## Fix plan

### 1. Stop the active loop (immediate)
- Cancel all pending/processing `communication_retry_queue` rows for the two staff recipients and any row whose payload has already been sent more than 3 times in 24h.
- Mark the outstanding paced `new_lead` logs as `suppressed` so dashboards stop counting them as retryable.

### 2. Per-recipient send budget (the missing guard)
Add a DB-side gate every send passes through, regardless of entry path:
- A `communication_send_budget` check inside `dispatch-communication`: for a given (recipient, channel, category), refuse the send when N identical-content sends already happened in the last 24h (default 3, 1 for `new_lead`), logging `delivery_status = 'suppressed'`, reason `budget_exceeded`.
- Hard ceiling per recipient per rolling hour across all categories, so no future feature can reproduce this.

### 3. Fix the quiet-hours re-queue
- Deferring a message must **update** the existing queue row's `next_retry_at` instead of inserting a new one; the dedupe trigger only covers `pending`/`processing` rows with identical content and misses the insert-after-success pattern.
- Cap total deferrals per message (3) and then drop with `expired_quiet_hours` rather than looping.

### 4. Make "accepted" not mean "delivered"
- `process-comm-retry-queue` marks a row `succeeded` only on webhook-confirmed `sent`/`delivered`. On Meta acceptance it moves to `awaiting_confirmation`, and a webhook 131049 or failure flips it to `terminal` without a new attempt.

### 5. Route internal staff alerts off WhatsApp templates
- `new_lead` / task / ops alerts to staff go to in-app notification + email by default, with WhatsApp as an opt-in that is rate-limited to one digest per 15 minutes per staff member (batched: "3 new leads").
- This alone removes the majority of Meta traffic that has no business value on the marketing rail.

### 6. Circuit breaker on quality signals
- Track 131049 and throttle codes per phone-number-id in a `whatsapp_health` state row. On 5 pacing errors within an hour, open the breaker: pause all non-transactional WhatsApp sends for 6 hours, surface a banner in System Health, and let transactional (OTP, payment receipt) traffic through.
- Auto-close after a successful probe send.

### 7. Visibility
- System Health panel showing per-category 24h send counts, suppression reasons, breaker state and top recipients by volume — so a runaway loop is visible within minutes instead of days.

## Technical notes

- New migration: `communication_send_budget` function + supporting index on `communication_logs (recipient, type, category, created_at)`, `whatsapp_health` table with RLS (owner/admin read, service_role write), queue status enum additions (`awaiting_confirmation`, `terminal`).
- Edited functions: `dispatch-communication` (budget gate, quiet-hours update-not-insert, breaker check), `process-comm-retry-queue` (confirmation-based success, deferral cap), `notify-lead-created` (digest + channel switch), `whatsapp-webhook` (feed breaker + close retry rows).
- Verification: replay a `new_lead` alert via curl against the dispatcher and confirm the second identical send within 24h returns `suppressed`; confirm queue row count for the two staff numbers stays flat over a cron cycle.
