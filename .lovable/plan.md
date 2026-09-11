# HOWBODY Report Delivery Repair

## Confirmed issues
- Both WhatsApp report sends were accepted initially, then rejected by Meta with error `131047` because they were sent as free-form documents outside the 24-hour conversation window.
- The delivery records were marked `sent` before Meta confirmed delivery, so the member profile and Communication Hub showed incorrect status.
- The report function bypasses the shared communication dispatcher, creating duplicate and disconnected log rows without provider IDs.
- The approved body-scan template is body-only and uses positional `{{1}}`; the current local renderer produced the blank greeting `Hi ,`.
- No approved posture-scan WhatsApp template is currently available.
- HOWBODY webhook payloads contain assessment data and posture images, but no vendor PDF URL. The two attached HOWBODY PDFs are therefore the authoritative originals for Rehan’s existing reports.

## Implementation
1. **Preserve original HOWBODY reports**
   - Add private original-PDF storage fields to scan delivery records.
   - Upload the two attached HOWBODY PDFs to Rehan’s existing body and posture report records.
   - Prefer an original HOWBODY PDF for viewing, download, email, and WhatsApp. Keep a clearly identified fallback generator only when no original is available.

2. **Use the canonical communication pipeline**
   - Refactor report delivery to call the existing dispatcher for email and WhatsApp with report attachment, member, branch, event, source, and idempotency details.
   - Remove direct WhatsApp message insertion and direct communication-log insertion from this flow.
   - Link each WhatsApp message to its communication record and store Meta’s provider message ID.

3. **Make WhatsApp delivery window-safe**
   - Use an approved utility template when the member is outside the 24-hour session.
   - Correct positional variable rendering so the approved body template receives `Rehan khan` rather than a blank value.
   - Do not retry posture delivery until an approved posture template is available; record it as suppressed with the exact reason instead of falsely sent.
   - Keep document delivery native only when the approved template has a document header; otherwise send the approved template with a short secure report link.

4. **Truthful status and live reconciliation**
   - Treat provider acceptance as `sent`, not `delivered`.
   - Update report delivery status from WhatsApp callbacks to `delivered`, `read`, or `failed` using the provider message ID.
   - Backfill the two incorrect Rehan delivery records from their confirmed Meta failures.
   - Ensure the Communication Hub shows one consolidated, searchable event per report with accurate channel status and failure details.

5. **Member and staff report experience**
   - Show separate report-prepared and channel-delivery states.
   - Display `Sent`, `Delivered`, `Read`, `Failed`, or `Suppressed`; never infer delivery from the presence of a PDF.
   - Keep retry actions available only for retryable failures and explain when an approved WhatsApp template is required.

## Technical details
- Additive migration only; preserve existing report IDs, measurement data, entitlement usage, and profile links.
- Private storage remains protected by signed URLs and existing member/staff access rules.
- Existing HOWBODY webhook idempotency and scan-credit consumption remain unchanged.
- Validate function checks, application checks, status-callback reconciliation, Communication Hub visibility, and authenticated member/staff report screens.
- Re-deliver Rehan’s reports only after the body template path is valid; do not create another false-success record.
