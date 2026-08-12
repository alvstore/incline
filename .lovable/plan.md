# Plan: Repair MIPS Credentials and Device Setup

## Confirmed diagnosis

- The MIPS URL, username, and password are **not hardcoded** in the proxy. `mips-proxy` starts with the runtime secrets, then deliberately replaces them with the active branch record from `mips_connections` when a branch is selected.
- The active branch record points to the expected MIPS server and username, but its stored password length does not match the credential supplied today. Recent function logs show that this branch credential is being rejected by the MIPS server.
- Runtime secrets for `MIPS_SERVER_URL`, `MIPS_USERNAME`, and `MIPS_PASSWORD` exist, but they currently act only as a fallback. The branch record takes priority for normal Device Command Center calls.
- Credential fields exist only inside **Add Device**, while the gear-icon **Device Setup & Diagnostics** drawer has no connection editor despite directing users there.
- The current Add Device “Test Connection” does not test the URL, username, or password typed into the form. It calls the proxy with only `branch_id`, so the proxy tests the previously saved branch record instead.
- Saving the connection and adding a device are started independently, so device creation can finish even if credential saving fails.

## Implementation

### 1. Add a secure MIPS Connection section to Device Setup

- Add an owner/admin-only connection editor to the existing right-side Device Setup sheet.
- Show branch, server URL, username, active status, and a masked password field; never load or reveal the saved password.
- Treat an empty password as “keep existing password,” while requiring a password for first-time setup.
- Add explicit **Save & Test** and **Test saved connection** actions with loading, success, credential-rejected, timeout, and unreachable states.
- Keep the existing callback configuration and diagnostics sections intact.

### 2. Move credential writes and draft testing behind a protected backend function

- Add a versioned, strict-CORS MIPS connection-management function for owner/admin users.
- Support:
  - reading masked branch configuration,
  - securely upserting branch URL/username/password,
  - testing draft credentials before or during save,
  - testing the saved effective connection.
- Validate the URL as HTTP/HTTPS, normalize trailing slashes, enforce branch access, never return/log the password, and return classified errors.
- Use the branch database record as the explicit source of truth when configured; retain runtime secrets only as the documented fallback when no active branch record exists.

### 3. Correct save/test sequencing and cache behavior

- Update the Device Setup flow to save and verify in one awaited mutation, then invalidate all MIPS connection, fleet, health, and breaker queries.
- Refactor Add Device to use the same secure connection-management path instead of writing `mips_connections` directly.
- Make Add Device await connection success before creating the hardware record when connection fields are supplied.
- Remove the misleading test behavior that silently tests old saved credentials instead of the entered draft.

### 4. Align authorization and database access

- Use the existing device/settings capability model in the UI, with credential editing restricted to owner/admin to match database policy.
- Preserve service-only access to the raw password and masked reads for the frontend.
- Remove duplicate/obsolete connection policies if the audit confirms they are still simultaneously active, without widening access.

### 5. Validate end to end

- Test the supplied credentials directly against the MIPS `/login` endpoint without exposing them in logs or UI.
- Save them through the new protected flow for the selected branch.
- Call the deployed `mips-proxy` with that branch and verify the device-list request succeeds.
- Verify `sync-to-mips` uses the same branch connection and no longer logs `auth_failed`.
- Verify the Device Command Center changes from **Credentials rejected** to **Healthy** and that desktop/mobile drawer states remain usable.

## Technical notes

- The password supplied in chat will be used only for the one-time authenticated repair/test and will not be echoed back.
- No secret value will be placed in frontend code, migrations, logs, or committed files.
- The UI will retain the project’s Vuexy-style sheet, semantic tokens, accessible labels, focus states, and 44px touch targets.
