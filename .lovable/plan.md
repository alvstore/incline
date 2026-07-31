# Payment + MIPS reliability repair

## Confirmed findings
- `edit_payment` calls a 10-argument `record_payment` using `payment_method`, but the deployed 10-argument overload accepts `text`; PostgreSQL therefore cannot resolve the function.
- The backend currently has **46 people with photos** and **45 photo-bearing, MIPS-linked people** eligible for synchronization.
- The current device reconciler only includes members and employees: **55 linked people**. Adding trainers raises the roster to **61**, so 6 linked trainers are currently omitted.
- The reconciler invokes a full-person/full-device loop synchronously, but its caller marks the automation run successful after dispatch. The underlying request repeatedly reaches the **55-second timeout**, so “success” does not prove the roster reached either gate.
- Two devices are registered, but both have `last_sync = null`; today there are no `mips_sync_attempts` or `mips_sync_failures` audit rows. The existing process therefore cannot prove person-by-person/device-by-device delivery.
- Five old biometric queue failures contain `person_uuid` but no `member_id`/`staff_id`; the queue processor cannot resolve them.

## Implementation

### 1. Repair payment editing atomically
- Replace `edit_payment` with a corrected function that calls the canonical 10-argument `record_payment` overload using `text` for the normalized payment method.
- Preserve the existing atomic workflow: void old payment, create replacement payment, respect historical payment date, and return the replacement result.
- Keep role/capability validation and branch isolation server-side.
- Add a database regression assertion that resolves and executes the exact signature used by `PaymentEditDrawer`.

### 2. Make the biometric queue person-aware
- Normalize queue rows around `person_type + person_uuid` and resolve legacy member/staff/trainer IDs during processing.
- Update photo-upload trigger enqueue logic so new rows always contain the appropriate entity reference.
- Backfill/requeue the five failed legacy rows instead of leaving them permanently skipped.
- Include trainers as a first-class path throughout queue processing and device reconciliation.

### 3. Replace monolithic MIPS pushes with resumable batches
- Change reconciliation from one synchronous 61-person × 2-device operation into small, bounded batches.
- For every eligible person:
  1. upsert/enrich the employee on the MIPS server;
  2. validate/normalize the face image;
  3. enqueue one delivery job per active device;
  4. process jobs with retry/backoff and a short execution budget;
  5. resume unfinished work on the next automation run.
- Do not mark a person/device pair complete until MIPS returns a successful response.
- Ensure one slow or offline gate does not block the other gate.

### 4. Add real delivery truth and auditability
- Record each attempt with person, role, MIPS person ID, device serial, operation, HTTP/result code, duration, attempt number, and sanitized error.
- Update each device’s `last_sync` only after a completed batch reaches it.
- Make automation runs report queued/succeeded/failed/pending counts rather than only “dispatched: 1”.
- Treat upstream 401/timeout/546-style failures as retryable or terminal according to category; never report them as successful delivery.

### 5. Correct the Device Command Center
- Separate these metrics clearly:
  - People in MIPS Server
  - People with face on MIPS Server
  - Face delivered to Gate 1
  - Face delivered to Gate 2
  - Pending/failed per gate
- Include members, employees, trainers, managers, admins, and owners using the canonical personnel identity mapping.
- Show person-level per-device status and last verified time.
- Make “Sync pending” enqueue only missing/stale person-device pairs; make “Verify all” read device truth without blindly rewriting all records.

## Verification
- Execute an edited-payment regression with a dated payment and confirm the invoice balance/status and audit history remain correct.
- Requeue the five malformed biometric jobs and verify none are skipped for missing entity IDs.
- Run reconciliation through multiple bounded batches until pending reaches zero or explicit terminal failures remain.
- Compare all **45 currently eligible photo-bearing people** against both registered devices, including the 6 linked trainers.
- Verify Love Kumar Paliwal and Akansha individually on the MIPS server and on each gate, with recorded delivery evidence.
- Confirm automation history, attempt logs, and `/devices` show the same per-device counts.