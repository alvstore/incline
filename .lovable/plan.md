## Audit findings

1. **The send itself is working now**
   - Recent sends to `+919887601200` reached WhatsApp and were marked **read**.
   - They used the MM WhatsApp route and template `campaign_1784104215124`.

2. **Why the message says “Hi Test”**
   - The Campaign Wizard test-send path hardcodes the test recipient name as `Test User`.
   - That becomes `first_name = Test`, so Meta receives the approved template variable `{{1}} = Test`.
   - This is not a Meta sync failure for the latest send; it is our test-send code using a fake name instead of resolving the real lead/member/contact name for the phone number.

3. **Why earlier “unknown” happened**
   - The old UI interpreted the async broadcast ACK as a failed test.
   - That was partly fixed by switching test-send to `dispatch-communication`, but the catch block still falls back to generic messages if the function error body is nested.

4. **Campaign risk found during audit**
   - The newer explicit-recipient broadcast path builds `first_name`, `member_name`, and positional `1` correctly.
   - The legacy `member_ids` path does **not** pass per-member WhatsApp template variables, so member-only campaigns can still send empty/fallback variables or stale placeholder rendering.

## Fix plan

### 1. Fix Campaign Wizard test-send personalization
**File:** `src/components/campaigns/CampaignWizard.tsx`

- Before sending a WhatsApp/SMS/RCS test, look up the entered phone in the backend:
  - `profiles.phone`
  - `leads.phone`
  - `contacts.phone`
- Use the best matching real name as the test variable source.
- Fallback only if no record exists:
  - full name: `Test User`
  - first name: `Test`
- Send Meta variables as:
  - `first_name`
  - `member_name`
  - `full_name`
  - `name`
  - positional aliases `1`, `v1`, `param1`
- Update the success toast to show which name was used, so testing is auditable.

### 2. Fix unknown test errors
**File:** `src/components/campaigns/CampaignWizard.tsx`

- Replace the generic catch fallback with a robust error extractor that checks:
  - `error.message`
  - edge function response body from `error.context`
  - `meta_error`, `meta_code`, `reason`, `error_message`
- Show specific errors like `132018 template_param_empty`, `131049 Meta pacing`, or `template_stale_in_meta` instead of “unknown”.

### 3. Fix legacy member broadcast template variables
**File:** `supabase/functions/send-broadcast/index.ts`

- In the `member_ids` dispatch loop, build the same per-recipient variable map already used by the explicit `recipients` path:
  - `member_name`
  - `full_name`
  - `first_name`
  - `name`
  - `member_code`
  - `1`, `v1`, `param1`
- Pass those variables to `dispatch-communication` for WhatsApp template sends.
- Add the same missing-name guard for WhatsApp approved templates so Meta does not receive empty name parameters.

### 4. Improve dispatcher response detail for MM/Meta failures
**File:** `supabase/functions/dispatch-communication/index.ts`

- When `send-whatsapp` returns a function error, preserve the structured JSON body in the final `communication_logs.error_message` and response reason.
- Include `provider_route`, `meta_code`, `meta_subcode`, and `fbtrace_id` when available.

### 5. Deploy and test

- Deploy changed backend functions:
  - `send-broadcast`
  - `dispatch-communication`
- Run a direct test send to `+919887601200` through the Campaign Wizard path.
- Verify backend rows show:
  - delivery status is `sent/read` or a specific Meta error
  - `content` has the resolved name, not unresolved `{{1}}`
  - `delivery_metadata.provider_route` is `mm_api` or `cloud_api`

## Expected result

- If the phone number exists as a lead/contact/member, the test WhatsApp will say the real name instead of `Test`.
- If the number is only a manual test number, it will still say `Test` by design.
- Campaign broadcasts will use each recipient’s own name consistently.
- “Unknown” failures will become actionable Meta/provider errors.