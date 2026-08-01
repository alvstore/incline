# Razorpay Reconciliation, Webhook Activity & MIPS Face Parity Repair

## Verified findings
- Kritesh Mali’s ₹13,000 record stores `payment_method = upi` and `payment_source = razorpay`; current screens show only the instrument, hiding the gateway.
- The reconciler recorded the payment on 1 Aug because `settle_payment` does not accept the Razorpay capture timestamp. Razorpay’s 29 Jul timestamp is available but discarded.
- Gateway fee/tax/net settlement are not represented as first-class payment fields, so the UI cannot show the Razorpay deduction.
- The webhook screen only reads `payment_transactions.source = webhook`. The successful recovery was `source = order`, so it is excluded.
- The prominent webhook URL in settings omits required gateway/branch parameters. Deliveries using it are rejected before they can be stored, which explains the empty activity screen.
- MIPS accepted recent dispatches for 59 distinct people per gate, but the hardware still reports 41 photos. The current code treats MIPS’s asynchronous “downloading personnel information” response as final success; that is acceptance, not verified device installation. Recent Gate 1 attempts also intermittently return “select an online device.”
- Local photo inventory is 44 members + 1 employee + 6 trainers. The server/device counters therefore mix total personnel with face-enrolled personnel and are not reliable delivery proof.
- Admin member profiles already have a basic payment list, but it hides gateway/source, gateway IDs, deductions, and complete invoice context. The member-facing invoices page has no payment-history ledger.

## Implementation plan

### 1. Make gateway settlements accounting-correct
- Extend the canonical `settle_payment` RPC with optional gateway capture date, fee, tax, and net-settlement inputs while preserving existing callers.
- Persist both dimensions explicitly:
  - instrument: UPI/card/net banking
  - source: Razorpay/manual/PayU/etc.
- Store gross amount, gateway fee, gateway tax, and expected net settlement as typed auditable fields rather than deriving them in the browser.
- Update Razorpay webhook and reconciliation handlers to pass the payment’s real `created_at`, `fee`, `tax`, order ID, payment ID, and captured status.
- Keep `settle_payment` idempotent so webhook, checkout callback, and reconciler cannot create duplicates.
- Backfill Kritesh Mali’s payment to 29 Jul 2026, retain `upi` as the instrument, label the source as Razorpay, and populate deductions/net from the verified Razorpay API response.

### 2. Correct all payment displays
- Show payments as, for example, **Razorpay · UPI**, not only “UPI.”
- Show **Paid on**, **Recorded on**, gross, gateway deduction, and expected net settlement where applicable.
- Apply the same formatter to dashboard recent payments, Payments/Finance, invoice details, admin member profile, and member-facing invoices/payment history.
- Add invoice number, gateway payment/order IDs, status, and receipt context without exposing secrets.
- Preserve manual payments as Cash/UPI/Card with a clear Manual source.

### 3. Make webhook activity observable and useful
- Replace the misleading generic webhook URL with the canonical branch-aware Razorpay URL generated from one shared helper.
- Record rejected webhook attempts, including missing branch, invalid signature, malformed payload, duplicate, settlement failure, and successful processing; never discard them silently.
- Expand Webhook Activity to include webhook deliveries and reconciler recoveries with source badges, event type, signature status, HTTP outcome, invoice/payment match, timestamps, filters, and a detail drawer.
- Add a configuration-health state that verifies whether the active URL is branch-aware and whether a recent signed event has been observed.
- Keep `/integrations/webhooks` as the dedicated operational page, but make the integration button open it intentionally and label it “Webhook Activity” rather than appearing like an unexpected redirect.

### 4. Replace MIPS “accepted” status with verified delivery states
- Model delivery as: `queued → server_face_ready → device_accepted → device_verified` (or `failed`).
- Do not mark a queue item fully synced merely because `/through/device/syncPerson` returns “downloading personnel information.”
- After dispatch, poll/re-query MIPS device/person state within a bounded background job; only mark success when the person/photo is verifiably present on every mapped gate.
- Maintain independent Gate 1/Gate 2 delivery rows, retry only the missing gate, and use exponential backoff for the intermittent online-device race.
- Keep each worker invocation small and resumable to avoid edge memory/time limits.
- Reconcile the complete face-eligible roster across members, employees, trainers, admins, managers, and owners using the canonical person identity and photo path.

### 5. Add a real Face Parity control surface
- In Device Command Center, show three separate truths:
  - CRM people with valid photos
  - MIPS server people with valid photos
  - verified photo presence per device
- List every mismatch with person name/code, role, server photo state, Gate 1 state, Gate 2 state, latest error, and next retry.
- Provide scoped actions: retry missing device, retry selected people, and run bounded parity repair.
- Never display a healthy/synced badge from aggregate counts or asynchronous acceptance alone.

### 6. Test and validate end to end
- Curl/test the Razorpay reconciliation path using the known payment and confirm one ledger entry, 29 Jul paid date, Razorpay + UPI labeling, and accurate fee/net values.
- Send a safe signed webhook test and verify it appears in Webhook Activity with signature/outcome data.
- Query invoice, payment, transaction, and member history records to confirm they agree.
- Run bounded MIPS sync tests against both mapped gates, then compare server/device results after the async download window rather than trusting the initial 200 response.
- Verify desktop and mobile payment history, webhook activity, and device parity views.

## Security and reliability constraints
- The pasted webhook secret will not be written to source or displayed; implementation will use the secure configured backend secret.
- All schema changes will use migrations, preserve RLS/branch isolation, and grant only the required roles.
- Gateway credentials, internal URLs, and sensitive payload fields will be masked in logs and UI.
