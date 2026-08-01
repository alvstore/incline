# Razorpay settlement and MIPS face-delivery repair

## Confirmed findings

### Razorpay
- Razorpay captured **₹13,000** under payment `pay_TJDQMX77ASPTvP` and order `order_TJDQIZ5noq1i5K`.
- The matching local order transaction exists for **INV-INC-26-0033** and member **INC-26-0024**. The invoice total is **₹18,000**, only the earlier **₹5,000** payment is recorded, and the invoice remains `partial`.
- No webhook delivery row exists for this payment and the canonical order row still has no gateway payment ID.
- The Razorpay webhook is configured as the bare `/payment-webhook` URL, while the function requires `branch_id` in the query string. It rejects requests without that parameter before recording an audit row.
- The only active Razorpay integration is global (`branch_id IS NULL`), but the webhook function currently searches only for a branch-specific configuration. Even a corrected URL would not resolve the configured global credentials.
- `reconcile-razorpay-links` only scans Payment Link IDs beginning with `plink_`; this payment came from Standard Checkout with an `order_` ID, so the fallback cron can never reconcile it.
- The webhook secret is present in gateway settings, but it was pasted into chat. It must be replaced securely and never written to source or logs.

### MIPS
- Both gates are mapped and currently reported online: MIPS device IDs **21** and **23**.
- Local linked-photo inventory currently contains **44 members, 1 employee, and 5 trainers** (50 linked people with photos). One additional trainer has a photo but no MIPS person link.
- Recent device-dispatch audit truth is not clean: latest results show **Gate 1: 54 success / 5 failed** and **Entry 2: 57 success / 2 failed**. MIPS sometimes returns HTTP 200 with `请选择在线设备` (“please select an online device”), which must be treated as a failed delivery.
- `sync-to-mips` is repeatedly returning platform status **546** with `Memory limit exceeded` while decoding/re-encoding photos in-process.
- `mips-reconcile-devices` performs ten full person syncs serially; each can take roughly 8–15 seconds, while the automation caller aborts the run. Its latest rule status is `warning` with “The signal has been aborted”.
- Queue rows currently show no pending/failed backlog, but that does not prove both gates contain every face: the queue accepts success after at least one gate, and CRM rows are marked `synced` even when photo upload or one device dispatch fails.
- Neither device has a verified `last_sync`, so the current “41 faces” display cannot be reconciled against a trustworthy completed-device snapshot.

## Implementation

### 1. Secure and correct the Razorpay webhook contract
- Rotate the exposed webhook secret through secure gateway settings and keep it only in encrypted integration credentials.
- Generate the exact Razorpay webhook URL from the selected integration scope, including `gateway=razorpay` and the effective `branch_id`.
- Update `payment-webhook` credential resolution to use branch-first, global-fallback behavior, matching checkout and reconciliation.
- Preserve raw-body HMAC verification, reject unsigned events, and record every valid-branch delivery outcome without logging payload secrets.
- Return a non-2xx response when settlement fails; never acknowledge a captured event as successful if the invoice was not settled.

### 2. Make every captured Razorpay payment settle through one atomic path
- Route `payment.captured`, `order.paid`, and `payment_link.paid` into one normalized handler.
- Resolve the canonical transaction by branch + gateway + order ID, then call the authoritative `settle_payment` RPC with a gateway-payment-based idempotency key.
- Remove direct payment inserts and direct invoice total updates from the reconciler; all settlement side effects must flow through `settle_payment`.
- Extend reconciliation to pending Standard Checkout `order_*` rows as well as Payment Links, querying Razorpay by the correct API resource.
- Persist gateway payment ID, captured status, settlement result, event type, signature status, and sanitized failure details on the transaction audit trail.

### 3. Reconcile this ₹13,000 capture safely
- Fetch the payment from Razorpay by payment/order ID and verify captured amount, currency, account, and order ownership against the local canonical transaction.
- Atomically settle **₹13,000** against INV-INC-26-0033 using the original gateway capture time and idempotency key.
- Confirm the invoice becomes **₹18,000 paid / `paid`**, with exactly two ledger payments (₹5,000 + ₹13,000), one gateway transaction, and no duplicate membership/referral side effects.
- Do not use the Razorpay fee/GST amount as the customer payment amount; fees remain gateway settlement costs, not invoice deductions.

### 4. Replace MIPS image-heavy sync with bounded, resumable jobs
- Split person/server enrichment, photo normalization/upload, and per-device delivery into separately resumable stages.
- Normalize photos before invoking the MIPS worker (bounded dimensions, JPEG, under the MIPS size limit) and store the normalized biometric asset once; do not repeatedly decode the same image inside every gate dispatch.
- Process a small time-budgeted batch per run with claim/lease semantics, retry count, exponential backoff, and terminal failure classification.
- Stop the reconciler before the platform timeout and resume from persisted jobs on the next automation tick instead of running ten long serial calls.
- Include members, employees, trainers, managers, admins, and owners through the canonical personnel mapping; explicitly surface a photo-bearing person who lacks a MIPS identity.

### 5. Make per-gate verification the source of truth
- Require photo upload success plus successful delivery to **each mapped gate** before marking a person fully synchronized.
- Keep independent person-device jobs so a temporarily offline gate cannot erase success on the other gate.
- Treat MIPS business errors inside HTTP 200 responses as failures and retain the translated provider message.
- Update `last_sync` only after a completed verification sweep for that device; keep `last_reconcile_at` as attempt time.
- Derive UI counts from latest verified person-device state, separating eligible photos, MIPS server faces, each gate, pending, retrying, and terminal failures.

### 6. Close the current MIPS drift
- Query MIPS server personnel and each device’s enrolled-face list, normalize person numbers, and build a 50-person expected matrix from current linked-photo inventory.
- Enqueue only missing/stale server-photo and person-device pairs, including the unlinked photo-bearing trainer after identity resolution.
- Drain bounded batches until every expected pair is verified or has an explicit terminal provider error.
- Recheck the people previously reported as missing, including Love Kumar Paliwal and Akansha, on the server and both gates.

### 7. Security cleanup discovered during audit
- Branch-scope create access on `payment_transactions`, `stock_movements`, and write access on `whatsapp_templates`, while preserving owner/admin global access.
- Keep all provider credentials server-side and redact signatures, tokens, raw secrets, and signed biometric URLs from logs and audit payloads.

## Verification
- Send a harmless correctly signed Razorpay test event to the corrected URL and confirm signature verification plus an auditable ignored/test outcome.
- Replay or reconcile the real captured payment idempotently; repeated calls must not change the ₹18,000 final balance or create another payment.
- Confirm future captured Standard Checkout events settle automatically and a missed webhook is repaired by reconciliation.
- Run MIPS workers under bounded memory/time and confirm no 546 memory failures or automation aborts.
- Compare the expected photo roster with MIPS server, Gate 1, and Entry 2; the Device Command Center and attempt ledger must report identical counts.
- Verify every failure retains person, role, gate, operation, provider code/message, attempt number, and retry/terminal state.