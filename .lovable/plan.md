# Security Hardening Plan — Supabase RLS & Function Guards

This plan addresses a series of high-impact security findings identified in recent scans, focusing on preventing PII leaks, securing IoT/device commands, and hardening financial webhooks.

## Security Issues to be Resolved

### 1. Device Command Relay Signature Verification
- **Issue:** `device_commands_relay_open_no_signature_verification`
- **Context:** The `mips-proxy` edge function and related relay logic can be triggered without verifying the authenticity of the command source.
- **Fix:** Implement signature verification in `mips-proxy` for all `relay_open` operations, ensuring commands are signed by the application backend using a shared secret.

### 2. Howbody Public Report Tokens
- **Issue:** `howbody_public_report_tokens_no_authenticated_read_policy`
- **Context:** `howbody_public_report_tokens` table has a `true` RLS policy for both `anon` and `authenticated` roles, which is too broad.
- **Fix:** Restrict `anon` access to only specific token-based lookups and ensure `authenticated` users can only see tokens they generated or have management rights over.

### 3. Broad Staff PII Access (Leads & Profiles)
- **Issue:** `leads_and_contacts_comm_consent_pii_broad_staff_access` & `profiles_broad_staff_pii_read`
- **Context:** Staff roles currently have visibility into PII (Phone, Email, Consent status) across all branches.
- **Fix:** Refine RLS policies on `leads` and `profiles` to enforce strict branch-scoping. Staff/Managers will only see records within their assigned branches.

### 4. Unsigned Payment Webhooks
- **Issue:** `payment_webhook_unsigned_fallback`
- **Context:** The payment webhook endpoint might allow processing of payloads even when gateway signatures (Razorpay, PhonePe) are missing or invalid in certain edge cases.
- **Fix:** Enforce "Fail-Closed" logic in `payment-webhook`. All unsigned or invalidly signed payloads will be rejected with a 401 Unauthorized, with no fallback processing.

### 5. Storage Bucket Leaks (Attachments & Policy PDFs)
- **Issue:** `attachments_bucket_read_leak` & `policy_pdfs_bucket_broad_authenticated_read`
- **Context:** The `attachments` and `policy-pdfs` storage buckets allow broad read access to all authenticated users.
- **Fix:** Implement granular read policies based on `member_id` ownership for members and `branch_id` scoping for staff.

### 6. Public Execution of Sensitive Functions
- **Issue:** `role_capabilities_public_read` & `SECURITY DEFINER` risks
- **Context:** Sensitive lookup tables and functions (e.g., `role_capabilities`) are readable by all authenticated users, potentially exposing the security model.
- **Fix:** Revoke `public` and `authenticated` execute/select permissions where not explicitly required. Switch sensitive views to `SECURITY INVOKER`.

## Technical Details

### Database Migrations
- `REVOKE EXECUTE ON FUNCTION ... FROM public, authenticated;` for internal helper functions.
- `DROP POLICY ... ON ...; CREATE POLICY ...` to tighten `leads`, `profiles`, and `howbody_public_report_tokens`.
- Move extensions from `public` to a dedicated `extensions` schema to prevent accidental exposure.

### Edge Function Updates
- Update `supabase/functions/mips-proxy/index.ts` to validate HMAC signatures on incoming commands.
- Update `supabase/functions/payment-webhook/index.ts` to strictly enforce `signatureVerified` before any `settle_payment` call.

### Verification Plan
- **Automated Tests:** Re-run Supabase Linter to confirm the findings are resolved.
- **Manual Verification:** Attempt to access cross-branch lead PII with a staff account to verify scoping.
- **Webhook Simulation:** Send an unsigned payload to the payment webhook and verify it returns 401.
