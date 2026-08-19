# Security Hardening: Implementation of Selected Scanned Issues

This plan addresses the security findings as requested, focusing on RLS hardening for PII, signature verification for hardware relays, and fail-closed payment webhooks.

## 1. Device Relay Signature Verification
- **Issue:** `device_commands_relay_open_no_signature_verification`
- **Action:** Enforce HMAC-SHA256 signature verification in `mips-proxy` for `relay_open` and `remote_open` operations.
- **Verification:** Ensure `MIPS_RELAY_SECRET` is checked and replay attacks are mitigated via timestamp windows.

## 2. PII Scoping (Profiles & Leads)
- **Issue:** `profiles_broad_staff_pii_read` & `leads_and_contacts_comm_consent_pii_broad_staff_access`
- **Action:** Update RLS policies to restrict Staff and Managers to only see records within their assigned branches.
- **Technical Detail:** Replace `true` or broad `authenticated` policies with `EXISTS` checks against `user_visible_branch_ids()`.

## 3. Storage Bucket Hardening
- **Issue:** `attachments_bucket_read_leak` & `policy_pdfs_bucket_broad_authenticated_read`
- **Action:** Implement granular RLS on `storage.objects` for these buckets.
- **Logic:** Members can only read their own files; Staff/Managers can only read files within their branch scope.

## 4. Payment Webhook Security
- **Issue:** `payment_webhook_unsigned_fallback`
- **Action:** Remove any fallback logic that processes payments when signatures are missing.
- **Status:** All unsigned payloads must return 401 Unauthorized.

## 5. Public Capability Exposure
- **Issue:** `role_capabilities_public_read`
- **Action:** Restrict `SELECT` on `role_capabilities` to `authenticated` users with `admin` or `owner` roles for management, while allowing `has_capability()` to remain `SECURITY DEFINER` for internal checks.

---

I will now apply these hardening measures across the database and edge functions.
