# Fix contract signing: codes not arriving, signature not saving

## What the audit found (checked against live records)

- **Govind tried 4 times** (9 Nov 21:17–21:18, 10 Nov 11:03). Two WhatsApp attempts were **blocked by our own sender** ("no approved WhatsApp template for this category"). The other two left **no send record at all**. He never got a code, so he could never sign — no signature was ever stored for his contract.
- **Harshwardhan's new link** (created 11:39 today) has not produced any code request yet.
- **Why WhatsApp fails here but works on registration:** the registration page picks the approved Meta "verification code" template directly and sends it. The contract page only names the event and labels it a normal transactional message, so the sender can't find a matching approved template and blocks it.
- **Why the page still says "Code sent":** the contract function only treats a network failure as an error. A blocked or failed send comes back as "success", so staff see "Code sent" while nothing goes out.
- **Why SMS is shown:** the SMS button appears whenever a phone number exists. Both SMS providers (RoundSMS, MSG91) are switched **off**, so SMS can never work.
- **Email:** email attempts reached no sender record. The registration page sends email codes through the same route successfully, so the contract version's request is being dropped. The fix sends it the way registration does.
- **Why System Health saw nothing:** the contract function never reports blocked sends or failed signing to the error log.
- **"Signature not saving"** follows from the code problem: signing needs a valid code first, and none ever arrived.

## Fix

1. **Send codes like registration does**
   - WhatsApp: use the approved verification template directly, with the authentication category and the code variables it expects.
   - Email: use the same branded verification email registration uses.
   - Check the real send result. If it was blocked or failed, try the next available channel (WhatsApp → Email). Show "Code sent" only when a send actually went out. Otherwise show a clear message: "We couldn't send a code. Please contact HR."
2. **Show only channels that work**
   - The page asks the server which channels are live: WhatsApp needs an approved template, SMS needs an active provider, and Email needs a working sender.
   - SMS stays hidden until a provider is switched on.
3. **Report every failure to System Health**
   - Blocked or failed code sends, signature upload failures and signing errors are logged with the contract and link (no codes or personal details).
4. **Signing page clarity**
   - Show loading, "sent via X to ••••1234", resend countdown and the real error text when signing fails. Error messages are announced to screen readers.
   - The draw box shows an error if left empty. Signing stays disabled until a code is entered.
5. **Re-check Govind and Harshwardhan's links**
   - Keep both links (no new link needed). After the fix, send a real code to a test number and sign a test contract from start to finish.

## Technical details

- `supabase/functions/contract-signing/index.ts`:
  - `requestOtp`: look up the approved `templates` row (`trigger_event='otp_verification'`, `meta_template_status='APPROVED'`) and pass `template_id` with the matching category.
  - Read `dispatchRes.data.status` and treat `suppressed`/`failed`/`skipped` as failures, falling back to the next channel.
  - Check the error from the `otp_verifications` insert.
  - `get_contract` returns `available_channels`.
  - Call `log_error_event` on send, upload and sign failures. Bump the version.
- `src/pages/ContractSign.tsx`: render buttons from `available_channels`, add a resend timer, inline errors and `aria-live`.
- Add Deno tests for the channel selection and the suppressed→fallback logic, then redeploy `contract-signing`.
